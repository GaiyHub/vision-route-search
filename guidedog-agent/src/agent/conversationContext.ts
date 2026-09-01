import type { ChatMessage } from '../store/chatStore';
import type { ConversationMessage } from '../device-agent/types';

const MAX_CONTEXT_CHARS = 8_000;
const MAX_MESSAGE_CHARS = 1_200;
const DEFAULT_MAX_TURNS = 8;

/**
 * Build bounded cross-run context from the visible conversation. The latest
 * matching user message is the command about to be executed, so it is omitted
 * to avoid presenting the same instruction twice.
 */
export function buildConversationContext(
  messages: ChatMessage[],
  currentCommand: string,
  maxTurns = DEFAULT_MAX_TURNS,
): string | undefined {
  if (maxTurns <= 0) return undefined;
  let currentCommandIndex = -1;
  const normalizedCommand = currentCommand.trim();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && message.text.trim() === normalizedCommand) {
      currentCommandIndex = index;
      break;
    }
  }

  const eligible = messages.filter((message, index) => (
      index !== currentCommandIndex
      && !message.pending
      && message.kind === 'text'
      && (message.role === 'user' || message.role === 'agent')
      && message.text.trim().length > 0
  ));
  // A dialogue turn starts at each user message and includes the assistant
  // text that follows it until the next user message. This deliberately does
  // not use task boundaries: follow-ups and supplements are turns too.
  const turnIndices: number[] = [];
  eligible.forEach((message, index) => {
    if (message.role === 'user') turnIndices.push(index);
  });
  if (turnIndices.length === 0) return undefined;
  const boundedTurnCount = Math.max(1, Math.floor(maxTurns));
  const firstKeptTurn = turnIndices[Math.max(0, turnIndices.length - boundedTurnCount)];

  const lines = eligible
    .slice(firstKeptTurn)
    .map((message) => {
      const text = message.text.trim();
      const bounded = text.length > MAX_MESSAGE_CHARS
        ? `${text.slice(0, MAX_MESSAGE_CHARS - 1)}…`
        : text;
      return `${message.role === 'user' ? '用户' : '豆泡'}：${bounded}`;
    });

  const kept: string[] = [];
  let length = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const nextLength = length + line.length + (kept.length > 0 ? 1 : 0);
    if (nextLength > MAX_CONTEXT_CHARS) break;
    kept.unshift(line);
    length = nextLength;
  }

  return kept.length > 0 ? kept.join('\n') : undefined;
}

/**
 * Build protocol-neutral messages for a continuous conversation. Unlike the
 * legacy text renderer above, role boundaries and stable message ids survive
 * all the way into AgentLoop and its context-compression pipeline.
 */
export function buildConversationMessages(
  messages: ChatMessage[],
  currentCommand: string,
  maxTurns = DEFAULT_MAX_TURNS,
): ConversationMessage[] {
  if (maxTurns <= 0) return [];
  let currentCommandIndex = -1;
  const normalizedCommand = currentCommand.trim();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && message.text.trim() === normalizedCommand) {
      currentCommandIndex = index;
      break;
    }
  }

  const eligible = messages.filter((message, index) => (
    index !== currentCommandIndex
    && !message.pending
    && message.kind === 'text'
    && (message.role === 'user' || message.role === 'agent')
    && message.text.trim().length > 0
  ));
  const turnIndices: number[] = [];
  eligible.forEach((message, index) => {
    if (message.role === 'user') turnIndices.push(index);
  });
  if (turnIndices.length === 0) return [];
  const boundedTurnCount = Math.max(1, Math.floor(maxTurns));
  const firstKeptTurn = turnIndices[Math.max(0, turnIndices.length - boundedTurnCount)]!;
  const candidates: ConversationMessage[] = eligible.slice(firstKeptTurn).map((message) => ({
    id: message.id,
    role: message.role === 'user' ? 'user' : 'assistant',
    content: message.text.trim().length > MAX_MESSAGE_CHARS
      ? `${message.text.trim().slice(0, MAX_MESSAGE_CHARS - 1)}…`
      : message.text.trim(),
  }));

  const kept: ConversationMessage[] = [];
  let length = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]!;
    const nextLength = length + candidate.content.length + (kept.length > 0 ? 1 : 0);
    if (nextLength > MAX_CONTEXT_CHARS) break;
    kept.unshift(candidate);
    length = nextLength;
  }
  // A leading assistant message lacks the user turn it answers and can make
  // provider role alternation ambiguous after character-budget trimming.
  while (kept[0]?.role === 'assistant') kept.shift();
  return kept;
}
