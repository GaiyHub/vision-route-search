/** Result-level task tools inspired by Claude Code's TaskCreate/TaskUpdate split. */

import type { Tool } from '../types';
import type { TodoItem, TodoStatus } from '../agent/TodoList';
import { TODO_STATUSES, type TodoList } from '../agent/TodoList';

export const TODO_CREATE_TOOL_NAME = 'todo_create';
export const TODO_UPDATE_TOOL_NAME = 'todo_update';

export const TODO_CREATE_TOOL: Tool = {
  name: TODO_CREATE_TOOL_NAME,
  uiEffect: 'none',
  description:
    '为包含多个对象、多个可独立验证结果或三个以上有意义阶段的执行任务创建结果级清单。每项描述用户可感知的结果，并提供可由界面、数据或其他真实结果直接核对的完成条件；不记录点击、观察、输入等底层动作，单一简单目标无需创建。',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: '按执行顺序排列的初始清单；第一项自动设为 in_progress，其余为 pending',
        items: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: '简短、明确、可执行的结果标题' },
            description: {
              type: 'string',
              description: '可直接核对的完成条件；按目标写明对象、位置及关键状态、数量或结果，不得只写“已操作”或“已完成”',
            },
          },
          required: ['subject', 'description'],
        },
      },
    },
    required: ['todos'],
  },
};

export const TODO_UPDATE_TOOL: Tool = {
  name: TODO_UPDATE_TOOL_NAME,
  uiEffect: 'none',
  description:
    '按 todoId 批量更新已有清单项。开始处理时设为 in_progress；只有最新界面、数据或其他真实结果满足该项完成条件时才设为 completed。进度未变化时不要调用，同一时间最多一项为 in_progress。',
  parameters: {
    type: 'object',
    properties: {
      updates: {
        type: 'array',
        description: '需要原子应用的清单项更新；可同时完成上一项并开始下一项',
        items: {
          type: 'object',
          properties: {
            todoId: {
              type: 'string',
              description: '当前任务清单中 todoId= 后显示的值，例如 1',
            },
            status: {
              type: 'string',
              description: '目标状态',
              enum: [...TODO_STATUSES],
            },
            subject: { type: 'string', description: '可选的新标题' },
            description: { type: 'string', description: '可选的新完成条件' },
          },
          required: ['todoId'],
        },
      },
    },
    required: ['updates'],
  },
};

export interface TodoToolResult {
  ok: boolean;
  summary?: string;
  todos?: TodoItem[];
  error?: string;
}

type TodoChanged = (items: TodoItem[]) => void;

export function createTodoCreateHandler(
  todoList: TodoList,
  onUpdate?: TodoChanged,
): (args: Record<string, unknown>) => Promise<TodoToolResult> {
  return async (args): Promise<TodoToolResult> => {
    if (!todoList.isEmpty()) {
      return { ok: false, error: '任务清单已存在，请使用 todo_update 更新进度。' };
    }
    const raw = args.todos;
    if (!Array.isArray(raw) || raw.length === 0) {
      return { ok: false, error: '参数 todos 必须是非空数组。' };
    }

    const items: Array<{ subject: string; description: string }> = [];
    for (const rawEntry of raw) {
      const entry = rawEntry as Record<string, unknown> | null | undefined;
      if (!entry || typeof entry !== 'object') {
        return { ok: false, error: '每个事项必须是对象。' };
      }
      const subject = typeof entry.subject === 'string' ? entry.subject.trim() : '';
      const description =
        typeof entry.description === 'string' ? entry.description.trim() : '';
      if (!subject || !description) {
        return { ok: false, error: '每个事项都必须包含非空的 subject 和 description。' };
      }
      items.push({ subject, description });
    }

    const created = todoList.createItems(items);
    onUpdate?.(created);
    return { ok: true, summary: todoList.summarize(), todos: created };
  };
}

