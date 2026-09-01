import type { ToolCall } from '../types';

/**
 * Parses LLM text output into structured tool calls.
 *
 * Supports multiple output formats:
 * - Native function calling (structured JSON from model -- top-level array or object)
 * - XML-style tool tags: <tool_call>{"name": "ui_tap", "arguments": {...}}</tool_call>
 * - Legacy history tags: <tool_use name="ui_tap">{...arguments...}</tool_use>
 * - JSON code blocks in markdown: ```json\n{"name": ..., "arguments": ...}```
 * - Bare JSON objects/arrays anywhere in the text
 */
export class ToolParser {
  /**
   * Parse one or more tool calls from raw LLM output.
   *
   * Tries each parsing strategy in order, returning the first successful result.
   * Returns an empty array if no tool calls are found.
   *
   * @param output - Raw text response from the LLM
   * @returns Array of parsed tool calls
   */
  static parse(output: string): ToolCall[] {
    if (!output || typeof output !== 'string') return [];

    // 1. XML-style <tool_call> tags
    const fromXml = ToolParser.parseXmlTags(output);
    if (fromXml.length > 0) return fromXml;

    // 2. Legacy Claude-style history tags. Older AgentLoop versions exposed
    // these tags to the model, so accepting them remains necessary while old
    // conversations and text-only providers are still supported.
    const fromToolUse = ToolParser.parseToolUseTags(output);
    if (fromToolUse.length > 0) return fromToolUse;

    // 3. Markdown JSON code blocks
    const fromCodeBlock = ToolParser.parseCodeBlocks(output);
    if (fromCodeBlock.length > 0) return fromCodeBlock;

    // 4. Bare JSON anywhere in the text
    const fromJson = ToolParser.parseJsonObjects(output);
    if (fromJson.length > 0) return fromJson;

    return [];
  }

