const deleteAsync = jest.fn(async () => undefined);

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///data/user/0/com.watchdog.agent/files/',
  deleteAsync,
}));

jest.mock('../chatStore', () => ({ clearMessages: jest.fn() }));
jest.mock('../historyStore', () => ({ clearSessions: jest.fn() }));

import { clearMessages } from '../chatStore';
import { clearSessions } from '../historyStore';
import { clearHistoricalContextAndLocalFiles } from '../contextCleanup';

describe('clearHistoricalContextAndLocalFiles', () => {
  beforeEach(() => jest.clearAllMocks());

  it('clears historical stores and only their local artifact directories', async () => {
    await clearHistoricalContextAndLocalFiles();

    expect(clearMessages).toHaveBeenCalledTimes(1);
    expect(clearSessions).toHaveBeenCalledTimes(1);
    expect(deleteAsync.mock.calls).toEqual([
      ['file:///data/user/0/com.watchdog.agent/files/tasklogs/', { idempotent: true }],
      ['file:///data/user/0/com.watchdog.agent/files/agent-tool-results/', { idempotent: true }],
      [
        'file:///storage/emulated/0/Android/data/com.watchdog.agent/files/tasklogs/',
        { idempotent: true },
      ],
    ]);
  });
});
