import {
  CLARIFICATION_MAX_LENGTH,
  cancelUserClarification,
  requestUserClarification,
  submitUserClarification,
  subscribeClarification,
} from '../clarificationStore';

afterEach(() => cancelUserClarification());

test('publishes the question and resolves with the trimmed answer', async () => {
  const snapshots: Array<string | null> = [];
  const unsubscribe = subscribeClarification((pending) => snapshots.push(pending?.question ?? null));
  const resultPromise = requestUserClarification({ question: '你想发送给谁？', placeholder: '联系人' });
  expect(snapshots[snapshots.length - 1]).toBe('你想发送给谁？');
  expect(submitUserClarification('  妈妈  ')).toEqual({ ok: true });
  await expect(resultPromise).resolves.toEqual({ answered: true, answer: '妈妈' });
  expect(snapshots[snapshots.length - 1]).toBeNull();
  unsubscribe();
});

test('rejects empty and over-limit answers without settling the gate', async () => {
  let settled = false;
  const resultPromise = requestUserClarification({ question: '请补充信息' });
  void resultPromise.then(() => { settled = true; });
  expect(submitUserClarification('   ')).toEqual({ ok: false, error: 'empty' });
  expect(submitUserClarification('x'.repeat(CLARIFICATION_MAX_LENGTH + 1))).toEqual({
    ok: false,
    error: 'too_long',
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  cancelUserClarification();
  await expect(resultPromise).resolves.toEqual({ answered: false, cancelled: true });
});

test('a new request cancels the previous pending request', async () => {
  const first = requestUserClarification({ question: '第一个问题' });
  const second = requestUserClarification({ question: '第二个问题' });
  await expect(first).resolves.toEqual({ answered: false, cancelled: true });
  cancelUserClarification();
  await expect(second).resolves.toEqual({ answered: false, cancelled: true });
});
