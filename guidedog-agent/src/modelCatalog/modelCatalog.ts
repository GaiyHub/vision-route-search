import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Settings } from '../store/settingsStore';

export type ModelCatalogSource = 'builtin' | 'market' | 'provider';

export interface ModelCatalogEntry {
  id: string;
  name: string;
  provider: string;
  source: ModelCatalogSource;
  /** True only when the configured endpoint returned this model. */
  verified: boolean;
}

interface CachedModelCatalog {
  savedAt: number;
  entries: ModelCatalogEntry[];
}

const STORAGE_KEY = '@deft/model-catalog-v1';
const MARKET_CATALOG_URL = 'https://models.dev/api.json';
const FETCH_TIMEOUT_MS = 10_000;
// The normalized models.dev payload currently contains roughly 5,500 relevant
// entries and is much smaller than its raw metadata document. Keeping all of
// them avoids dropping smaller providers that appear late in the response.
const MAX_CACHED_ENTRIES = 6_000;

const BUILTIN_ENTRIES: ModelCatalogEntry[] = [
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    source: 'builtin',
    verified: false,
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    source: 'builtin',
    verified: false,
  },
  {
    id: 'google/gemma-3-27b-it',
    name: 'Gemma 3 27B Instruct',
    provider: 'openrouter',
    source: 'builtin',
    verified: false,
  },
];

let catalog: ModelCatalogEntry[] = [...BUILTIN_ENTRIES];
let loaded = false;
let loadPromise: Promise<ModelCatalogEntry[]> | null = null;
let refreshPromise: Promise<ModelCatalogEntry[]> | null = null;
let refreshedThisLaunch = false;
const listeners = new Set<(entries: ModelCatalogEntry[]) => void>();

function publish(entries: ModelCatalogEntry[]): ModelCatalogEntry[] {
  catalog = dedupeEntries([...entries, ...BUILTIN_ENTRIES]).slice(0, MAX_CACHED_ENTRIES);
  listeners.forEach((listener) => listener(catalog));
  return catalog;
}

export function getModelCatalog(): ModelCatalogEntry[] {
  return catalog;
}

export function subscribeModelCatalog(
  listener: (entries: ModelCatalogEntry[]) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadModelCatalog(): Promise<ModelCatalogEntry[]> {
  if (loaded) return catalog;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as Partial<CachedModelCatalog>;
        if (Array.isArray(cached.entries)) publish(cached.entries.filter(isCatalogEntry));
      }
    } catch {
      // A malformed or unavailable cache must never prevent manual model input.
    }
    loaded = true;
    return catalog;
  })();

  return loadPromise;
}

/**
 * Refreshes at most once per app process. The cached catalog is published first
 * so settings remains useful when the network or provider endpoint is offline.
 */
export async function refreshModelCatalogOnce(settings: Settings): Promise<ModelCatalogEntry[]> {
  await loadModelCatalog();
  if (refreshedThisLaunch) return catalog;
  if (refreshPromise) return refreshPromise;

  refreshedThisLaunch = true;
  refreshPromise = (async () => {
    const [marketResult, providerResult] = await Promise.allSettled([
      fetchJson(MARKET_CATALOG_URL, {}),
      fetchProviderModels(settings),
    ]);

    const marketEntries = marketResult.status === 'fulfilled'
      ? normalizeModelsDevCatalog(marketResult.value)
      : [];
    const providerEntries = providerResult.status === 'fulfilled'
      ? normalizeProviderCatalog(providerResult.value, configuredProviderName(settings))
      : [];

    // Preserve stale entries for offline use, while fresh provider entries win
    // duplicate IDs and are surfaced first by the suggestion ranker.
    const next = publish([...providerEntries, ...marketEntries, ...catalog]);
    try {
      const value: CachedModelCatalog = { savedAt: Date.now(), entries: next };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Caching is an optimization; a storage failure does not affect selection.
    }
    return next;
  })();

  return refreshPromise;
}

export function normalizeModelsDevCatalog(value: unknown): ModelCatalogEntry[] {
  if (!value || typeof value !== 'object') return [];
  const entries: ModelCatalogEntry[] = [];

  for (const [providerKey, providerValue] of Object.entries(value as Record<string, unknown>)) {
    if (!providerValue || typeof providerValue !== 'object') continue;
    const provider = providerValue as Record<string, unknown>;
    const models = provider.models;
    const providerName = asNonEmptyString(provider.id) ?? providerKey;
    const providerLabel = asNonEmptyString(provider.name) ?? providerName;

    const values = Array.isArray(models)
      ? models
      : models && typeof models === 'object'
        ? Object.values(models as Record<string, unknown>)
        : [];

    for (const rawModel of values) {
      if (!rawModel || typeof rawModel !== 'object') continue;
      const model = rawModel as Record<string, unknown>;
      const id = asNonEmptyString(model.id);
      if (!id || model.status === 'deprecated' || model.tool_call !== true) continue;

      const modalities = model.modalities;
      if (modalities && typeof modalities === 'object') {
        const output = (modalities as Record<string, unknown>).output;
        if (Array.isArray(output) && !output.includes('text')) continue;
      }

      entries.push({
        id,
        name: asNonEmptyString(model.name) ?? id,
        provider: providerLabel,
        source: 'market',
        verified: false,
      });
    }
  }
  return dedupeEntries(entries);
}

