import { buildConversationContext, buildConversationMessages } from '../conversationContext';
import type { ChatMessage } from '../../store/chatStore';

function message(
  role: ChatMessage['role'],
  text: string,
  options: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: `${role}-${text}`,
    role,
    kind: 'text',
    text,
    timestamp: 1,
    ...options,
  };
}

describe('buildConversationContext', () => {
  it('keeps prior user/assistant turns and excludes the current command', () => {
    const result = buildConversationContext([
      message('user', '打开天气'),
      message('agent', '今天晴，25℃'),
      message('user', '那明天呢'),
    ], '那明天呢');

    expect(result).toBe('用户：打开天气\n豆泡：今天晴，25℃');
  });

  it('keeps continuous dialogue as role-preserving structured messages', () => {
    const result = buildConversationMessages([
      message('user', '打开天气'),
      message('agent', '今天晴，25℃'),
      message('user', '那明天呢'),
    ], '那明天呢');

    expect(result).toEqual([
      { id: 'user-打开天气', role: 'user', content: '打开天气' },
      { id: 'agent-今天晴，25℃', role: 'assistant', content: '今天晴，25℃' },
    ]);
  });

  it('ignores pending, tool-like display messages and empty sessions', () => {
    const result = buildConversationContext([
      message('agent', 'Thinking...', { pending: true }),
      message('agent', '点击按钮', { kind: 'action' }),
      message('user', '新任务'),
    ], '新任务');

    expect(result).toBeUndefined();
  });

  it('bounds old conversation content while retaining recent turns', () => {
    const messages = Array.from({ length: 30 }, (_, index) => (
      message(index % 2 === 0 ? 'user' : 'agent', `${index}-${'x'.repeat(1500)}`)
    ));
    const result = buildConversationContext(messages, 'next') ?? '';

    expect(result.length).toBeLessThanOrEqual(8_000);
    expect(result).toContain('29-');
    expect(result).not.toContain('0-');
  });

  it('limits prior dialogue turns rather than root tasks', () => {
    const result = buildConversationContext([
      message('user', '任务一'),
      message('agent', '结果一'),
      message('user', '补充一'),
      message('agent', '收到补充'),
      message('user', '本轮问题'),
    ], '本轮问题', 1);

    expect(result).toBe('用户：补充一\n豆泡：收到补充');
  });

  it('can disable cross-task context', () => {
    expect(buildConversationContext([
      message('user', '任务一'),
      message('agent', '结果一'),
      message('user', '任务二'),
    ], '任务二', 0)).toBeUndefined();
  });
});
