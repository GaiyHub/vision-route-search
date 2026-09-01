import {
  MESSAGE_SUBMIT_DEBOUNCE_MS,
  MessageSubmitGuard,
} from '../MessageSubmitGuard';

describe('MessageSubmitGuard', () => {
  it('rejects submissions while the first one is still in flight', () => {
    const guard = new MessageSubmitGuard();

    expect(guard.tryAcquire('发送消息', 1_000)).toBe(true);
    expect(guard.tryAcquire('另一条消息', 1_100)).toBe(false);
  });

  it('rejects the same normalized text during the debounce window', () => {
    const guard = new MessageSubmitGuard();

    expect(guard.tryAcquire(' 发送消息 ', 1_000)).toBe(true);
    guard.release();
    expect(guard.tryAcquire('发送消息', 1_100)).toBe(false);
  });

  it('accepts different text or the same text after the debounce window', () => {
    const guard = new MessageSubmitGuard();

    expect(guard.tryAcquire('第一条', 1_000)).toBe(true);
    guard.release();
    expect(guard.tryAcquire('第二条', 1_100)).toBe(true);
    guard.release();
    expect(guard.tryAcquire('第二条', 1_100 + MESSAGE_SUBMIT_DEBOUNCE_MS)).toBe(true);
  });
});
