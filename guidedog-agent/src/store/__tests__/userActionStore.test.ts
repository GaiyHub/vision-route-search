import {
  cancelManualUserAction,
  completeManualUserAction,
  requestManualUserAction,
} from '../userActionStore';

afterEach(() => cancelManualUserAction());

test('manual user action resolves after completion', async () => {
  const pending = requestManualUserAction('点击搜索框');
  completeManualUserAction();
  await expect(pending).resolves.toEqual({ completed: true });
});

test('starting a new request cancels the previous gate', async () => {
  const first = requestManualUserAction('第一步');
  const second = requestManualUserAction('第二步');
  await expect(first).resolves.toEqual({ completed: false, cancelled: true });
  cancelManualUserAction();
  await expect(second).resolves.toEqual({ completed: false, cancelled: true });
});
