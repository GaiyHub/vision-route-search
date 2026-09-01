import {
  findModelSuggestions,
  normalizeModelsDevCatalog,
  normalizeProviderCatalog,
  type ModelCatalogEntry,
} from '../modelCatalog';

describe('modelCatalog', () => {
  it('keeps only text models with tool calling from models.dev', () => {
    const result = normalizeModelsDevCatalog({
      openai: {
        name: 'OpenAI',
        models: {
          chat: {
            id: 'gpt-chat',
            name: 'GPT Chat',
            tool_call: true,
            modalities: { output: ['text'] },
          },
          noTools: { id: 'gpt-basic', name: 'GPT Basic', tool_call: false },
          image: {
            id: 'gpt-image',
            name: 'GPT Image',
            tool_call: true,
            modalities: { output: ['image'] },
          },
        },
      },
    });

    expect(result.map((entry) => entry.id)).toEqual(['gpt-chat']);
    expect(result[0]).toMatchObject({ provider: 'OpenAI', source: 'market', verified: false });
  });

  it('normalizes provider results and removes obvious non-chat models', () => {
    const result = normalizeProviderCatalog({
      data: [
        { id: 'gpt-chat', name: 'GPT Chat', owned_by: 'vendor' },
        { id: 'text-embedding-3-small' },
      ],
    }, 'openai');

    expect(result).toEqual([expect.objectContaining({
      id: 'gpt-chat',
      source: 'provider',
      verified: true,
    })]);
  });

  it('ranks configured-provider results first while preserving free-text search', () => {
    const entries: ModelCatalogEntry[] = [
      { id: 'vendor/chat-large', name: 'Chat Large', provider: 'market', source: 'market', verified: false },
      { id: 'vendor/chat-fast', name: 'Chat Fast', provider: 'custom', source: 'provider', verified: true },
      { id: 'other-model', name: 'Other', provider: 'custom', source: 'provider', verified: true },
    ];

    expect(findModelSuggestions(entries, 'chat', 'auto', 'https://example.com/v1'))
      .toEqual([
        expect.objectContaining({ id: 'vendor/chat-fast' }),
        expect.objectContaining({ id: 'vendor/chat-large' }),
      ]);
  });
});
