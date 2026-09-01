import { MAX_AGENT_STEPS, MIN_AGENT_STEPS } from '../device-agent/agent/AgentLimits';
import {
  getFavorites,
  MAX_IMPORTED_FAVORITES,
  mergeFavorites,
  parseFavoritesJson,
} from './favoritesStore';
import {
  getPortableSkills,
  importPortableSkills,
  parsePortableSkills,
  type PortableSkill,
} from './skillStore';
import {
  getSettings,
  saveSettings,
  type CloudModelProfile,
  type Settings,
} from './settingsStore';

const CONFIGURATION_FORMAT = 'doubao-configuration';
const CONFIGURATION_VERSION = 1;

const GENERAL_SETTING_KEYS = [
  'maxSteps',
  'settleMs',
  'nodeTargetGestureTapEnabled',
  'enableThinking',
  'retryOnError',
  'planMode',
  'maxSubTasks',
  'timeoutSecs',
  'contextCompressionEnabled',
  'contextCompressionThresholdPercent',
  'contextCompressionProtectedRecentRounds',
  'maxConversationHistoryTurns',
  'maxStoredSessions',
  'maxScreenLength',
  'forceVisualMode',
  'screenshotNodeMarkersEnabled',
  'screenshotDownscalingEnabled',
  'ocrEnhancementEnabled',
  'keepScreenshots',
  'customInstructions',
  'contextJson',
  'recommendedCommandsEnabled',
  'dismissedRecommendedCommands',
  'voiceMode',
  'ttsEnabled',
] as const satisfies readonly (keyof Settings)[];

const MODEL_SETTING_KEYS = [
  'model',
  'providerMode',
  'cloudFallback',
  'cloudModelProfiles',
  'activeCloudModelProfileId',
  'llmDebugLog',
] as const satisfies readonly (keyof Settings)[];

export type PortableGeneralSettings = Pick<Settings, typeof GENERAL_SETTING_KEYS[number]>;
export type PortableModelSettings = Pick<Settings, typeof MODEL_SETTING_KEYS[number]>;

export interface PortableConfigurationBundle {
  format: typeof CONFIGURATION_FORMAT;
  version: typeof CONFIGURATION_VERSION;
  exportedAt: string;
  generalSettings: PortableGeneralSettings;
  modelSettings: PortableModelSettings;
  skills: PortableSkill[];
  favorites: string[];
}

export type ParsedConfigurationImport =
  | { kind: 'configuration'; bundle: PortableConfigurationBundle }
  | { kind: 'legacy_favorites'; favorites: string[] };

export type ParseConfigurationResult =
  | { ok: true; value: ParsedConfigurationImport }
  | {
      ok: false;
      error:
        | 'invalid_json'
        | 'invalid_format'
        | 'unsupported_version'
        | 'invalid_settings'
        | 'invalid_skills'
        | 'too_many_items';
    };

const NUMBER_RANGES: Partial<Record<keyof Settings, readonly [number, number]>> = {
  maxSteps: [MIN_AGENT_STEPS, MAX_AGENT_STEPS],
  settleMs: [100, 2000],
  retryOnError: [0, 3],
  maxSubTasks: [1, 20],
  timeoutSecs: [0, 300],
  contextCompressionThresholdPercent: [1, 95],
  contextCompressionProtectedRecentRounds: [1, 20],
  maxConversationHistoryTurns: [0, 50],
  maxStoredSessions: [10, 200],
  maxScreenLength: [0, 20000],
};

