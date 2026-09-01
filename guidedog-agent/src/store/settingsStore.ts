/**
 * Settings store.
 *
 * Persists user preferences to AsyncStorage with an in-memory cache.
 * Call loadSettings() once at startup; subsequent reads via getSettings()
 * are synchronous so the agent loop can access them without await.
 */

import {
  DEFAULT_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT,
  getDefaultToolCircuitBreakerThreshold,
  canonicalToolName,
  normalizeConsecutiveCircuitBlockLimit,
  normalizeToolCircuitBreakerOverrides,
  type ToolCircuitBreakerOverrides,
  type ToolCircuitBreakerThreshold,
} from '../device-agent/tools/ToolCircuitBreakerPolicy';
import {
  normalizeToolConfigurationOverrides,
  type ToolConfigurationOverride,
  type ToolConfigurationOverrides,
} from '../device-agent/tools/ToolConfiguration';
import {
  DEFAULT_AGENT_STEPS,
  normalizeAgentSteps,
} from '../device-agent/agent/AgentLimits';
import {
  DEFAULT_CONTEXT_COMPRESSION_PROTECTED_RECENT_ROUNDS,
  DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT,
  normalizeContextCompressionProtectedRecentRounds,
  normalizeContextCompressionThresholdPercent,
} from '../device-agent/agent/ContextCompressionManager';
import {
  normalizeModelContextWindowTokens,
  resolveModelContextWindow,
} from '../modelCatalog/modelContextWindow';

export type CloudProvider = 'auto' | 'anthropic' | 'openai' | 'openrouter';

export interface CloudModelProfile {
  /** Stable local identifier used when switching profiles. */
  id: string;
  /** API protocol/provider selection for this endpoint. */
  provider: CloudProvider;
  /** API base URL. Empty retains the provider's built-in default. */
  baseUrl: string;
  /** Credential belonging to this endpoint. */
  apiKey: string;
  /** Model identifier sent to the endpoint. */
  model: string;
  /** User-configurable maximum context capacity for this model, in tokens. */
  contextWindowTokens: number;
}

const DEFAULT_CLOUD_MODEL_PROFILE: CloudModelProfile = {
  id: 'default-cloud-model',
  provider: 'auto',
  baseUrl: '',
  apiKey: '',
  model: 'claude-sonnet-4-6',
  contextWindowTokens: resolveModelContextWindow('claude-sonnet-4-6'),
};

