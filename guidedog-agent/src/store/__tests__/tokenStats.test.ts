jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// tokenStats keeps its state in module-level variables (a singleton),
// so each test gets a fresh module instance rather than sharing state.
let store: typeof import('../tokenStats');

beforeEach(() => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  store = require('../tokenStats');
});

describe('tokenStats', () => {
  it('accumulates prompt/completion/cached into task and global counters', () => {
    store.addTokens(100, 20, 80);
    store.addTokens(150, 30, 120);

    const task = store.getTaskTokens();
    expect(task.prompt).toBe(250);
    expect(task.completion).toBe(50);
    expect(task.cached).toBe(200);
    expect(task.total).toBe(300);

    const global = store.getGlobalTokens();
    expect(global.prompt).toBe(250);
    expect(global.completion).toBe(50);
    expect(global.cached).toBe(200);
    expect(global.total).toBe(300);
  });

  it('treats missing cached as zero (legacy two-arg calls)', () => {
    store.addTokens(100, 20);
    expect(store.getTaskTokens().cached).toBe(0);
  });

  it('calculates cache hit rate against prompt tokens only', () => {
    expect(store.getPromptCacheHitRate({ prompt: 100, cached: 80 })).toBe(0.8);
    expect(store.getPromptCacheHitRate({ prompt: 0, cached: 80 })).toBe(0);
    expect(store.getPromptCacheHitRate({ prompt: 100, cached: 120 })).toBe(1);
  });

  it('clamps negative/NaN inputs to zero', () => {
    store.addTokens(-5, NaN, -3);
    const t = store.getTaskTokens();
    expect(t.prompt).toBe(0);
    expect(t.completion).toBe(0);
    expect(t.cached).toBe(0);
    expect(t.total).toBe(0);
  });

  it('resetTaskTokens clears only the task counter', () => {
    store.addTokens(100, 20, 50);
    store.resetTaskTokens();

    const task = store.getTaskTokens();
    expect(task.total).toBe(0);
    expect(task.cached).toBe(0);

    const global = store.getGlobalTokens();
    expect(global.total).toBe(120);
    expect(global.cached).toBe(50);
  });

  it('notifies subscribers on every mutation', () => {
    const listener = jest.fn();
    store.subscribeTokenStats(listener);

    store.addTokens(10, 5, 8);
    expect(listener).toHaveBeenCalledTimes(1);

    store.resetTaskTokens();
    expect(listener).toHaveBeenCalledTimes(2);

    const unsub = store.subscribeTokenStats(listener);
    unsub();
  });
});
