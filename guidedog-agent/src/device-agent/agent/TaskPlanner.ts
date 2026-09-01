import type { AgentEvent, AgentOptions, LLMProviderInterface } from '../types';
import { AgentLoop } from './AgentLoop';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single step in a decomposed task plan.
 */
export interface SubTask {
  /** Zero-based position in the plan. */
  index: number;
  /** Natural-language description of what to do in this step. */
  description: string;
}

/**
 * Events emitted by TaskPlanner during planning and execution.
 */
export type PlannerEvent =
  | { type: 'plan'; subtasks: SubTask[] }
  | { type: 'subtask_start'; subtask: SubTask }
  | { type: 'subtask_complete'; subtask: SubTask; result: string }
  | { type: 'subtask_error'; subtask: SubTask; error: Error }
  | { type: 'agent_event'; subtask: SubTask; event: AgentEvent }
  | { type: 'complete'; result: string }
  | { type: 'error'; error: Error };

/**
 * Options for the task planner. Extends AgentOptions so the same provider
 * config is reused for both planning and execution.
 */
export interface TaskPlannerOptions extends AgentOptions {
  /**
   * Maximum number of subtasks to decompose a complex task into.
   * Default: 5.
   */
  maxSubTasks?: number;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const DECOMPOSE_PROMPT = `你是 Android 手机智能体的任务分解器。
给定一个高层次任务，把它拆成一个带编号的简单、具体子任务列表。
每个子任务必须能在一次简短的 agent 会话中完成（几次点击或滑动）。
只输出带编号的列表，每行一个子任务，不要输出其他内容。

输入示例: 设置一个明早 7 点的闹钟
输出示例:
1. 打开时钟应用
2. 进入闹钟标签页
3. 点击添加闹钟按钮，把时间设为 7:00
4. 保存闹钟`;

// ---------------------------------------------------------------------------
// TaskPlanner
// ---------------------------------------------------------------------------

/**
 * Decomposes a complex task into ordered subtasks and executes each one in
 * sequence using AgentLoop. Yields PlannerEvents so callers can stream
 * progress to the user.
 *
 * Usage:
 * ```ts
 * const planner = new TaskPlanner({ provider, maxSteps: 10, maxSubTasks: 5 });
 * for await (const event of planner.run('Send a WhatsApp message to Alice saying hi')) {
 *   if (event.type === 'plan') console.log('Plan:', event.subtasks);
 *   if (event.type === 'complete') console.log('Done:', event.result);
 * }
 * ```
 */
export class TaskPlanner {
  private options: TaskPlannerOptions & { maxSubTasks: number };
  private _aborted = false;
  private _currentLoop: AgentLoop | null = null;

  constructor(options: TaskPlannerOptions) {
    this.options = {
      ...options,
      maxSubTasks: options.maxSubTasks ?? 5,
    };
  }

  /**
   * Abort the currently-running subtask and prevent any further subtasks from
   * starting. Safe to call before, during, or after `run()`.
   */
  abort(): void {
    this._aborted = true;
    this._currentLoop?.abort();
  }

  /**
   * Run the planner for a given high-level task.
   *
   * Yields:
   *  - 'plan'             when the LLM has decomposed the task
   *  - 'subtask_start'    before each subtask begins
   *  - 'agent_event'      forwarding every AgentLoop event for the subtask
   *  - 'subtask_complete' when a subtask finishes successfully
   *  - 'subtask_error'    when a subtask fails (execution continues)
   *  - 'complete'         when all subtasks have been attempted
   *  - 'error'            if decomposition itself fails
   */
  async *run(task: string): AsyncGenerator<PlannerEvent> {
    this._aborted = false;

    // Step 1: Decompose into subtasks
    let subtasks: SubTask[];
    try {
      subtasks = await this.decompose(task, this.options.provider);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      yield { type: 'error', error };
      return;
    }

    // Fallback: run the whole task as one step if decomposition returned nothing
    if (subtasks.length === 0) {
      subtasks = [{ index: 0, description: task }];
    }

    // Seed the shared todo list with the decomposition so the plan stays
    // visible in every subtask prompt and can be tracked via todo_update.
    // The first subtask starts in_progress, the rest stay pending.
    if (this.options.todoList && subtasks.length > 0) {
      this.options.todoList.setItems(
        subtasks.map((s, i) => ({
          subject: s.description,
          description: `确认“${s.description}”已经完成`,
          status: i === 0 ? 'in_progress' : 'pending',
        })),
      );
    }

    yield { type: 'plan', subtasks };

    // Step 2: Execute each subtask sequentially, forwarding results as context
    const results: string[] = [];
    // Accumulated results from completed subtasks, injected into each subsequent
    // AgentLoop so the LLM knows what prior steps accomplished.
    const priorResults: Record<string, string> = {};

    for (const subtask of subtasks) {
      if (this._aborted) break;

      yield { type: 'subtask_start', subtask };

      const loop = new AgentLoop({
        ...this.options,
        context: { ...this.options.context, ...priorResults },
      });
      this._currentLoop = loop;
      let subtaskResult = '';
      let hadError = false;

      try {
        for await (const event of loop.run(subtask.description)) {
          yield { type: 'agent_event', subtask, event };

          if (event.type === 'complete') {
            subtaskResult = event.result;
          } else if (event.type === 'response') {
            subtaskResult = event.content;
          } else if (event.type === 'error') {
            hadError = true;
            yield { type: 'subtask_error', subtask, error: event.error };
            break;
          } else if (event.type === 'failed') {
            hadError = true;
            yield { type: 'subtask_error', subtask, error: new Error(event.reason) };
            break;
          } else if (event.type === 'timeout') {
            hadError = true;
            yield { type: 'subtask_error', subtask, error: new Error('Subtask timed out.') };
            break;
          } else if (event.type === 'max_steps_reached') {
            subtaskResult = `Step limit reached for: ${subtask.description}`;
          }
        }
      } catch (err) {
        hadError = true;
        const error = err instanceof Error ? err : new Error(String(err));
        yield { type: 'subtask_error', subtask, error };
      } finally {
        this._currentLoop = null;
      }

      if (!hadError && !this._aborted) {
        const result = subtaskResult || `Completed: ${subtask.description}`;
        results.push(result);
        priorResults[`Step ${subtask.index + 1} result`] = result;
        yield { type: 'subtask_complete', subtask, result };
      }
    }

    const finalResult = results.join(' ') || '所有子任务已完成。';
    yield { type: 'complete', result: finalResult };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async decompose(
    task: string,
    provider: LLMProviderInterface,
  ): Promise<SubTask[]> {
    const prompt = `${DECOMPOSE_PROMPT}\n\n任务: ${task}\n\n子任务:`;
    const response = await provider.generate(prompt);
    return this.parseSubTasks(response);
  }

  private parseSubTasks(response: string): SubTask[] {
    const lines = response
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const subtasks: SubTask[] = [];

    for (const line of lines) {
      // Match "1. Do something" or "1) Do something"
      const match = line.match(/^(\d+)[.)]\s+(.+)$/);
      if (match) {
        const index = parseInt(match[1]!, 10) - 1;
        const description = match[2]!.trim();
        if (description && subtasks.length < this.options.maxSubTasks) {
          subtasks.push({ index, description });
        }
      }
    }

    return subtasks;
  }
}