export interface Settings {
  /** Which Gemma variant to use for on-device inference. */
  model: 'E2B' | 'E4B';
  /** Sparse per-tool overrides; absent tools continue to inherit family defaults. */
  toolCircuitBreakerOverrides: ToolCircuitBreakerOverrides;
  /** Consecutive hard circuit-breaker blocks that force-stop AgentLoop. */
  consecutiveCircuitBreakerLimit: number;
  /** Sparse per-tool availability and editable metadata overrides. */
  toolConfigurationOverrides: ToolConfigurationOverrides;
  /** Fall back to a cloud LLM when the local model is unavailable. */
  cloudFallback: boolean;
  /**
   * Model provider priority. 'cloud' (default) prefers the cloud API and
   * falls back to the local model; 'local' prefers on-device inference.
   */
  providerMode: 'cloud' | 'local';
  /**
   * Custom cloud API base URL (OpenAI-compatible endpoint). Empty uses the
   * provider default endpoint.
   */
  cloudBaseUrl: string;
  /** API key for the cloud provider. */
  cloudApiKey: string;
  /** Tavily credential used only by the built-in web_search tool. */
  tavilyApiKey: string;
  /**
   * Cloud model identifier.
   * OpenAI example: 'gpt-4o'
   * Anthropic example: 'claude-sonnet-4-6'
   * OpenRouter example: 'google/gemma-3-27b-it'
   */
  cloudModel: string;
  /**
   * Cloud provider selection.
   * 'auto' detects Anthropic vs OpenAI by model name prefix.
   */
  cloudProvider: CloudProvider;
  /** Saved cloud endpoint/model configurations. */
  cloudModelProfiles: CloudModelProfile[];
  /** Profile whose values are projected into the cloud* runtime fields above. */
  activeCloudModelProfileId: string;
  /** Maximum number of agent loop steps before giving up. */
  maxSteps: number;
  /** Milliseconds to wait after each action before observing the result. */
  settleMs: number;
  /** Make screenshot the sole Android UI observation channel for the agent. */
  forceVisualMode: boolean;
  /** Draw short-lived accessibility refs over screenshots sent to the model. */
  screenshotNodeMarkersEnabled: boolean;
  /** Downscale the model-only screenshot copy while preserving physical screen dimensions. */
  screenshotDownscalingEnabled: boolean;
  /** Allow the screenshot tool to run bundled OCR and expose OCR refs. */
  ocrEnhancementEnabled: boolean;
  /** Prefer one gesture at the resolved live node center; false restores action-first dispatch. */
  nodeTargetGestureTapEnabled: boolean;
  /** Number of times to retry a failed LLM call before giving up (0 = no retries). */
  retryOnError: number;
  /** Extra instructions appended to the agent system prompt. */
  customInstructions: string;
  /** Show the app-owned recommended command set in the chat empty state. */
  recommendedCommandsEnabled: boolean;
  /** App-owned recommendations individually hidden by the user. */
  dismissedRecommendedCommands: string[];
  /**
   * When true, a complex task is first decomposed into subtasks by the LLM,
   * then each subtask is executed sequentially by AgentLoop (TaskPlanner mode).
   */
  planMode: boolean;
  /**
   * Maximum number of subtasks the TaskPlanner may generate for a single command.
   * Only relevant when planMode is true. Default: 5.
   */
  maxSubTasks: number;
  /**
   * Maximum wall-clock seconds the agent may run before timing out.
   * 0 means no timeout. Stored as seconds for display convenience;
   * multiply by 1000 before passing to AgentLoop's `timeoutMs` option.
   */
  timeoutSecs: number;
  /** Use token-aware fixed offload + LLM summary; false disables compression. */
  contextCompressionEnabled: boolean;
  /** Context-window usage percentage that triggers an LLM-generated summary. */
  contextCompressionThresholdPercent: number;
  /** Recent history and real conversation rounds kept verbatim during compression. */
  contextCompressionProtectedRecentRounds: number;
  /** Prior user/assistant dialogue turns injected into a new run. */
  maxConversationHistoryTurns: number;
  /**
   * How many completed sessions to keep in the history tab. Older sessions
   * beyond this count are dropped automatically.
   */
  maxStoredSessions: number;
  /** @deprecated Retained only for persisted-settings compatibility. */
  maxScreenLength: number;
  /** Speak agent responses aloud via text-to-speech when true. */
  ttsEnabled: boolean;
  /**
   * Push-to-talk voice mode. When true, the mic button becomes press-and-hold:
   * hold to record via Whisper STT (or expo-speech-recognition fallback),
   * release to auto-submit. Also enables TTS playback for agent responses.
   */
  voiceMode: boolean;
  /**
   * JSON object string of key-value context variables injected into every
   * agent prompt. Example: `{"username":"Matt","language":"Spanish"}`.
   * Parsed at run-time; invalid JSON is silently ignored (falls back to {}).
   */
  contextJson: string;
  /**
   * Enable the model's built-in thinking/reasoning mode (Qwen3 series
   * `enable_thinking`). When off, reasoning tokens are skipped: responses
   * come back faster and cheaper, at the cost of weaker multi-step
   * planning on complex tasks.
   */
  enableThinking: boolean;
  /**
   * Log redacted LLM request/response bodies to logcat ([LLM] lines,
   * chunked). Inline image base64 is always excluded.
   */
  llmDebugLog: boolean;
  /**
   * Keep clean captures and model-facing marked screenshots on local storage
   * (app-specific dir and the public Pictures/DouPao album) for verification.
   * Off by default — working cache copies are always written.
   */
  keepScreenshots: boolean;
  /**
   * User-saved quick-access commands shown in the chat empty state.
   * Displayed as tappable chips; empty means the hardcoded example commands
   * are shown instead.
   */
  savedCommands: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  model: 'E4B',
  toolCircuitBreakerOverrides: {},
  consecutiveCircuitBreakerLimit: DEFAULT_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT,
  toolConfigurationOverrides: {},
  cloudFallback: false,
  providerMode: 'cloud',
  cloudBaseUrl: '',
  cloudApiKey: '',
  tavilyApiKey: '',
  cloudModel: 'claude-sonnet-4-6',
  cloudProvider: 'auto',
  cloudModelProfiles: [
    { ...DEFAULT_CLOUD_MODEL_PROFILE },
  ],
  activeCloudModelProfileId: DEFAULT_CLOUD_MODEL_PROFILE.id,
  maxSteps: DEFAULT_AGENT_STEPS,
  settleMs: 500,
  forceVisualMode: false,
  screenshotNodeMarkersEnabled: true,
  screenshotDownscalingEnabled: true,
  ocrEnhancementEnabled: true,
  nodeTargetGestureTapEnabled: true,
  retryOnError: 0,
  customInstructions: '',
  recommendedCommandsEnabled: true,
  dismissedRecommendedCommands: [],
  planMode: false,
  maxSubTasks: 5,
  timeoutSecs: 0,
  contextCompressionEnabled: true,
  contextCompressionThresholdPercent: DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT,
  contextCompressionProtectedRecentRounds: DEFAULT_CONTEXT_COMPRESSION_PROTECTED_RECENT_ROUNDS,
  maxConversationHistoryTurns: 2,
  maxStoredSessions: 50,
  maxScreenLength: 6000,
  ttsEnabled: false,
  voiceMode: false,
  contextJson: '',
  // Thinking mode is supported: the agent prompt, token budget and
  // response merging (see CloudProvider) are all adapted to it, so it stays
  // on by default for better multi-step planning.
  enableThinking: true,
  llmDebugLog: false,
  keepScreenshots: false,
  savedCommands: [],
};

