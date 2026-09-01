import { TodoList } from '../agent/TodoList';
import {
  TODO_CREATE_TOOL,
  TODO_CREATE_TOOL_NAME,
  TODO_UPDATE_TOOL,
  TODO_UPDATE_TOOL_NAME,
  createTodoCreateHandler,
  createTodoUpdateHandler,
} from '../tools/TodoTool';

describe('todo tools', () => {
  test('schemas separate creation from ID-based updates', () => {
    expect(TODO_CREATE_TOOL.name).toBe(TODO_CREATE_TOOL_NAME);
    expect(TODO_CREATE_TOOL.parameters.required).toEqual(['todos']);
    const createItem = TODO_CREATE_TOOL.parameters.properties.todos.items!;
    expect(createItem.required).toEqual(['subject', 'description']);

    expect(TODO_UPDATE_TOOL.name).toBe(TODO_UPDATE_TOOL_NAME);
    expect(TODO_UPDATE_TOOL.parameters.required).toEqual(['updates']);
    const updateItem = TODO_UPDATE_TOOL.parameters.properties.updates.items!;
    expect(updateItem.required).toEqual(['todoId']);
    expect(updateItem.properties!.status.enum).toEqual([
      'pending',
      'in_progress',
      'completed',
      'cancelled',
    ]);
  });

  test('creates a list once, assigns IDs and persists it', async () => {
    const list = new TodoList();
    const persisted: unknown[] = [];
    const create = createTodoCreateHandler(list, (items) => persisted.push(items));
    const result = await create({
      todos: [
        { subject: '加入手机', description: '数量为1' },
        { subject: '加入辣条', description: '数量为5' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.todos?.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: '1', status: 'in_progress' },
      { id: '2', status: 'pending' },
    ]);
    expect(persisted).toHaveLength(1);

    const duplicate = await create({
      todos: [{ subject: '重复', description: '不应创建' }],
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.error).toContain('已存在');
  });

  test('rejects malformed creation without mutating the list', async () => {
    const list = new TodoList();
    const create = createTodoCreateHandler(list);
    expect((await create({ todos: [] })).ok).toBe(false);
    expect((await create({ todos: [{ subject: '甲', description: '' }] })).ok).toBe(false);
    expect(list.isEmpty()).toBe(true);
  });

  test('atomically completes one item and starts the next', async () => {
    const list = new TodoList();
    list.createItems([
      { subject: '甲', description: '甲完成' },
      { subject: '乙', description: '乙完成' },
    ]);
    const persisted: unknown[] = [];
    const update = createTodoUpdateHandler(list, (items) => persisted.push(items));
    const result = await update({
      updates: [
        { todoId: '1', status: 'completed' },
        { todoId: '2', status: 'in_progress' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(list.getItems().map(({ id, status }) => ({ id, status }))).toEqual([
      { id: '1', status: 'completed' },
      { id: '2', status: 'in_progress' },
    ]);
    expect(persisted).toHaveLength(1);
  });

  test('accepts legacy heading-style IDs from existing conversation history', async () => {
    const list = new TodoList();
    list.createItems([
      { subject: '甲', description: '甲完成' },
      { subject: '乙', description: '乙完成' },
    ]);
    const update = createTodoUpdateHandler(list);
    const result = await update({
      updates: [
        { todoId: '#1', status: 'completed' },
        { todoId: '#2', status: 'in_progress' },
      ],
    });

    expect(result.ok).toBe(true);
    expect(list.getItems().map(({ id, status }) => ({ id, status }))).toEqual([
      { id: '1', status: 'completed' },
      { id: '2', status: 'in_progress' },
    ]);
  });

  test('rejects unknown IDs, duplicate IDs and multiple active items atomically', async () => {
    const list = new TodoList();
    list.createItems([
      { subject: '甲', description: '甲完成' },
      { subject: '乙', description: '乙完成' },
    ]);
    const before = list.getItems();
    const update = createTodoUpdateHandler(list);

    expect((await update({ updates: [{ todoId: '9', status: 'completed' }] })).ok).toBe(false);
    expect((await update({
      updates: [
        { todoId: '1', status: 'pending' },
        { todoId: '1', status: 'completed' },
      ],
    })).ok).toBe(false);
    expect((await update({ updates: [{ todoId: '2', status: 'in_progress' }] })).ok).toBe(false);
    expect(list.getItems()).toEqual(before);
  });

  test('no-op update succeeds without persistence churn', async () => {
    const list = new TodoList();
    list.createItems([{ subject: '甲', description: '甲完成' }]);
    let persisted = 0;
    const update = createTodoUpdateHandler(list, () => persisted++);
    const result = await update({ updates: [{ todoId: '1', status: 'in_progress' }] });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('无变化');
    expect(persisted).toBe(0);
  });
});
