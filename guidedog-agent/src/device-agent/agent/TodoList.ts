/** Result-level task list maintained through todo_create and todo_update. */

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export const TODO_STATUSES: readonly TodoStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'cancelled',
];

export interface TodoItem {
  id: string;
  subject: string;
  description: string;
  status: TodoStatus;
}

/** Compatibility input used by the optional planner and focused tests. */
export interface TodoSeedItem {
  id?: string;
  subject?: string;
  content?: string;
  description?: string;
  status: TodoStatus;
}

export class TodoList {
  private items: TodoItem[] = [];
  /** The loop step at which the list was last updated (-1 = never). */
  private _lastUpdateStep = -1;

  /** Seeds/replaces the list for the optional planner path. */
  setItems(items: TodoSeedItem[]): void {
    let nextId = 1;
    this.items = items.map((item) => {
      const subject = (item.subject ?? item.content ?? '').trim();
      const id = item.id?.trim() || String(nextId);
      const numericId = Number(id);
      nextId = Number.isInteger(numericId) && numericId >= nextId
        ? numericId + 1
        : nextId + 1;
      return {
        id,
        subject,
        description: item.description?.trim() || `确认“${subject}”已经完成`,
        status: item.status,
      };
    });
  }

  /** Creates a fresh list. The first result starts in progress. */
  createItems(items: Array<{ subject: string; description: string }>): TodoItem[] {
    this.items = items.map((item, index) => ({
      id: String(index + 1),
      subject: item.subject.trim(),
      description: item.description.trim(),
      status: index === 0 ? 'in_progress' : 'pending',
    }));
    return this.getItems();
  }

  /** Applies an already validated atomic patch set. */
  applyUpdates(
    updates: Array<{
      todoId: string;
      status?: TodoStatus;
      subject?: string;
      description?: string;
    }>,
  ): TodoItem[] {
    const byId = new Map(updates.map((update) => [update.todoId, update]));
    this.items = this.items.map((item) => {
      const update = byId.get(item.id);
      if (!update) return item;
      return {
        ...item,
        subject: update.subject ?? item.subject,
        description: update.description ?? item.description,
        status: update.status ?? item.status,
      };
    });
    return this.getItems();
  }

  getItems(): TodoItem[] {
    return this.items.map((item) => ({ ...item }));
  }

  hasId(id: string): boolean {
    return this.items.some((item) => item.id === id);
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  hasInProgress(): boolean {
    return this.items.some((item) => item.status === 'in_progress');
  }

  hasPending(): boolean {
    return this.items.some((item) => item.status === 'pending');
  }

  allDone(): boolean {
    return this.items.every(
      (item) => item.status === 'completed' || item.status === 'cancelled',
    );
  }

  summarize(): string {
    const total = this.items.length;
    const completed = this.items.filter((item) => item.status === 'completed').length;
    const inProgress = this.items.filter((item) => item.status === 'in_progress').length;
    return `共 ${total} 项，已完成 ${completed} 项，进行中 ${inProgress} 项`;
  }

  renderForPrompt(): string {
    return this.items
      .map(
        (item) =>
          `[todoId=${item.id}] [${item.status}] ${item.subject}\n完成条件：${item.description}`,
      )
      .join('\n\n');
  }

  markUpdated(step: number): void {
    this._lastUpdateStep = step;
  }

  get lastUpdateStep(): number {
    return this._lastUpdateStep;
  }
}