const SETTINGS_KEY = '@deft/settings';

/**
 * Storage schema version. Bump when a stored value needs a one-time
 * migration that can't be told apart from a user's explicit choice by
 * looking at the raw value alone.
 */
const SETTINGS_VERSION = 23;

/**
 * v1 persisted `enableThinking: true`; v2 force-migrated it to `false` to
 * dodge a truncation bug that was actually caused by an undersized token
 * budget and unmerged reasoning output — both fixed in v3. Thinking mode is
 * now a supported, default-on feature, so v1/v2 stores (whose value was
 * never a user's explicit choice) are migrated back to `true`. Users who
 * explicitly toggle it off on a v3 store are unaffected.
 */
function migrateSettings(parsed: Record<string, unknown>): boolean {
  const version = (parsed.__version as number | undefined) ?? 1;
  let changed = false;
  if (version < 3) {
    parsed.enableThinking = true;
    changed = true;
  }
  if (version < 6 && (parsed.maxSteps === undefined || parsed.maxSteps === 20)) {
    parsed.maxSteps = DEFAULT_AGENT_STEPS;
    changed = true;
  }
  // v8 briefly named this limit after tasks. Preserve the user's numeric
  // choice while correcting the model to count user/assistant dialogue turns.
  if (version < 9) {
    if (parsed.maxConversationHistoryTurns === undefined) {
      const previousValue = parsed.maxConversationHistoryTasks;
      parsed.maxConversationHistoryTurns =
        typeof previousValue === 'number' && previousValue !== 12
          ? previousValue
          : DEFAULT_SETTINGS.maxConversationHistoryTurns;
    }
    delete parsed.maxConversationHistoryTasks;
    changed = true;
  }
  // v10 introduces token-aware context compression.
  if (version < 10 && parsed.contextCompressionEnabled === undefined) {
    parsed.contextCompressionEnabled = true;
    changed = true;
  }
  // v11 makes application discovery and launch mandatory. Mark the settings
  // for rewrite so normalization removes historical enabled:false overrides
  // for open_app/list_apps from persisted storage as well as runtime memory.
  if (version < 11) {
    changed = true;
  }
  // v12 adds model-facing Set-of-Mark overlays to explicit phone screenshots.
  // Default it on, while retaining a persisted switch for immediate rollback
  // to the original clean-screenshot behaviour.
  if (version < 12 && parsed.screenshotNodeMarkersEnabled === undefined) {
    parsed.screenshotNodeMarkersEnabled = true;
    changed = true;
  }
  // v13 changes node-targeted taps to use live accessibility bounds for
  // targeting and one physical center gesture for activation. The persisted
  // switch allows an immediate rollback to the previous action-first policy.
  if (version < 13 && parsed.nodeTargetGestureTapEnabled === undefined) {
    parsed.nodeTargetGestureTapEnabled = true;
    changed = true;
  }
  // v14 exposes the summary trigger as a percentage. The former Qwen/deepseek
  // policy triggered at 85%, so existing installations keep the same default.
  if (version < 14 && parsed.contextCompressionThresholdPercent === undefined) {
    parsed.contextCompressionThresholdPercent = DEFAULT_CONTEXT_COMPRESSION_THRESHOLD_PERCENT;
    changed = true;
  }
  // v15 restores the safer OpenMinis-style dispatch chain: resolve against
  // the current raw tree, try the node/ancestor action, then use live bounds
  // for a center gesture only when Android rejects the semantic action.
  if (version < 15) {
    parsed.nodeTargetGestureTapEnabled = false;
    changed = true;
  }
  // v16 replaces the single cloud endpoint with a switchable profile list.
  // Preserve the exact legacy values as the first profile and continue to
  // project the active profile into the old cloud* fields used at runtime.
  if (version < 16 && !Array.isArray(parsed.cloudModelProfiles)) {
    const profile: CloudModelProfile = {
      id: DEFAULT_CLOUD_MODEL_PROFILE.id,
      provider: normalizeCloudProvider(parsed.cloudProvider),
      baseUrl: typeof parsed.cloudBaseUrl === 'string' ? parsed.cloudBaseUrl : '',
      apiKey: typeof parsed.cloudApiKey === 'string' ? parsed.cloudApiKey : '',
      model: typeof parsed.cloudModel === 'string'
        ? parsed.cloudModel
        : DEFAULT_CLOUD_MODEL_PROFILE.model,
      contextWindowTokens: resolveModelContextWindow(
        typeof parsed.cloudModel === 'string'
          ? parsed.cloudModel
          : DEFAULT_CLOUD_MODEL_PROFILE.model,
      ),
    };
    parsed.cloudModelProfiles = [profile];
    parsed.activeCloudModelProfileId = profile.id;
    changed = true;
  }
  // v17 removes the legacy recent-round sliding-window fallback. Disabling
  // intelligent compression now retains the complete available context.
  if (version < 17) {
    delete parsed.maxHistoryItems;
    changed = true;
  }
  // v18 exposes the existing four-round verbatim protection as a setting.
  if (version < 18 && parsed.contextCompressionProtectedRecentRounds === undefined) {
    parsed.contextCompressionProtectedRecentRounds =
      DEFAULT_CONTEXT_COMPRESSION_PROTECTED_RECENT_ROUNDS;
    changed = true;
  }
  // v19 makes real center gestures the default activation for node-targeted
  // taps. Live accessibility data still locates the target, and the native
  // dispatcher falls back to node/ancestor actions when a gesture is rejected.
  // The persisted switch remains available to restore the former action-first
  // chain immediately.
  if (version < 19) {
    parsed.nodeTargetGestureTapEnabled = true;
    changed = true;
  }
  // v20 adds a global fail-safe above individual tool breakers. Existing
  // installations inherit the conservative default without changing their
  // per-tool warning/block thresholds.
  if (version < 20 && parsed.consecutiveCircuitBreakerLimit === undefined) {
    parsed.consecutiveCircuitBreakerLimit = DEFAULT_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT;
    changed = true;
  }
  // v21 stores the effective context capacity with every cloud profile. Old
  // profiles are initialized from the built-in model map (unknown = 128K).
  if (version < 21 && Array.isArray(parsed.cloudModelProfiles)) {
    parsed.cloudModelProfiles = parsed.cloudModelProfiles.map((candidate) => {
      if (!candidate || typeof candidate !== 'object') return candidate;
      const profile = candidate as Record<string, unknown>;
      const model = typeof profile.model === 'string' ? profile.model : '';
      return {
        ...profile,
        contextWindowTokens: normalizeModelContextWindowTokens(
          profile.contextWindowTokens,
          model,
        ),
      };
    });
    changed = true;
  }
  // v22 adds an independent OCR capability switch. Existing installations
  // retain the prior behaviour, where the model may request bundled OCR from
  // ui_screenshot when visual text coordinates are useful.
  if (version < 22 && parsed.ocrEnhancementEnabled === undefined) {
    parsed.ocrEnhancementEnabled = true;
    changed = true;
  }
  // v23 caps only the image copy sent to the model. OCR, local comparison and
  // physical coordinate conversion continue to use the original screenshot.
  if (version < 23 && parsed.screenshotDownscalingEnabled === undefined) {
    parsed.screenshotDownscalingEnabled = true;
    changed = true;
  }
  // Screenshot capture is now exclusively model-triggered. Image attachment
  // follows provider capability, so the old user-facing switch is obsolete.
  if (Object.prototype.hasOwnProperty.call(parsed, 'useVision')) {
    delete parsed.useVision;
    changed = true;
  }
  // Tool presets were a user-facing bulk filter. The main agent now starts
  // from the complete tool catalog and relies on per-tool configuration.
  if (Object.prototype.hasOwnProperty.call(parsed, 'toolPreset')) {
    delete parsed.toolPreset;
    changed = true;
  }
  if (version < SETTINGS_VERSION) {
    parsed.__version = SETTINGS_VERSION;
    changed = true;
  }
  return changed;
}

interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

function getStorage(): AsyncStorageLike {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-async-storage/async-storage').default as AsyncStorageLike;
  } catch {
    const mem: Record<string, string> = {};
    return {
      async getItem(k: string) { return mem[k] ?? null; },
      async setItem(k: string, v: string) { mem[k] = v; },
    };
  }
}

function cloneSettings(settings: Settings): Settings {
  return {
    ...settings,
    cloudModelProfiles: settings.cloudModelProfiles.map((profile) => ({ ...profile })),
    savedCommands: [...settings.savedCommands],
    dismissedRecommendedCommands: [...settings.dismissedRecommendedCommands],
    toolCircuitBreakerOverrides: { ...settings.toolCircuitBreakerOverrides },
    toolConfigurationOverrides: Object.fromEntries(
      Object.entries(settings.toolConfigurationOverrides).map(([name, value]) => [
        name,
        { ...value },
      ]),
    ),
  };
}

function normalizeCloudProvider(value: unknown): CloudProvider {
  return value === 'anthropic' || value === 'openai' || value === 'openrouter'
    ? value
    : 'auto';
}

function normalizeCloudModelProfiles(
  value: unknown,
  legacy: Pick<Settings, 'cloudProvider' | 'cloudBaseUrl' | 'cloudApiKey' | 'cloudModel'>,
): CloudModelProfile[] {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const normalized: CloudModelProfile[] = [];
  for (const candidate of source) {
    if (!candidate || typeof candidate !== 'object') continue;
    const raw = candidate as Partial<CloudModelProfile>;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push({
      id,
      provider: normalizeCloudProvider(raw.provider),
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
      model: typeof raw.model === 'string' ? raw.model : '',
      contextWindowTokens: normalizeModelContextWindowTokens(
        raw.contextWindowTokens,
        typeof raw.model === 'string' ? raw.model : '',
      ),
    });
  }
  if (normalized.length > 0) return normalized;
  return [{
    id: DEFAULT_CLOUD_MODEL_PROFILE.id,
    provider: normalizeCloudProvider(legacy.cloudProvider),
    baseUrl: legacy.cloudBaseUrl,
    apiKey: legacy.cloudApiKey,
    model: legacy.cloudModel,
    contextWindowTokens: resolveModelContextWindow(legacy.cloudModel),
  }];
}

