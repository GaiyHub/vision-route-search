const files = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///data/user/0/com.watchdog.agent/files/',
  EncodingType: { UTF8: 'utf8' },
  makeDirectoryAsync: jest.fn(async () => undefined),
  writeAsStringAsync: jest.fn(async (uri: string, content: string) => {
    files.set(uri, content);
  }),
}));

import {
  beginTodoFile,
  finalizeTodoFile,
  flushTodoFile,
  saveTodos,
} from '../todoFileStore';

describe('todoFileStore evaluation routing', () => {
  beforeEach(() => files.clear());

  test('writes only into the request artifact directory and flushes terminal state', async () => {
    const directory = 'file:///storage/emulated/0/Android/data/com.watchdog.agent/files/'
      + 'evaluation/run-1/sample-1/request-1';
    const traceId = 'a'.repeat(32);
    beginTodoFile(traceId, '执行评测', {
      outputDirectory: directory,
      evaluation: { requestId: 'request-1', runId: 'run-1', sampleId: 'sample-1' },
    });
    saveTodos([{
      id: 'todo-1',
      subject: '打开设置',
      description: '进入系统设置页',
      status: 'completed',
    }]);
    finalizeTodoFile('complete');
    await flushTodoFile();

    expect([...files.keys()]).toEqual([`${directory}/todo-${traceId}.json`]);
    expect(JSON.parse(files.values().next().value ?? '{}')).toMatchObject({
      traceId,
      goal: '执行评测',
      outcome: 'complete',
      source: 'EVALUATION',
      requestId: 'request-1',
      runId: 'run-1',
      sampleId: 'sample-1',
      todos: [{ subject: '打开设置', status: 'completed' }],
    });
  });
});
