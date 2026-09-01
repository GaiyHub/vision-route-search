import { TodoList } from '../agent/TodoList';

describe('TodoList', () => {
  test('starts empty', () => {
    const list = new TodoList();
    expect(list.isEmpty()).toBe(true);
    expect(list.getItems()).toEqual([]);
    expect(list.summarize()).toBe('共 0 项，已完成 0 项，进行中 0 项');
  });

  test('creates stable IDs and starts only the first item', () => {
    const list = new TodoList();
    list.createItems([
      { subject: '加入手机', description: '购物车中数量为1' },
      { subject: '加入辣条', description: '购物车中数量为5' },
    ]);
    expect(list.getItems()).toEqual([
      {
        id: '1',
        subject: '加入手机',
        description: '购物车中数量为1',
        status: 'in_progress',
      },
      {
        id: '2',
        subject: '加入辣条',
        description: '购物车中数量为5',
        status: 'pending',
      },
    ]);
  });

  test('applies updates by ID without rewriting other items', () => {
    const list = new TodoList();
    list.createItems([
      { subject: '甲', description: '甲完成' },
      { subject: '乙', description: '乙完成' },
    ]);
    list.applyUpdates([
      { todoId: '1', status: 'completed' },
      { todoId: '2', status: 'in_progress' },
    ]);
    expect(list.getItems().map(({ id, status }) => ({ id, status }))).toEqual([
      { id: '1', status: 'completed' },
      { id: '2', status: 'in_progress' },
    ]);
  });

  test('getItems returns a defensive copy', () => {
    const list = new TodoList();
    list.createItems([{ subject: '甲', description: '甲完成' }]);
    const items = list.getItems();
    items[0]!.status = 'completed';
    expect(list.getItems()[0]!.status).toBe('in_progress');
  });

  test('renderForPrompt includes IDs, status and acceptance criteria', () => {
    const list = new TodoList();
    list.createItems([
      { subject: '加入手机', description: '购物车中数量为1' },
      { subject: '加入辣条', description: '购物车中数量为5' },
    ]);
    expect(list.renderForPrompt()).toBe(
      '[todoId=1] [in_progress] 加入手机\n完成条件：购物车中数量为1\n\n' +
      '[todoId=2] [pending] 加入辣条\n完成条件：购物车中数量为5',
    );
  });

  test('status queries and allDone', () => {
    const list = new TodoList();
    list.setItems([
      { subject: '甲', status: 'completed' },
      { subject: '乙', status: 'cancelled' },
    ]);
    expect(list.hasInProgress()).toBe(false);
    expect(list.hasPending()).toBe(false);
    expect(list.allDone()).toBe(true);

    list.setItems([
      { subject: '甲', status: 'completed' },
      { subject: '乙', status: 'pending' },
    ]);
    expect(list.hasPending()).toBe(true);
    expect(list.allDone()).toBe(false);
  });

  test('markUpdated records the update step', () => {
    const list = new TodoList();
    expect(list.lastUpdateStep).toBe(-1);
    list.markUpdated(7);
    expect(list.lastUpdateStep).toBe(7);
  });
});