/**
 * Keep saved profiles and the legacy runtime projection in lockstep. This
 * lets the rest of the agent continue reading cloudBaseUrl/cloudApiKey/model
 * while settings UI and persistence support multiple independent profiles.
 */
function reconcileCloudModelSettings(settings: Settings): Settings {
  const profiles = normalizeCloudModelProfiles(settings.cloudModelProfiles, settings);
  const active = profiles.find((profile) => profile.id === settings.activeCloudModelProfileId)
    ?? profiles[0];
  return {
    ...settings,
    cloudModelProfiles: profiles,
    activeCloudModelProfileId: active.id,
    cloudProvider: active.provider,
    cloudBaseUrl: active.baseUrl,
    cloudApiKey: active.apiKey,
    cloudModel: active.model,
  };
}

let _cache: Settings = cloneSettings(DEFAULT_SETTINGS);
let _loaded = false;

type SettingsListener = (settings: Settings) => void;
const _listeners = new Set<SettingsListener>();

/** Subscribe to settings changes. Returns an unsubscribe function. */
export function subscribeSettings(fn: SettingsListener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

function _notify(): void {
  const snapshot = cloneSettings(_cache);
  _listeners.forEach((fn) => fn(snapshot));
}

/** Load settings from storage. Call once at app startup. */
export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await getStorage().getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings> & { __version?: number };
      const migrated = migrateSettings(parsed as Record<string, unknown>);
      _cache = reconcileCloudModelSettings({
        ...DEFAULT_SETTINGS,
        ...parsed,
        tavilyApiKey:
          typeof parsed.tavilyApiKey === 'string'
            ? parsed.tavilyApiKey
            : DEFAULT_SETTINGS.tavilyApiKey,
        maxSteps: normalizeAgentSteps(parsed.maxSteps ?? DEFAULT_SETTINGS.maxSteps),
        consecutiveCircuitBreakerLimit: normalizeConsecutiveCircuitBlockLimit(
          parsed.consecutiveCircuitBreakerLimit,
        ),
        contextCompressionThresholdPercent: normalizeContextCompressionThresholdPercent(
          parsed.contextCompressionThresholdPercent,
        ),
        contextCompressionProtectedRecentRounds:
          normalizeContextCompressionProtectedRecentRounds(
            parsed.contextCompressionProtectedRecentRounds,
          ),
        savedCommands: Array.isArray(parsed.savedCommands)
          ? parsed.savedCommands.filter((value): value is string => typeof value === 'string')
          : [...DEFAULT_SETTINGS.savedCommands],
        dismissedRecommendedCommands: Array.isArray(parsed.dismissedRecommendedCommands)
          ? parsed.dismissedRecommendedCommands.filter(
            (value): value is string => typeof value === 'string',
          )
          : [...DEFAULT_SETTINGS.dismissedRecommendedCommands],
        toolCircuitBreakerOverrides: normalizeToolCircuitBreakerOverrides(
          parsed.toolCircuitBreakerOverrides,
        ),
        toolConfigurationOverrides: normalizeToolConfigurationOverrides(
          parsed.toolConfigurationOverrides,
        ),
      } as Settings);
      // Persist the migration immediately so it survives a re-install of an
      // older build and the toggle stays off.
      if (migrated) {
        try {
          await getStorage().setItem(
            SETTINGS_KEY,
            JSON.stringify({ ..._cache, __version: SETTINGS_VERSION }),
          );
        } catch {
          // Ignore storage errors
        }
      }
    }
  } catch {
    // Ignore parse errors -- fall back to defaults
  }
  _loaded = true;
  return cloneSettings(_cache);
}