export function createTodoUpdateHandler(
  todoList: TodoList,
  onUpdate?: TodoChanged,
): (args: Record<string, unknown>) => Promise<TodoToolResult> {
  return async (args): Promise<TodoToolResult> => {
    if (todoList.isEmpty()) {
      return { ok: false, error: '当前没有任务清单，请先使用 todo_create。' };
    }
    const raw = args.updates;
    if (!Array.isArray(raw) || raw.length === 0) {
      return { ok: false, error: '参数 updates 必须是非空数组。' };
    }

    const currentItems = todoList.getItems();
    const seen = new Set<string>();
    const updates: Array<{
      todoId: string;
      status?: TodoStatus;
      subject?: string;
      description?: string;
    }> = [];
    for (const rawEntry of raw) {
      const entry = rawEntry as Record<string, unknown> | null | undefined;
      if (!entry || typeof entry !== 'object') {
        return { ok: false, error: '每项更新必须是对象。' };
      }
      const rawTodoId = typeof entry.todoId === 'string' ? entry.todoId.trim() : '';
      // Older prompt renders used headings such as "#1" even though the
      // canonical ID was "1". Accept that historical spelling so an active
      // conversation can recover, while new prompts expose todoId explicitly.
      const todoId = normalizeTodoId(rawTodoId, todoList);
      if (!todoId || !todoList.hasId(todoId)) {
        return { ok: false, error: `不存在 todoId "${rawTodoId || '?'}"。` };
      }
      if (seen.has(todoId)) {
        return { ok: false, error: `todoId "${todoId}" 在同一次更新中重复。` };
      }
      seen.add(todoId);

      const status = entry.status;
      if (status !== undefined && !TODO_STATUSES.includes(status as TodoStatus)) {
        return {
          ok: false,
          error: `非法状态 "${String(status)}"。允许值：${TODO_STATUSES.join('/')}`,
        };
      }
      const subject = optionalNonEmptyString(entry.subject);
      const description = optionalNonEmptyString(entry.description);
      if (subject === null || description === null) {
        return { ok: false, error: 'subject 和 description 如果提供，必须是非空字符串。' };
      }
      if (status === undefined && subject === undefined && description === undefined) {
        return { ok: false, error: `todoId "${todoId}" 没有提供任何要更新的字段。` };
      }
      updates.push({
        todoId,
        status: status as TodoStatus | undefined,
        subject: subject ?? undefined,
        description: description ?? undefined,
      });
    }

    const draft = currentItems.map((item) => {
      const update = updates.find((candidate) => candidate.todoId === item.id);
      return update
        ? {
            ...item,
            status: update.status ?? item.status,
            subject: update.subject ?? item.subject,
            description: update.description ?? item.description,
          }
        : item;
    });
    if (draft.filter((item) => item.status === 'in_progress').length > 1) {
      return { ok: false, error: '同一时间至多只能有 1 项 in_progress。' };
    }

    const changed = updates.some((update) => {
      const current = currentItems.find((item) => item.id === update.todoId)!;
      return (
        (update.status !== undefined && update.status !== current.status) ||
        (update.subject !== undefined && update.subject !== current.subject) ||
        (update.description !== undefined && update.description !== current.description)
      );
    });
    if (!changed) {
      return { ok: true, summary: `${todoList.summarize()}，无变化`, todos: currentItems };
    }

    const next = todoList.applyUpdates(updates);
    onUpdate?.(next);
    return { ok: true, summary: todoList.summarize(), todos: next };
  };
}

function optionalNonEmptyString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim();
}

function normalizeTodoId(rawTodoId: string, todoList: TodoList): string {
  if (todoList.hasId(rawTodoId)) return rawTodoId;
  if (rawTodoId.startsWith('#')) {
    const withoutHeadingMarker = rawTodoId.slice(1).trim();
    if (todoList.hasId(withoutHeadingMarker)) return withoutHeadingMarker;
  }
  return rawTodoId;
}
