/** Default context capacity used when a model is not in the built-in map. */
export const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 128_000;
export const MIN_MODEL_CONTEXT_WINDOW_TOKENS = 4_096;
export const MAX_MODEL_CONTEXT_WINDOW_TOKENS = 4_000_000;

/**
 * Resolve common public model families without coupling the agent loop to
 * provider-specific names. More specific rules must stay ahead of broad ones.
 */
export function getKnownModelContextWindow(modelId?: string): number | undefined {
  const id = (modelId ?? '').trim().toLowerCase();
  if (!id) return undefined;

  if (id.includes('gemma') || id.includes('e2b') || id.includes('e4b')) return 8_192;

  if (/doubao[-_.]?seed[-_.]?2[-_.]?0/.test(id)) return 262_144;
  if (id.includes('doubao-lite-128k')) return 128_000;
  if (id.includes('doubao-lite-32k')) return 32_000;
  if (id.includes('doubao-lite-4k')) return 4_000;

  if (id.includes('claude')) return 200_000;
  if (id.includes('gemini')) return 1_000_000;

  if (id.includes('gpt-4.1')) return 1_047_576;
  if (id.includes('gpt-5.4')) return 1_050_000;
  if (id.includes('gpt-5')) return 400_000;
  if (id.includes('gpt-4o')) return 128_000;

  if (id.includes('qwen3.7') || id.includes('qwen3-7')) return 262_144;
  if (id.includes('qwen3-vl') || id.includes('qwen3-max')) return 256_000;
  if (id.includes('qwen')) return 128_000;
  if (id.includes('deepseek')) return 128_000;
  if (id.includes('glm-4.6') || id.includes('glm-4-6')) return 200_000;
  if (id.includes('kimi-k2')) return 256_000;
  if (id.includes('minimax-m2.5') || id.includes('minimax-m2-5')) return 200_000;

  return undefined;
}

export function resolveModelContextWindow(modelId?: string): number {
  return getKnownModelContextWindow(modelId) ?? DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
}

export function normalizeModelContextWindowTokens(
  value: unknown,
  modelId?: string,
): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  const fallback = resolveModelContextWindow(modelId);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(
    MIN_MODEL_CONTEXT_WINDOW_TOKENS,
    Math.min(MAX_MODEL_CONTEXT_WINDOW_TOKENS, Math.round(numeric)),
  );
}
