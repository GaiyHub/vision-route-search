import type { ScreenshotImage, Tool, ToolResult } from '../types';
import { normalizeToolResult } from './ToolRegistry';
import { toolFailure } from './ToolResult';
import { toolResultBudget } from './ToolResultBudget';

export const FILE_READ_TOOL_NAME = 'file_read';
export const LARGE_RESULT_FALLBACK_THRESHOLD = 50_000;
export const FILE_READ_DEFAULT_LIMIT = 6_000;
export const FILE_READ_MAX_LIMIT = 8_000;

const PREVIEW_CHARS = 2_000;
const SESSION_RETENTION_COUNT = 20;
const SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const NEVER_OFFLOAD_TOOLS = new Set([
  FILE_READ_TOOL_NAME,
  'list_apps',
  'read_skill',
  'ui_screenshot',
  'ui_inspect',
  'ui_dump_raw_tree',
  'ask_user',
  'request_user_action',
  'confirm_action',
  'task_complete',
  'task_failed',
  'todo_create',
  'todo_update',
]);

export const FILE_READ_TOOL: Tool = {
  name: FILE_READ_TOOL_NAME,
  uiEffect: 'none',
  description:
    '分页读取豆泡为超大工具结果保存的完整文本。仅接受工具结果占位中返回的 /tool-results/ 路径；使用 offset 和 limit 继续读取后续内容。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '大工具结果占位返回的 /tool-results/<会话>/<文件名> 路径',
      },
      offset: {
        type: 'number',
        description: '从第几个字符开始读取，默认 0',
      },
      limit: {
        type: 'number',
        description: `最多读取的字符数，默认 ${FILE_READ_DEFAULT_LIMIT}，最大 ${FILE_READ_MAX_LIMIT}`,
      },
    },
    required: ['path'],
  },
};

interface ArtifactFileInfo {
  exists: boolean;
  isDirectory?: boolean;
}

export interface ArtifactFileSystem {
  documentDirectory?: string | null;
  makeDirectoryAsync(uri: string, options?: { intermediates?: boolean }): Promise<void>;
  writeAsStringAsync(uri: string, contents: string, options?: { encoding?: string }): Promise<void>;
  readAsStringAsync(uri: string, options?: { encoding?: string }): Promise<string>;
  getInfoAsync(uri: string): Promise<ArtifactFileInfo>;
  readDirectoryAsync?(uri: string): Promise<string[]>;
  deleteAsync?(uri: string, options?: { idempotent?: boolean }): Promise<void>;
  EncodingType?: { UTF8?: string };
}

export interface OffloadedToolResultReference {
  contextOffloaded: true;
  tool: string;
  callId: string;
  path: string;
  originalChars: number;
  originalBytes: number;
  preview: string;
  message: string;
}

export class ToolResultArtifactStore {
  private sessionId = '';
  private ready: Promise<void> | null = null;

  constructor(private readonly options: {
    fileSystem?: ArtifactFileSystem;
    now?: () => number;
    random?: () => string;
  } = {}) {}