/** Synchronous read of the cached settings. */
export function getSettings(): Settings {
  return cloneSettings(_cache);
}

/** Merge a partial patch into the settings and persist. */
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  let next: Settings = {
    ..._cache,
    ...patch,
    maxSteps: patch.maxSteps === undefined
      ? _cache.maxSteps
      : normalizeAgentSteps(patch.maxSteps),
    consecutiveCircuitBreakerLimit:
      patch.consecutiveCircuitBreakerLimit === undefined
        ? _cache.consecutiveCircuitBreakerLimit
        : normalizeConsecutiveCircuitBlockLimit(patch.consecutiveCircuitBreakerLimit),
    contextCompressionThresholdPercent:
      patch.contextCompressionThresholdPercent === undefined
        ? _cache.contextCompressionThresholdPercent
        : normalizeContextCompressionThresholdPercent(
          patch.contextCompressionThresholdPercent,
        ),
    contextCompressionProtectedRecentRounds:
      patch.contextCompressionProtectedRecentRounds === undefined
        ? _cache.contextCompressionProtectedRecentRounds
        : normalizeContextCompressionProtectedRecentRounds(
          patch.contextCompressionProtectedRecentRounds,
        ),
    toolCircuitBreakerOverrides:
      patch.toolCircuitBreakerOverrides === undefined
        ? _cache.toolCircuitBreakerOverrides
        : normalizeToolCircuitBreakerOverrides(patch.toolCircuitBreakerOverrides),
    toolConfigurationOverrides:
      patch.toolConfigurationOverrides === undefined
        ? _cache.toolConfigurationOverrides
        : normalizeToolConfigurationOverrides(patch.toolConfigurationOverrides),
  };
  // Legacy current-profile fields remain public because the provider and
  // catalog read them synchronously. If a caller edits one directly, mirror
  // that edit back into the active saved profile before projecting again.
  const editsCurrentProfile = patch.cloudModelProfiles === undefined && (
    patch.cloudProvider !== undefined ||
    patch.cloudBaseUrl !== undefined ||
    patch.cloudApiKey !== undefined ||
    patch.cloudModel !== undefined
  );
  if (editsCurrentProfile) {
    const profiles = normalizeCloudModelProfiles(_cache.cloudModelProfiles, _cache);
    const activeId = patch.activeCloudModelProfileId ?? _cache.activeCloudModelProfileId;
    next.cloudModelProfiles = profiles.map((profile) => profile.id === activeId
      ? {
          ...profile,
          provider: patch.cloudProvider ?? profile.provider,
          baseUrl: patch.cloudBaseUrl ?? profile.baseUrl,
          apiKey: patch.cloudApiKey ?? profile.apiKey,
          model: patch.cloudModel ?? profile.model,
        }
      : profile);
  }
  _cache = reconcileCloudModelSettings(next);
  _notify();
  try {
    await getStorage().setItem(
      SETTINGS_KEY,
      JSON.stringify({ ..._cache, __version: SETTINGS_VERSION }),
    );
  } catch {
    // Ignore storage errors
  }
}

