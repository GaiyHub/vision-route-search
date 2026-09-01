/**
 * The `read_skill` tool (Anthropic Agent Skills style).
 *
 * The host maintains an experience library of SKILL.md documents. Their
 * metadata (name + description) is injected into the system prompt as a
 * catalog; the model loads a skill's full body on demand through this tool.
 * Validation happens in the handler and returns `{ error }` (instead of
 * throwing) so a bad call never aborts the agent loop — the model just sees
 * the error message and retries.
 */

import type { Tool } from '../types';

export const READ_SKILL_TOOL_NAME = 'read_skill';

export const READ_SKILL_TOOL: Tool = {
  name: READ_SKILL_TOOL_NAME,
  uiEffect: 'none',
  description:
    '按名称加载一条可用经验的完整文档，适合当前任务与经验目录描述匹配时。同一经验在当前任务内无需重复加载。',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: '要加载的经验名称（见 system 提示词「可用经验」列表中的 name）',
      },
    },
    required: ['name'],
  },
};

export interface ReadSkillResult {
  ok: boolean;
  name: string;
  /** Full SKILL.md body on success. */
  content?: string;
  error?: string;
}

/**
 * Builds the execution handler for `read_skill`. Delegates the actual
 * document loading to the host-injected [load] function (the core loop never
 * touches storage); a missing skill yields `{ ok: false, error }` so the
 * model can fall back to autonomous exploration.
 */
export function createReadSkillHandler(
  load: (name: string) => Promise<string | null>,
): (args: Record<string, unknown>) => Promise<ReadSkillResult> {
  return async (args: Record<string, unknown>): Promise<ReadSkillResult> => {
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    if (!name) {
      return { ok: false, name, error: '参数 name 不能为空' };
    }
    try {
      const content = await load(name);
      if (!content) {
        return { ok: false, name, error: `未找到名为「${name}」的经验，请检查名称或直接自主探索` };
      }
      return { ok: true, name, content };
    } catch (e) {
      return {
        ok: false,
        name,
        error: `加载经验失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  };
}
