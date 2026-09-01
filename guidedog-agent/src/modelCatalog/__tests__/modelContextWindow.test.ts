import {
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  normalizeModelContextWindowTokens,
  resolveModelContextWindow,
} from '../modelContextWindow';

describe('model context-window policy', () => {
  it('maps common model families before falling back', () => {
    expect(resolveModelContextWindow('doubao-seed-2.0-lite-260215')).toBe(262_144);
    expect(resolveModelContextWindow('claude-sonnet-4-6')).toBe(200_000);
    expect(resolveModelContextWindow('gemini-2.5-flash')).toBe(1_000_000);
  });

  it('uses 128K for unknown and empty model identifiers', () => {
    expect(resolveModelContextWindow('vendor/private-model')).toBe(
      DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
    );
    expect(resolveModelContextWindow('')).toBe(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS);
  });

  it('accepts and bounds a user override', () => {
    expect(normalizeModelContextWindowTokens('96000', 'unknown')).toBe(96_000);
    expect(normalizeModelContextWindowTokens(1, 'unknown')).toBe(4_096);
    expect(normalizeModelContextWindowTokens(Number.NaN, 'doubao-seed-2-0-lite')).toBe(262_144);
  });
});