  /**
   * Validate that a tool call matches its schema.
   *
   * @param call - The parsed tool call
   * @param schema - The tool's parameter schema (ToolParameters shape)
   * @returns True if the call is valid
   */
  static validate(call: ToolCall, schema: unknown): boolean {
    if (!call.name || typeof call.name !== 'string') return false;
    if (!call.arguments || typeof call.arguments !== 'object') return false;

    if (!schema || typeof schema !== 'object') return true;
    const params = schema as { required?: string[]; properties?: Record<string, unknown> };
    const required = params.required ?? [];

    for (const key of required) {
      if (!(key in call.arguments) || call.arguments[key] === undefined) {
        return false;
      }
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Private parsing strategies
  // ---------------------------------------------------------------------------

  /**
   * Parse <tool_call>...</tool_call> XML tags.
   * Each tag should contain a JSON object with "name" and "arguments" keys.
   */
  private static parseXmlTags(output: string): ToolCall[] {
    const calls: ToolCall[] = [];
    const tagPattern = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
    let match: RegExpExecArray | null;

    while ((match = tagPattern.exec(output)) !== null) {
      const content = match[1].trim();
      const call = ToolParser.tryParseToolCallJson(content);
      if (call) calls.push(call);
    }

    return calls;
  }

  private static parseToolUseTags(output: string): ToolCall[] {
    const calls: ToolCall[] = [];
    const tagPattern = /<tool_use\b([^>]*)>([\s\S]*?)<\/tool_use>/gi;
    let match: RegExpExecArray | null;

    while ((match = tagPattern.exec(output)) !== null) {
      const nameMatch = /\bname\s*=\s*(["'])(.*?)\1/i.exec(match[1]);
      const name = nameMatch?.[2]
        ?.replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim();
      if (!name) continue;
      try {
        const args = JSON.parse(match[2].trim());
        if (args && typeof args === 'object' && !Array.isArray(args)) {
          calls.push({ name, arguments: args as Record<string, unknown> });
        }
      } catch {
        // Malformed/incomplete wrappers are handled by AgentLoop's fragment
        // guard and must never be interpreted as terminal prose.
      }
    }

    return calls;
  }

  /**
   * Parse JSON code blocks: ```json ... ``` or ``` ... ```
   */
  private static parseCodeBlocks(output: string): ToolCall[] {
    const calls: ToolCall[] = [];
    const blockPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;

    while ((match = blockPattern.exec(output)) !== null) {
      const content = match[1].trim();
      const call = ToolParser.tryParseToolCallJson(content);
      if (call) {
        calls.push(call);
      } else {
        // Could be an array of calls
        const arr = ToolParser.tryParseArray(content);
        calls.push(...arr);
      }
    }

    return calls;
  }

  /**
   * Scan the entire text for JSON objects that look like tool calls.
   * Handles both single objects and arrays of objects.
   */
  private static parseJsonObjects(output: string): ToolCall[] {
    const calls: ToolCall[] = [];

    // Find all top-level JSON objects or arrays
    const candidates = ToolParser.extractJsonCandidates(output);

    for (const candidate of candidates) {
      const call = ToolParser.tryParseToolCallJson(candidate);
      if (call) {
        calls.push(call);
        continue;
      }
      const arr = ToolParser.tryParseArray(candidate);
      calls.push(...arr);
    }

    return calls;
  }

  /**
   * Extract substrings that look like complete JSON objects or arrays.
   */
  private static extractJsonCandidates(text: string): string[] {
    const results: string[] = [];
    let i = 0;

    while (i < text.length) {
      const ch = text[i];
      if (ch === '{' || ch === '[') {
        const end = ToolParser.findMatchingBracket(text, i);
        if (end !== -1) {
          results.push(text.slice(i, end + 1));
          i = end + 1;
          continue;
        }
      }
      i++;
    }

    return results;
  }

  /**
   * Find the index of the bracket that closes the one at `start`.
   */
  private static findMatchingBracket(text: string, start: number): number {
    const open = text[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return i;
      }
    }

    return -1;
  }

  /**
   * Try to parse a string as a tool call JSON object.
   * Accepts objects with {name, arguments} or {name, args} or {tool, arguments}.
   */
  private static tryParseToolCallJson(text: string): ToolCall | null {
    try {
      const obj = JSON.parse(text);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

      const name: unknown = obj.name ?? obj.tool;
      const args: unknown = obj.arguments ?? obj.args ?? obj.parameters ?? {};

      if (typeof name !== 'string' || !name) return null;
      if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;

      return {
        name,
        arguments: args as Record<string, unknown>,
        ...(ToolParser.parseArgumentError(obj.argumentParseError)),
      };
    } catch {
      return null;
    }
  }

  /**
   * Try to parse a string as a JSON array of tool calls.
   */
  private static tryParseArray(text: string): ToolCall[] {
    try {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) return [];

      const calls: ToolCall[] = [];
      for (const item of arr) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const name: unknown = item.name ?? item.tool;
        const args: unknown = item.arguments ?? item.args ?? item.parameters ?? {};
        if (typeof name !== 'string' || !name) continue;
        if (typeof args !== 'object' || args === null || Array.isArray(args)) continue;
        calls.push({
          name,
          arguments: args as Record<string, unknown>,
          ...(ToolParser.parseArgumentError(item.argumentParseError)),
        });
      }
      return calls;
    } catch {
      return [];
    }
  }

  private static parseArgumentError(value: unknown): Pick<ToolCall, 'argumentParseError'> | object {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const error = value as Record<string, unknown>;
    if (
      error.code !== 'MALFORMED_TOOL_ARGUMENTS' ||
      typeof error.message !== 'string' ||
      typeof error.rawArgumentsPreview !== 'string'
    ) return {};
    return {
      argumentParseError: {
        code: 'MALFORMED_TOOL_ARGUMENTS',
        message: error.message,
        rawArgumentsPreview: error.rawArgumentsPreview,
      },
    };
  }
}