  beginSession(): void {
    const now = this.now();
    const random = (this.options.random?.() ?? Math.random().toString(36).slice(2, 10))
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 16) || 'session';
    this.sessionId = `${now}-${random}`;
    this.ready = null;
  }

  async offloadIfNeeded(toolName: string, callId: string, raw: unknown): Promise<unknown> {
    if (NEVER_OFFLOAD_TOOLS.has(toolName)) return raw;
    const result = normalizeToolResult(raw);
    if (result.sensitive || alreadyOffloaded(result)) return raw;

    const content = serializePersistedContent(result);
    const threshold = toolResultBudget(toolName) ?? LARGE_RESULT_FALLBACK_THRESHOLD;
    if (content.length <= threshold) return raw;

    try {
      await this.ensureReady();
      const extension = result.ok && typeof result.data === 'string' ? 'txt' : 'json';
      const filename = `${safeSegment(toolName)}_${safeSegment(callId)}.${extension}`;
      const logicalPath = `/tool-results/${this.sessionId}/${filename}`;
      await this.fs().writeAsStringAsync(
        `${this.sessionDirectory()}${filename}`,
        content,
        { encoding: this.fs().EncodingType?.UTF8 ?? 'utf8' },
      );
      const reference: OffloadedToolResultReference = {
        contextOffloaded: true,
        tool: toolName,
        callId,
        path: logicalPath,
        originalChars: content.length,
        originalBytes: utf8ByteLength(content),
        preview: preview(content),
        message: '完整工具结果已保存；需要更多内容时使用 file_read 按 offset 分页读取。',
      };
      return replaceWithReference(result, reference);
    } catch {
      // Persistence is a context optimization. A storage failure must not
      // turn a successfully executed tool into a failed task.
      return raw;
    }
  }

  async read(args: Record<string, unknown>): Promise<unknown> {
    const path = typeof args.path === 'string' ? args.path.trim() : '';
    const match = path.match(
      /^\/tool-results\/(\d+-[a-zA-Z0-9_-]+)\/([a-zA-Z0-9._-]+)$/,
    );
    if (!match || match[2].includes('..')) {
      return toolFailure('file_read 只能读取工具结果占位返回的 /tool-results/ 路径', 'INVALID_ARGUMENT', {
        retryable: false,
      });
    }
    const offset = args.offset === undefined ? 0 : Number(args.offset);
    const requestedLimit = args.limit === undefined ? FILE_READ_DEFAULT_LIMIT : Number(args.limit);
    if (!Number.isInteger(offset) || offset < 0) {
      return toolFailure('offset 必须是大于等于 0 的整数', 'INVALID_ARGUMENT', { retryable: false });
    }
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > FILE_READ_MAX_LIMIT) {
      return toolFailure(`limit 必须是 1–${FILE_READ_MAX_LIMIT} 的整数`, 'INVALID_ARGUMENT', {
        retryable: false,
      });
    }

    try {
      await this.ensureReady();
      const uri = `${this.baseDirectory()}${match[1]}/${match[2]}`;
      const info = await this.fs().getInfoAsync(uri);
      if (!info.exists || info.isDirectory) {
        return toolFailure('指定的工具结果文件不存在或已被清理', 'FILE_NOT_FOUND', {
          retryable: false,
        });
      }
      const content = await this.fs().readAsStringAsync(uri, {
        encoding: this.fs().EncodingType?.UTF8 ?? 'utf8',
      });
      if (offset > content.length) {
        return toolFailure(`offset 超出文件长度 ${content.length}`, 'INVALID_ARGUMENT', {
          retryable: false,
        });
      }
      const end = Math.min(content.length, offset + requestedLimit);
      return {
        ok: true,
        data: {
          path,
          offset,
          limit: requestedLimit,
          content: content.slice(offset, end),
          totalChars: content.length,
          nextOffset: end < content.length ? end : null,
          hasMore: end < content.length,
        },
      };
    } catch (error) {
      return toolFailure(
        `读取工具结果文件失败：${error instanceof Error ? error.message : String(error)}`,
        'FILE_READ_ERROR',
        { retryable: true },
      );
    }
  }

  private async ensureReady(): Promise<void> {
    if (!this.sessionId) this.beginSession();
    if (!this.ready) {
      this.ready = (async () => {
        const fs = this.fs();
        await fs.makeDirectoryAsync(this.baseDirectory(), { intermediates: true });
        await this.pruneOldSessions();
        await fs.makeDirectoryAsync(this.sessionDirectory(), { intermediates: true });
      })();
    }
    await this.ready;
  }

  private async pruneOldSessions(): Promise<void> {
    const fs = this.fs();
    if (!fs.readDirectoryAsync || !fs.deleteAsync) return;
    try {
      const entries = (await fs.readDirectoryAsync(this.baseDirectory()))
        .filter((name) => /^\d+-[a-zA-Z0-9_-]+$/.test(name))
        .filter((name) => name !== this.sessionId)
        .sort((a, b) => sessionTimestamp(b) - sessionTimestamp(a));
      const now = this.now();
      await Promise.all(entries.map(async (name, index) => {
        if (
          (index >= SESSION_RETENTION_COUNT - 1 ||
            now - sessionTimestamp(name) > SESSION_RETENTION_MS)
        ) {
          await fs.deleteAsync!(`${this.baseDirectory()}${name}/`, { idempotent: true });
        }
      }));
    } catch {
      // Best-effort cleanup must never prevent the current result from being saved.
    }
  }

  private fs(): ArtifactFileSystem {
    if (this.options.fileSystem) return this.options.fileSystem;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-file-system/legacy') as ArtifactFileSystem;
  }

  private baseDirectory(): string {
    const documentDirectory = this.fs().documentDirectory;
    if (!documentDirectory) throw new Error('应用文档目录不可用');
    return `${documentDirectory}agent-tool-results/`;
  }

  private sessionDirectory(): string {
    return `${this.baseDirectory()}${this.sessionId}/`;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

function alreadyOffloaded(result: ToolResult): boolean {
  return Boolean(
    result.ok &&
      result.data &&
      typeof result.data === 'object' &&
      (result.data as Record<string, unknown>).contextOffloaded === true,
  );
}

function serializePersistedContent(result: ToolResult): string {
  if (result.ok && typeof result.data === 'string') return result.data;
  const persistable = result.ok
    ? result.data
    : {
        error: result.error,
        code: result.code,
        details: result.details,
      };
  const serialized = JSON.stringify(persistable ?? null, null, 2);
  return serialized ?? String(persistable);
}

function replaceWithReference(
  result: ToolResult,
  reference: OffloadedToolResultReference,
): ToolResult & { observationImage?: ScreenshotImage } {
  if (result.ok) return { ...result, data: reference };
  return { ...result, details: reference };
}

function preview(content: string): string {
  if (content.length <= PREVIEW_CHARS) return content;
  const half = Math.floor(PREVIEW_CHARS / 2);
  return `${content.slice(0, half)}\n…[中间内容已省略]…\n${content.slice(-half)}`;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'tool';
}

function sessionTimestamp(name: string): number {
  const value = Number(name.split('-', 1)[0]);
  return Number.isFinite(value) ? value : 0;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}
