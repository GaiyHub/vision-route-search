/**
 * Tests for the risk-confirmation store: the gate must default to 'reject'
 * when the user never answers, and a settled gate must not be disturbed by a
 * late timeout.
 */

import {
  requestUserConfirm,
  resolveUserConfirm,
  subscribeConfirm,
} from '../confirmStore';
import type { PendingConfirm } from '../confirmStore';

describe('confirmStore risk-confirmation gate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Drain any pending state left by a previous test.
    resolveUserConfirm('reject');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('resolves with the user choice and clears the pending state', async () => {
    const pendingPromise = requestUserConfirm({ action: '点击「确认支付」', risk: 'high' });
    resolveUserConfirm('execute');
    await expect(pendingPromise).resolves.toBe('execute');
    const seen: Array<PendingConfirm | null> = [];
    subscribeConfirm((p) => seen.push(p));
    expect(seen[seen.length - 1]).toBeNull();
  });

  test('timeout defaults to reject and clears the pending state', async () => {
    const pendingPromise = requestUserConfirm({ action: '删除账号', risk: 'high' });
    jest.advanceTimersByTime(60_000);
    await expect(pendingPromise).resolves.toBe('reject');
    const seen: Array<PendingConfirm | null> = [];
    subscribeConfirm((p) => seen.push(p));
    expect(seen[seen.length - 1]).toBeNull();
  });

  test('a late timeout after the gate settled is a harmless no-op', async () => {
    const pendingPromise = requestUserConfirm({ action: '发送消息', risk: 'high' });
    resolveUserConfirm('execute');
    await expect(pendingPromise).resolves.toBe('execute');
    // The stale timer fires later — must not throw or mutate anything.
    jest.advanceTimersByTime(60_000);
    const seen: Array<PendingConfirm | null> = [];
    subscribeConfirm((p) => seen.push(p));
    expect(seen[seen.length - 1]).toBeNull();
  });
});