function pickSettings<K extends keyof Settings>(
  settings: Settings,
  keys: readonly K[],
): Pick<Settings, K> {
  return Object.fromEntries(keys.map((key) => [key, settings[key]])) as Pick<Settings, K>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateCloudProfiles(value: unknown): value is CloudModelProfile[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return false;
  const ids = new Set<string>();
  return value.every((candidate) => {
    if (!isPlainObject(candidate)) return false;
    const provider = candidate.provider;
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    if (!id || ids.has(id)) return false;
    ids.add(id);
    return (
      ['auto', 'anthropic', 'openai', 'openrouter'].includes(String(provider)) &&
      typeof candidate.baseUrl === 'string' &&
      typeof candidate.apiKey === 'string' &&
      typeof candidate.model === 'string' &&
      Number.isInteger(candidate.contextWindowTokens) &&
      Number(candidate.contextWindowTokens) > 0
    );
  });
}

function validateGeneralSettings(value: unknown): value is PortableGeneralSettings {
  if (!isPlainObject(value)) return false;
  const current = getSettings();
  for (const key of GENERAL_SETTING_KEYS) {
    const imported = value[key];
    const expected = current[key];
    if (key === 'dismissedRecommendedCommands') {
      if (!Array.isArray(imported) || imported.some((item) => typeof item !== 'string')) {
        return false;
      }
      continue;
    }
    if (typeof imported !== typeof expected) return false;
    if (typeof imported === 'number') {
      const range = NUMBER_RANGES[key];
      if (!Number.isInteger(imported) || (range && (imported < range[0] || imported > range[1]))) {
        return false;
      }
    }
  }
  return true;
}

function validateModelSettings(value: unknown): value is PortableModelSettings {
  if (!isPlainObject(value)) return false;
  if (value.model !== 'E2B' && value.model !== 'E4B') return false;
  if (value.providerMode !== 'cloud' && value.providerMode !== 'local') return false;
  if (typeof value.cloudFallback !== 'boolean' || typeof value.llmDebugLog !== 'boolean') {
    return false;
  }
  if (!validateCloudProfiles(value.cloudModelProfiles)) return false;
  return typeof value.activeCloudModelProfileId === 'string' &&
    value.cloudModelProfiles.some((profile) => profile.id === value.activeCloudModelProfileId);
}

function validateFavorites(value: unknown): string[] | null {
  const parsed = parseFavoritesJson(JSON.stringify(value));
  if (!parsed.ok) return null;
  return favoritesFitCurrentLibrary(parsed.commands) ? parsed.commands : null;
}

function favoritesFitCurrentLibrary(commands: string[]): boolean {
  const existing = new Set(getFavorites());
  const additions = commands.filter((command) => !existing.has(command));
  return existing.size + additions.length <= MAX_IMPORTED_FAVORITES;
}

export function serializeConfigurationExport(now: Date = new Date()): string {
  const settings = getSettings();
  const bundle: PortableConfigurationBundle = {
    format: CONFIGURATION_FORMAT,
    version: CONFIGURATION_VERSION,
    exportedAt: now.toISOString(),
    generalSettings: pickSettings(settings, GENERAL_SETTING_KEYS),
    modelSettings: pickSettings(settings, MODEL_SETTING_KEYS),
    skills: getPortableSkills(),
    favorites: getFavorites(),
  };
  return JSON.stringify(bundle, null, 2);
}

export function parseConfigurationImport(content: string): ParseConfigurationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }

  if (Array.isArray(parsed) || (isPlainObject(parsed) && parsed.format === 'doubao-favorite-commands')) {
    const favorites = parseFavoritesJson(content);
    if (!favorites.ok) {
      return {
        ok: false,
        error: favorites.error === 'too_many_commands' ? 'too_many_items' : favorites.error,
      };
    }
    return favoritesFitCurrentLibrary(favorites.commands)
      ? { ok: true, value: { kind: 'legacy_favorites', favorites: favorites.commands } }
      : { ok: false, error: 'too_many_items' };
  }
  if (!isPlainObject(parsed) || parsed.format !== CONFIGURATION_FORMAT) {
    return { ok: false, error: 'invalid_format' };
  }
  if (parsed.version !== CONFIGURATION_VERSION) {
    return { ok: false, error: 'unsupported_version' };
  }
  if (!validateGeneralSettings(parsed.generalSettings) || !validateModelSettings(parsed.modelSettings)) {
    return { ok: false, error: 'invalid_settings' };
  }
  const skills = parsePortableSkills(parsed.skills);
  if (!skills.ok) {
    return { ok: false, error: skills.error === 'too_many_skills' ? 'too_many_items' : 'invalid_skills' };
  }
  const favorites = validateFavorites(parsed.favorites);
  if (!favorites) return { ok: false, error: 'too_many_items' };
  return {
    ok: true,
    value: {
      kind: 'configuration',
      bundle: {
        format: CONFIGURATION_FORMAT,
        version: CONFIGURATION_VERSION,
        exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
        generalSettings: parsed.generalSettings,
        modelSettings: parsed.modelSettings,
        skills: skills.skills,
        favorites,
      },
    },
  };
}

export async function applyConfigurationImport(value: ParsedConfigurationImport): Promise<{
  settingsImported: boolean;
  skillsAdded: number;
  skillsUpdated: number;
  favoritesAdded: number;
}> {
  if (value.kind === 'legacy_favorites') {
    const favorites = mergeFavorites(value.favorites);
    return {
      settingsImported: false,
      skillsAdded: 0,
      skillsUpdated: 0,
      favoritesAdded: favorites.ok ? favorites.added : 0,
    };
  }
  await saveSettings({ ...value.bundle.generalSettings, ...value.bundle.modelSettings });
  const skills = await importPortableSkills(value.bundle.skills);
  const favorites = mergeFavorites(value.bundle.favorites);
  return {
    settingsImported: true,
    skillsAdded: skills.added,
    skillsUpdated: skills.updated,
    favoritesAdded: favorites.ok ? favorites.added : 0,
  };
}
