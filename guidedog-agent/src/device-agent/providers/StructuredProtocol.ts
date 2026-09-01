import type {
  LLMMessage,
  ModelContent,
  ModelMessage,
  ModelResponse,
  ToolResult,
} from '../types';

function resultText(result: ToolResult): string {
  if (result.ok) {
    return typeof result.data === 'string'
      ? result.data
      : JSON.stringify(result.data ?? null);
  }
  return JSON.stringify({
    code: result.code,
    message: result.error,
    ...(result.details !== undefined ? { details: result.details } : {}),
  });
}

/** Render canonical history for a text-only/local provider. Tool calls use
 * the one public fallback syntax documented in the system prompt; the cloud
 * adapters never call this function. */
export function modelMessagesToLegacy(messages: ModelMessage[]): LLMMessage[] {
  return messages.map((message) => {
    const parts = message.content.map((item: ModelContent) => {
      if (item.type === 'text') return item.text;
      if (item.type === 'tool_call') {
        return `<tool_call>${JSON.stringify({
          name: item.name,
          arguments: item.arguments,
        })}</tool_call>`;
      }
      return `<tool_result tool_call_id="${item.callId}" is_error="${String(!item.result.ok)}">\n` +
        `${resultText(item.result)}\n</tool_result>`;
    });
    return { role: message.role, cache: message.cache, content: parts.filter(Boolean).join('\n\n') };
  });
}

export function legacyTextResponse(text: string): ModelResponse {
  return { content: text ? [{ type: 'text', text }] : [], finishReason: 'stop' };
}
