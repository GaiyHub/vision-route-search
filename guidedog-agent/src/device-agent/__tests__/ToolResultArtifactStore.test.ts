import {
  FILE_READ_MAX_LIMIT,
  ToolResultArtifactStore,
  type ArtifactFileSystem,
} from '../tools/ToolResultArtifactStore';
import { truncateToolResult } from '../tools/ToolResultBudget';

function memoryFileSystem(): ArtifactFileSystem & { files: Map<string, string>; directories: Set<string> } {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  return {
    documentDirectory: 'memory://documents/',
    EncodingType: { UTF8: 'utf8' },
    files,
    directories,
    async makeDirectoryAsync(uri) { directories.add(uri); },
    async writeAsStringAsync(uri, contents) { files.set(uri, contents); },
    async readAsStringAsync(uri) {
      const value = files.get(uri);
      if (value === undefined) throw new Error('not found');
      return value;
    },
    async getInfoAsync(uri) {
      return { exists: files.has(uri) || directories.has(uri), isDirectory: directories.has(uri) };
    },
    async readDirectoryAsync(uri) {
      const prefix = uri.endsWith('/') ? uri : `${uri}/`;
      return [...directories]
        .filter((entry) => entry.startsWith(prefix) && entry !== prefix)
        .map((entry) => entry.slice(prefix.length).replace(/\/$/, ''))
        .filter((entry) => entry && !entry.includes('/'));
    },
    async deleteAsync(uri) {
      for (const key of [...files.keys()]) if (key.startsWith(uri)) files.delete(key);
      for (const key of [...directories]) if (key.startsWith(uri)) directories.delete(key);
    },
  };
}

describe('ToolResultArtifactStore', () => {
  test('persists a result before its model-visible browser budget truncates it', async () => {
    const fs = memoryFileSystem();
    const store = new ToolResultArtifactStore({
      fileSystem: fs,
      now: () => 1_700_000_000_000,
      random: () => 'fixed',
    });
    store.beginSession();
    const original = `${'A'.repeat(13_000)}${'B'.repeat(13_000)}`;

    const replaced = await store.offloadIfNeeded('browser_use', 'toolu_1', {
      ok: true,
      data: original,
    }) as { ok: true; data: Record<string, unknown> };

    expect(replaced.data).toEqual(expect.objectContaining({
      contextOffloaded: true,
      tool: 'browser_use',
      callId: 'toolu_1',
      originalChars: original.length,
      path: '/tool-results/1700000000000-fixed/browser_use_toolu_1.txt',
    }));
    expect(String(replaced.data.preview)).toContain('[中间内容已省略]');
    expect([...fs.files.values()]).toEqual([original]);
  });

  test('keeps small and sensitive results inline', async () => {
    const fs = memoryFileSystem();
    const store = new ToolResultArtifactStore({ fileSystem: fs, random: () => 'fixed' });
    const small = { ok: true, data: 'short' };
    const sensitive = { ok: true, data: 'S'.repeat(30_000), sensitive: true };

    expect(await store.offloadIfNeeded('browser_use', 'toolu_1', small)).toBe(small);
    expect(await store.offloadIfNeeded('browser_use', 'toolu_2', sensitive)).toBe(sensitive);
    expect(fs.files.size).toBe(0);
  });

  test.each(['list_apps', 'read_skill', 'ui_screenshot'])(
    'keeps the complete %s result inline regardless of size',
    async (toolName) => {
      const fs = memoryFileSystem();
      const store = new ToolResultArtifactStore({ fileSystem: fs, random: () => 'fixed' });
      const content = `${toolName}:`.repeat(20_000);
      const result = { ok: true, data: content };

      expect(await store.offloadIfNeeded(toolName, 'toolu_full', result)).toBe(result);
      expect(truncateToolResult(content, toolName)).toBe(content);
      expect(fs.files.size).toBe(0);
    },
  );

  test('reads only retained tool-result artifacts with bounded pagination', async () => {
    const fs = memoryFileSystem();
    const store = new ToolResultArtifactStore({
      fileSystem: fs,
      now: () => 1_700_000_000_000,
      random: () => 'fixed',
    });
    store.beginSession();
    const original = '0123456789'.repeat(3_000);
    const replaced = await store.offloadIfNeeded('browser_use', 'toolu_page', {
      ok: true,
      data: original,
    }) as { ok: true; data: { path: string } };

    const first = await store.read({ path: replaced.data.path, offset: 5, limit: 20 }) as {
      ok: true;
      data: { content: string; nextOffset: number; hasMore: boolean; totalChars: number };
    };
    expect(first.data).toEqual(expect.objectContaining({
      content: original.slice(5, 25),
      nextOffset: 25,
      hasMore: true,
      totalChars: original.length,
    }));

    expect(await store.read({ path: '/../settings.json' })).toEqual(expect.objectContaining({
      ok: false,
      code: 'INVALID_ARGUMENT',
    }));
    expect(await store.read({ path: '/tool-results/1700000000000-fixed/../settings.json' }))
      .toEqual(expect.objectContaining({ ok: false, code: 'INVALID_ARGUMENT' }));
    expect(await store.read({ path: replaced.data.path, limit: FILE_READ_MAX_LIMIT + 1 }))
      .toEqual(expect.objectContaining({ ok: false, code: 'INVALID_ARGUMENT' }));
  });

  test('keeps full UI observations in the canonical event result', async () => {
    const fs = memoryFileSystem();
    const store = new ToolResultArtifactStore({ fileSystem: fs, random: () => 'fixed' });
    const result = await store.offloadIfNeeded('ui_inspect', 'toolu_tree', {
      ok: true,
      data: '树'.repeat(50_001),
    }) as { ok: true; data: string };
    expect(result.data).toBe('树'.repeat(50_001));
    expect(fs.files.size).toBe(0);
  });
});