/** Reset all settings to factory defaults. */
export async function resetSettings(): Promise<void> {
  _cache = cloneSettings(DEFAULT_SETTINGS);
  _notify();
  try {
    await getStorage().setItem(
      SETTINGS_KEY,
      JSON.stringify({ ..._cache, __version: SETTINGS_VERSION }),
    );
  } catch {
    // Ignore storage errors
  }
}

/** Update one managed tool without replacing overrides belonging to others. */
export async function saveToolCircuitBreakerThreshold(
  toolName: string,
  threshold: ToolCircuitBreakerThreshold,
): Promise<void> {
  const canonical = canonicalToolName(toolName);
  const fallback = getDefaultToolCircuitBreakerThreshold(canonical);
  if (!fallback) return;
  const normalized = normalizeToolCircuitBreakerOverrides({ [canonical]: threshold });
  if (!normalized[canonical]) return;
  if (
    normalized[canonical].warningThreshold === fallback.warningThreshold &&
    normalized[canonical].blockThreshold === fallback.blockThreshold
  ) {
    await resetToolCircuitBreakerThreshold(canonical);
    return;
  }
  await saveSettings({
    toolCircuitBreakerOverrides: {
      ..._cache.toolCircuitBreakerOverrides,
      [canonical]: normalized[canonical],
    },
  });
}

/** Remove one override so the tool immediately displays its shared default. */
export async function resetToolCircuitBreakerThreshold(toolName: string): Promise<void> {
  const next = { ..._cache.toolCircuitBreakerOverrides };
  delete next[canonicalToolName(toolName)];
  await saveSettings({ toolCircuitBreakerOverrides: next });
}

/** Reset circuit-breaker policy only; unrelated settings remain untouched. */
export async function resetAllToolCircuitBreakerThresholds(): Promise<void> {
  await saveSettings({ toolCircuitBreakerOverrides: {} });
}

/** Replace one tool's sparse availability/metadata override without touching others. */
export async function saveToolConfigurationOverride(
  toolName: string,
  override: ToolConfigurationOverride,
): Promise<void> {
  const canonical = canonicalToolName(toolName);
  const normalized = normalizeToolConfigurationOverrides({ [canonical]: override });
  const next = { ..._cache.toolConfigurationOverrides };
  if (normalized[canonical]) next[canonical] = normalized[canonical];
  else delete next[canonical];
  await saveSettings({ toolConfigurationOverrides: next });
}

export async function resetToolConfigurationOverride(toolName: string): Promise<void> {
  const next = { ..._cache.toolConfigurationOverrides };
  delete next[canonicalToolName(toolName)];
  await saveSettings({ toolConfigurationOverrides: next });
}

export async function resetAllToolConfigurationOverrides(): Promise<void> {
  await saveSettings({ toolConfigurationOverrides: {} });
}

export function isSettingsLoaded(): boolean {
  return _loaded;
}