export function normalizeProviderCatalog(value: unknown, provider: string): ModelCatalogEntry[] {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const data = Array.isArray(root.data) ? root.data : Array.isArray(value) ? value : [];

  return dedupeEntries(data.flatMap((rawModel): ModelCatalogEntry[] => {
    if (!rawModel || typeof rawModel !== 'object') return [];
    const model = rawModel as Record<string, unknown>;
    const id = asNonEmptyString(model.id);
    if (!id || !isLikelyTextModel(id)) return [];
    return [{
      id,
      name: asNonEmptyString(model.display_name) ?? asNonEmptyString(model.name) ?? id,
      provider: asNonEmptyString(model.owned_by) ?? provider,
      source: 'provider',
      verified: true,
    }];
  }));
}

export function findModelSuggestions(
  entries: ModelCatalogEntry[],
  query: string,
  provider: Settings['cloudProvider'],
  customBaseUrl: string,
  limit = 7,
): ModelCatalogEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  const allowed = entries.filter((entry) => {
    if (entry.verified) return true;
    if (customBaseUrl.trim()) return true;
    const key = entry.provider.toLowerCase();
    if (provider === 'anthropic') return key.includes('anthropic');
    if (provider === 'openai') return key === 'openai' || key.includes('openai');
    if (provider === 'openrouter') return key.includes('openrouter');
    return key.includes('anthropic') || key === 'openai' || key.includes('openai');
  });

  return dedupeSuggestions(allowed
    .filter((entry) => {
      if (!normalizedQuery) return true;
      return entry.id.toLowerCase().includes(normalizedQuery)
        || entry.name.toLowerCase().includes(normalizedQuery)
        || entry.provider.toLowerCase().includes(normalizedQuery);
    })
    .sort((a, b) => suggestionScore(b, normalizedQuery) - suggestionScore(a, normalizedQuery)
      || a.id.localeCompare(b.id)))
    .slice(0, Math.max(1, limit));
}

async function fetchProviderModels(settings: Settings): Promise<unknown> {
  const baseUrl = (settings.cloudBaseUrl.trim() || defaultBaseUrl(settings)).replace(/\/+$/, '');
  const anthropic = settings.cloudProvider === 'anthropic'
    || (settings.cloudProvider === 'auto' && settings.cloudModel.toLowerCase().startsWith('claude'));
  const headers: Record<string, string> = {};
  if (anthropic) {
    if (settings.cloudApiKey.trim()) headers['x-api-key'] = settings.cloudApiKey.trim();
    headers['anthropic-version'] = '2023-06-01';
  } else if (settings.cloudApiKey.trim()) {
    headers.Authorization = `Bearer ${settings.cloudApiKey.trim()}`;
  }

  let url = `${baseUrl}/models`;
  if (anthropic) url += '?limit=1000';
  if (settings.cloudProvider === 'openrouter') {
    url += '?supported_parameters=tools&output_modalities=text&sort=most-popular';
  }
  return fetchJson(url, { headers });
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<unknown>;
  } finally {
    clearTimeout(timer);
  }
}

function defaultBaseUrl(settings: Settings): string {
  if (settings.cloudProvider === 'anthropic') return 'https://api.anthropic.com/v1';
  if (settings.cloudProvider === 'openrouter') return 'https://openrouter.ai/api/v1';
  if (settings.cloudProvider === 'openai') return 'https://api.openai.com/v1';
  return settings.cloudModel.toLowerCase().startsWith('claude')
    ? 'https://api.anthropic.com/v1'
    : 'https://api.openai.com/v1';
}

function configuredProviderName(settings: Settings): string {
  if (settings.cloudProvider !== 'auto') return settings.cloudProvider;
  return settings.cloudModel.toLowerCase().startsWith('claude') ? 'anthropic' : 'openai-compatible';
}

function suggestionScore(entry: ModelCatalogEntry, query: string): number {
  const id = entry.id.toLowerCase();
  const name = entry.name.toLowerCase();
  let score = entry.verified ? 10_000 : entry.source === 'market' ? 1_000 : 100;
  if (!query) return score;
  if (id === query) score += 5_000;
  else if (id.startsWith(query)) score += 3_000;
  else if (name.startsWith(query)) score += 2_000;
  else if (id.includes(query)) score += 1_000;
  return score;
}

function dedupeEntries(entries: ModelCatalogEntry[]): ModelCatalogEntry[] {
  const byProviderAndId = new Map<string, ModelCatalogEntry>();
  for (const entry of entries) {
    const key = `${entry.provider.toLowerCase()}:${entry.id.toLowerCase()}`;
    const existing = byProviderAndId.get(key);
    if (!existing || (!existing.verified && entry.verified)) byProviderAndId.set(key, entry);
  }
  return [...byProviderAndId.values()];
}

function dedupeSuggestions(entries: ModelCatalogEntry[]): ModelCatalogEntry[] {
  const byId = new Map<string, ModelCatalogEntry>();
  for (const entry of entries) {
    const key = entry.id.toLowerCase();
    const existing = byId.get(key);
    if (!existing || suggestionScore(entry, '') > suggestionScore(existing, '')) {
      byId.set(key, entry);
    }
  }
  return [...byId.values()];
}

function isLikelyTextModel(id: string): boolean {
  const value = id.toLowerCase();
  return ![
    'embedding', 'moderation', 'whisper', 'transcri', 'speech', 'tts',
    'dall-e', 'image', 'sora', 'realtime', 'audio-preview',
  ].some((marker) => value.includes(marker));
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isCatalogEntry(value: unknown): value is ModelCatalogEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ModelCatalogEntry>;
  return typeof entry.id === 'string'
    && typeof entry.name === 'string'
    && typeof entry.provider === 'string'
    && (entry.source === 'builtin' || entry.source === 'market' || entry.source === 'provider')
    && typeof entry.verified === 'boolean';
}
