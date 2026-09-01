/**
 * settingsStore migration tests: thinking mode is a supported, default-on
 * feature (v3). v1/v2 stores — whose `enableThinking` value was never an
 * explicit user choice (v1 default `true`, v2 force-migrated `false`) — are
 * migrated to `true` once; a v3 store reflects the user's explicit toggle.
 */

const mem: Record<string, string> = {};
const mockAsyncStorage = {
  __esModule: true,
  default: {
    async getItem(key: string) {
      return mem[key] ?? null;
    },
    async setItem(key: string, value: string) {
      mem[key] = value;
    },
  },
};

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

import {
  DEFAULT_SETTINGS,
  loadSettings,
  resetAllToolCircuitBreakerThresholds,
  resetAllToolConfigurationOverrides,
  resetSettings,
  resetToolCircuitBreakerThreshold,
  saveSettings,
  saveToolCircuitBreakerThreshold,
  saveToolConfigurationOverride,
} from '../settingsStore';

beforeEach(() => {
  Object.keys(mem).forEach((k) => delete mem[k]);
});

describe('settingsStore migration (thinking mode supported, v3)', () => {
  it('migrates a v1 store to enableThinking=true and persists the marker', async () => {
    mem['@deft/settings'] = JSON.stringify({ ...DEFAULT_SETTINGS, enableThinking: true });

    const settings = await loadSettings();
    expect(settings.enableThinking).toBe(true);
    // Migration is persisted so a reinstall of an older build cannot regress.
    const stored = JSON.parse(mem['@deft/settings']);
    expect(stored.enableThinking).toBe(true);
    expect(stored.__version).toBe(23);
  });

  it('migrates a v2 store (force-disabled by the old build) back to true', async () => {
    mem['@deft/settings'] = JSON.stringify({
      ...DEFAULT_SETTINGS,
      enableThinking: false,
      __version: 2,
    });

    const settings = await loadSettings();
    expect(settings.enableThinking).toBe(true);
    expect(JSON.parse(mem['@deft/settings']).__version).toBe(23);
  });

  it('preserves a v3 explicit thinking choice while upgrading to v4', async () => {
    mem['@deft/settings'] = JSON.stringify({
      ...DEFAULT_SETTINGS,
      enableThinking: false,
      __version: 3,
    });

    const settings = await loadSettings();
    expect(settings.enableThinking).toBe(false);
    expect(JSON.parse(mem['@deft/settings']).__version).toBe(23);
  });

  it('migrates stores without any version marker exactly once', async () => {
    mem['@deft/settings'] = JSON.stringify({ model: 'E2B' });

    const first = await loadSettings();
    expect(first.enableThinking).toBe(true);

    // Simulate the user turning it off: a fresh load must keep it off.
    await saveSettings({ enableThinking: false });
    const second = await loadSettings();
    expect(second.enableThinking).toBe(false);
  });

  it('resetSettings writes the current version marker and default', async () => {
    await resetSettings();
    const stored = JSON.parse(mem['@deft/settings']);
    expect(stored.__version).toBe(23);
    expect(stored.screenshotNodeMarkersEnabled).toBe(true);
    expect(stored.screenshotDownscalingEnabled).toBe(true);
    expect(stored.ocrEnhancementEnabled).toBe(true);
    expect(stored.nodeTargetGestureTapEnabled).toBe(true);
    expect(stored.enableThinking).toBe(true);
    expect(stored.maxSteps).toBe(50);
    expect(stored.maxHistoryItems).toBeUndefined();
    expect(stored.contextCompressionEnabled).toBe(true);
    expect(stored.contextCompressionThresholdPercent).toBe(85);
    expect(stored.contextCompressionProtectedRecentRounds).toBe(4);
    expect(stored.maxConversationHistoryTurns).toBe(2);
    expect(stored.forceVisualMode).toBe(false);
    expect(stored.recommendedCommandsEnabled).toBe(true);
    expect(stored.tavilyApiKey).toBe('');
  });

  it('persists the Tavily key independently from the active model credential', async () => {
    await resetSettings();
    await saveSettings({ tavilyApiKey: 'tvly-test' });

    const settings = await loadSettings();
    expect(settings.tavilyApiKey).toBe('tvly-test');
    expect(settings.cloudApiKey).toBe('');
  });

  it('migrates v18 installs to center-gesture-first and preserves a later rollback', async () => {
    mem['@deft/settings'] = JSON.stringify({
      ...DEFAULT_SETTINGS,
      nodeTargetGestureTapEnabled: false,
      __version: 18,
    });

    expect((await loadSettings()).nodeTargetGestureTapEnabled).toBe(true);
    expect(JSON.parse(mem['@deft/settings']).__version).toBe(23);

    await saveSettings({ nodeTargetGestureTapEnabled: false });
    expect((await loadSettings()).nodeTargetGestureTapEnabled).toBe(false);
  });

  it('enables the recommended command set by default and persists the setting', async () => {
    await resetSettings();
    expect((await loadSettings()).recommendedCommandsEnabled).toBe(true);
    expect((await loadSettings()).dismissedRecommendedCommands).toEqual([]);

    await saveSettings({ recommendedCommandsEnabled: true });
    expect((await loadSettings()).recommendedCommandsEnabled).toBe(true);
    expect(JSON.parse(mem['@deft/settings']).recommendedCommandsEnabled).toBe(true);
  });

  it('persists individually dismissed recommended commands', async () => {
    await resetSettings();
    await saveSettings({ dismissedRecommendedCommands: ['现在几点'] });

    expect((await loadSettings()).dismissedRecommendedCommands).toEqual(['现在几点']);
    expect(JSON.parse(mem['@deft/settings']).dismissedRecommendedCommands).toEqual(['现在几点']);
  });

  it('persists forced visual mode while keeping it off by default', async () => {
    await resetSettings();
    expect((await loadSettings()).forceVisualMode).toBe(false);

    await saveSettings({ forceVisualMode: true });
    expect((await loadSettings()).forceVisualMode).toBe(true);
    expect(JSON.parse(mem['@deft/settings']).forceVisualMode).toBe(true);
  });

  it('defaults OCR enhancement on and persists an explicit opt-out', async () => {
    const legacy = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    delete legacy.ocrEnhancementEnabled;
    legacy.__version = 21;
    mem['@deft/settings'] = JSON.stringify(legacy);

    expect((await loadSettings()).ocrEnhancementEnabled).toBe(true);
    expect(JSON.parse(mem['@deft/settings']).__version).toBe(23);

    await saveSettings({ ocrEnhancementEnabled: false });
    expect((await loadSettings()).ocrEnhancementEnabled).toBe(false);
    expect(JSON.parse(mem['@deft/settings']).ocrEnhancementEnabled).toBe(false);
  });

  it('defaults screenshot downscaling on and persists an explicit opt-out', async () => {
    const legacy = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    delete legacy.screenshotDownscalingEnabled;
    legacy.__version = 22;
    mem['@deft/settings'] = JSON.stringify(legacy);

    expect((await loadSettings()).screenshotDownscalingEnabled).toBe(true);
    expect(JSON.parse(mem['@deft/settings']).__version).toBe(23);

    await saveSettings({ screenshotDownscalingEnabled: false });
    expect((await loadSettings()).screenshotDownscalingEnabled).toBe(false);
    expect(JSON.parse(mem['@deft/settings']).screenshotDownscalingEnabled).toBe(false);
  });

  it('migrates the previous default to 50 while preserving explicit values', async () => {
    mem['@deft/settings'] = JSON.stringify({ ...DEFAULT_SETTINGS, maxSteps: 20, __version: 5 });
    expect((await loadSettings()).maxSteps).toBe(50);

    mem['@deft/settings'] = JSON.stringify({ ...DEFAULT_SETTINGS, maxSteps: 75, __version: 5 });
    expect((await loadSettings()).maxSteps).toBe(75);
  });

  it('defaults, migrates and clamps the consecutive circuit termination limit', async () => {
    const legacy = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    delete legacy.consecutiveCircuitBreakerLimit;
    legacy.__version = 19;
    mem['@deft/settings'] = JSON.stringify(legacy);

    expect((await loadSettings()).consecutiveCircuitBreakerLimit).toBe(8);
    expect(JSON.parse(mem['@deft/settings']).__version).toBe(23);

    await saveSettings({ consecutiveCircuitBreakerLimit: 100 });
    expect((await loadSettings()).consecutiveCircuitBreakerLimit).toBe(50);
    await saveSettings({ consecutiveCircuitBreakerLimit: 0 });
    expect((await loadSettings()).consecutiveCircuitBreakerLimit).toBe(1);
  });

  it('migrates the v8 task-named conversation limit to dialogue turns', async () => {
    const legacy = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    delete legacy.maxConversationHistoryTurns;
    legacy.maxConversationHistoryTasks = 7;
    legacy.__version = 8;
    mem['@deft/settings'] = JSON.stringify(legacy);

    const settings = await loadSettings();
    const stored = JSON.parse(mem['@deft/settings']);
    expect(settings.maxConversationHistoryTurns).toBe(7);
    expect(stored.maxConversationHistoryTurns).toBe(7);
    expect(stored.maxConversationHistoryTasks).toBeUndefined();
    expect(stored.__version).toBe(23);
  });

  it('migrates the former v8 default of 12 tasks to the new default of 8 turns', async () => {
    const legacy = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    delete legacy.maxConversationHistoryTurns;
    legacy.maxConversationHistoryTasks = 12;
    legacy.__version = 8;
    mem['@deft/settings'] = JSON.stringify(legacy);

    const settings = await loadSettings();
    expect(settings.maxConversationHistoryTurns).toBe(2);
  });

  it('enables context compression for v9 stores and removes the obsolete history window', async () => {
    const legacy = { ...DEFAULT_SETTINGS, maxHistoryItems: 35 } as Record<string, unknown>;
    delete legacy.contextCompressionEnabled;
    legacy.__version = 9;
    mem['@deft/settings'] = JSON.stringify(legacy);

    const settings = await loadSettings();
    expect(settings.contextCompressionEnabled).toBe(true);
    expect((settings as unknown as Record<string, unknown>).maxHistoryItems).toBeUndefined();
    expect(JSON.parse(mem['@deft/settings']).__version).toBe(23);
    expect(JSON.parse(mem['@deft/settings']).maxHistoryItems).toBeUndefined();

    await saveSettings({ contextCompressionEnabled: false });
    expect((await loadSettings()).contextCompressionEnabled).toBe(false);
  });

  it('migrates and clamps the configurable compression threshold percentage', async () => {
    const legacy = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    delete legacy.contextCompressionThresholdPercent;
    legacy.__version = 13;
    mem['@deft/settings'] = JSON.stringify(legacy);

    expect((await loadSettings()).contextCompressionThresholdPercent).toBe(85);
    await saveSettings({ contextCompressionThresholdPercent: 120 });
    expect((await loadSettings()).contextCompressionThresholdPercent).toBe(95);
    await saveSettings({ contextCompressionThresholdPercent: 20 });
    expect((await loadSettings()).contextCompressionThresholdPercent).toBe(20);
    await saveSettings({ contextCompressionThresholdPercent: -1 });
    expect((await loadSettings()).contextCompressionThresholdPercent).toBe(1);
  });

  it('migrates and clamps the configurable verbatim protection rounds', async () => {
    const legacy = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    delete legacy.contextCompressionProtectedRecentRounds;
    legacy.__version = 17;
    mem['@deft/settings'] = JSON.stringify(legacy);

    expect((await loadSettings()).contextCompressionProtectedRecentRounds).toBe(4);
    await saveSettings({ contextCompressionProtectedRecentRounds: 99 });
    expect((await loadSettings()).contextCompressionProtectedRecentRounds).toBe(20);
    await saveSettings({ contextCompressionProtectedRecentRounds: 7 });
    expect((await loadSettings()).contextCompressionProtectedRecentRounds).toBe(7);
    await saveSettings({ contextCompressionProtectedRecentRounds: 0 });
    expect((await loadSettings()).contextCompressionProtectedRecentRounds).toBe(1);
  });

  it('clamps the configured maximum to the supported 1–200 range', async () => {
    await resetSettings();
    await saveSettings({ maxSteps: 999 });
    expect((await loadSettings()).maxSteps).toBe(200);
    await saveSettings({ maxSteps: 0 });
    expect((await loadSettings()).maxSteps).toBe(1);
  });

  it('removes the obsolete visual-mode setting from persisted settings', async () => {
    mem['@deft/settings'] = JSON.stringify({
      ...DEFAULT_SETTINGS,
      useVision: false,
      __version: 6,
    });

    const settings = await loadSettings();
    expect('useVision' in settings).toBe(false);
    expect(JSON.parse(mem['@deft/settings']).useVision).toBeUndefined();
  });

  it('removes the obsolete tool preset from persisted settings', async () => {
    mem['@deft/settings'] = JSON.stringify({
      ...DEFAULT_SETTINGS,
      toolPreset: 'read_only',
      __version: 6,
    });

    const settings = await loadSettings();
    expect('toolPreset' in settings).toBe(false);
    expect(JSON.parse(mem['@deft/settings']).toolPreset).toBeUndefined();
    expect(JSON.parse(mem['@deft/settings']).__version).toBe(23);
  });
});

describe('settingsStore cloud model profiles', () => {
  it('migrates the legacy cloud endpoint into the first saved profile', async () => {
    const legacy = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    delete legacy.cloudModelProfiles;
    delete legacy.activeCloudModelProfileId;
    legacy.cloudProvider = 'openai';
    legacy.cloudBaseUrl = 'https://dashscope.example/v1';
    legacy.cloudApiKey = 'legacy-key';
    legacy.cloudModel = 'qwen3.7-flash';
    legacy.__version = 15;
    mem['@deft/settings'] = JSON.stringify(legacy);

    const settings = await loadSettings();
    expect(settings.cloudModelProfiles).toEqual([{
      id: 'default-cloud-model',
      provider: 'openai',
      baseUrl: 'https://dashscope.example/v1',
      apiKey: 'legacy-key',
      model: 'qwen3.7-flash',
      contextWindowTokens: 262_144,
    }]);
    expect(settings.activeCloudModelProfileId).toBe('default-cloud-model');
    expect(JSON.parse(mem['@deft/settings']).__version).toBe(23);
  });

  it('projects the selected profile into the runtime cloud fields', async () => {
    mem['@deft/settings'] = JSON.stringify({
      ...DEFAULT_SETTINGS,
      __version: 16,
      cloudModelProfiles: [
        {
          id: 'qwen',
          provider: 'openai',
          baseUrl: 'https://dashscope.example/v1',
          apiKey: 'qwen-key',
          model: 'qwen3.7-flash',
        },
        {
          id: 'glm',
          provider: 'openai',
          baseUrl: 'https://glm.example/v4',
          apiKey: 'glm-key',
          model: 'glm-4.6v-flash',
        },
      ],
      activeCloudModelProfileId: 'glm',
      cloudBaseUrl: 'stale',
      cloudApiKey: 'stale',
      cloudModel: 'stale',
    });

    const settings = await loadSettings();
    expect(settings.cloudBaseUrl).toBe('https://glm.example/v4');
    expect(settings.cloudApiKey).toBe('glm-key');
    expect(settings.cloudModel).toBe('glm-4.6v-flash');
  });

  it('keeps direct edits synchronized with only the active profile', async () => {
    mem['@deft/settings'] = JSON.stringify({
      ...DEFAULT_SETTINGS,
      __version: 16,
      cloudModelProfiles: [
        { id: 'one', provider: 'openai', baseUrl: 'https://one/v1', apiKey: 'one-key', model: 'one' },
        { id: 'two', provider: 'openai', baseUrl: 'https://two/v1', apiKey: 'two-key', model: 'two' },
      ],
      activeCloudModelProfileId: 'one',
    });
    await loadSettings();

    await saveSettings({ cloudModel: 'one-updated', cloudApiKey: 'new-key' });
    const settings = await loadSettings();
    expect(settings.cloudModelProfiles).toEqual([
      { id: 'one', provider: 'openai', baseUrl: 'https://one/v1', apiKey: 'new-key', model: 'one-updated', contextWindowTokens: 128_000 },
      { id: 'two', provider: 'openai', baseUrl: 'https://two/v1', apiKey: 'two-key', model: 'two', contextWindowTokens: 128_000 },
    ]);
  });

  it('preserves a user-configured context window per profile', async () => {
    mem['@deft/settings'] = JSON.stringify({
      ...DEFAULT_SETTINGS,
      __version: 21,
      cloudModelProfiles: [{
        id: 'custom',
        provider: 'openai',
        baseUrl: 'https://example.com/v1',
        apiKey: 'key',
        model: 'unknown-model',
        contextWindowTokens: 96_000,
      }],
      activeCloudModelProfileId: 'custom',
    });

    const settings = await loadSettings();
    expect(settings.cloudModelProfiles[0].contextWindowTokens).toBe(96_000);
  });

  it('persists profile order without changing the active runtime profile', async () => {
    const one = {
      id: 'one', provider: 'openai' as const, baseUrl: 'https://one/v1',
      apiKey: 'one-key', model: 'one', contextWindowTokens: 128_000,
    };
    const two = {
      id: 'two', provider: 'openai' as const, baseUrl: 'https://two/v1',
      apiKey: 'two-key', model: 'two', contextWindowTokens: 128_000,
    };
    await resetSettings();
    await saveSettings({
      cloudModelProfiles: [one, two],
      activeCloudModelProfileId: 'two',
    });
    await saveSettings({ cloudModelProfiles: [two, one] });

    const settings = await loadSettings();
    expect(settings.cloudModelProfiles.map((profile) => profile.id)).toEqual(['two', 'one']);
    expect(settings.activeCloudModelProfileId).toBe('two');
    expect(settings.cloudModel).toBe('two');
    expect(settings.cloudApiKey).toBe('two-key');
  });
});

describe('settingsStore per-tool configuration overrides', () => {
  it('normalizes valid fields independently and protects required tools', async () => {
    mem['@deft/settings'] = JSON.stringify({
      ...DEFAULT_SETTINGS,
      __version: 4,
      toolConfigurationOverrides: {
        browser_use: { enabled: false, label: '网页助手', description: '只在需要操作网页时使用。', uiEffect: 'none' },
        tap: { enabled: 'no', description: '', uiEffect: 'invalid' },
        open_app: { enabled: false },
        list_apps: { enabled: false },
        confirm_action: { enabled: false, label: '操作确认' },
      },
    });
    const settings = await loadSettings();
    expect(settings.toolConfigurationOverrides).toEqual({
      browser_manage: { enabled: false, label: '网页助手', description: '只在需要操作网页时使用。' },
    });
    expect(JSON.parse(mem['@deft/settings']).__version).toBe(23);
  });

  it('updates and resets one tool without replacing other tool metadata', async () => {
    mem['@deft/settings'] = JSON.stringify({ ...DEFAULT_SETTINGS, __version: 5 });
    await loadSettings();
    await saveToolConfigurationOverride('browser_use', {
      enabled: false,
      label: '浏览器',
      description: '动态网页操作工具',
      uiEffect: 'adaptive',
    });
    await saveToolConfigurationOverride('ui_tap', { enabled: false });
    await saveToolConfigurationOverride('browser_use', { enabled: true, description: '新描述' });

    const stored = JSON.parse(mem['@deft/settings']);
    expect(stored.toolConfigurationOverrides).toEqual({
      browser_manage: { enabled: true, description: '新描述' },
      ui_tap: { enabled: false },
    });
  });

  it('resets all tool metadata without changing thresholds or unrelated settings', async () => {
    mem['@deft/settings'] = JSON.stringify({
      ...DEFAULT_SETTINGS,
      __version: 5,
      model: 'E2B',
      toolCircuitBreakerOverrides: { tap: { warningThreshold: 1, blockThreshold: 2 } },
      toolConfigurationOverrides: { browser_use: { enabled: false } },
    });
    await loadSettings();
    await resetAllToolConfigurationOverrides();
    const stored = JSON.parse(mem['@deft/settings']);
    expect(stored.toolConfigurationOverrides).toEqual({});
    expect(stored.toolCircuitBreakerOverrides.ui_tap).toEqual({
      warningThreshold: 1,
      blockThreshold: 2,
    });
    expect(stored.model).toBe('E2B');
  });
});

describe('settingsStore tool circuit-breaker overrides', () => {
  it('keeps valid entries and drops invalid or safety-exempt entries independently', async () => {
    mem['@deft/settings'] = JSON.stringify({
      ...DEFAULT_SETTINGS,
      __version: 4,
      toolCircuitBreakerOverrides: {
        tap: { warningThreshold: 1, blockThreshold: 2 },
        scroll: { warningThreshold: 5, blockThreshold: 3 },
        task_complete: { warningThreshold: 1, blockThreshold: 2 },
      },
    });
    const settings = await loadSettings();
    expect(settings.toolCircuitBreakerOverrides).toEqual({
      ui_tap: { warningThreshold: 1, blockThreshold: 2 },
    });
  });

  it('updates and resets one tool without replacing others', async () => {
    mem['@deft/settings'] = JSON.stringify({ ...DEFAULT_SETTINGS, __version: 4 });
    await loadSettings();
    await saveToolCircuitBreakerThreshold('ui_tap', { warningThreshold: 1, blockThreshold: 2 });
    await saveToolCircuitBreakerThreshold('ui_scroll', { warningThreshold: 4, blockThreshold: 6 });
    await resetToolCircuitBreakerThreshold('ui_tap');

    const stored = JSON.parse(mem['@deft/settings']);
    expect(stored.toolCircuitBreakerOverrides).toEqual({
      ui_scroll: { warningThreshold: 4, blockThreshold: 6 },
    });
  });

  it('canonicalizes aliases and removes an override when values return to default', async () => {
    mem['@deft/settings'] = JSON.stringify({ ...DEFAULT_SETTINGS, __version: 4 });
    await loadSettings();
    await saveToolCircuitBreakerThreshold('tap', { warningThreshold: 1, blockThreshold: 2 });
    expect(JSON.parse(mem['@deft/settings']).toolCircuitBreakerOverrides.ui_tap).toEqual({
      warningThreshold: 1,
      blockThreshold: 2,
    });
    await saveToolCircuitBreakerThreshold('ui_tap', { warningThreshold: 2, blockThreshold: 4 });
    expect(JSON.parse(mem['@deft/settings']).toolCircuitBreakerOverrides.ui_tap).toBeUndefined();
  });

  it('resets all tool thresholds without changing unrelated settings', async () => {
    mem['@deft/settings'] = JSON.stringify({
      ...DEFAULT_SETTINGS,
      __version: 4,
      model: 'E2B',
      toolCircuitBreakerOverrides: { tap: { warningThreshold: 1, blockThreshold: 2 } },
    });
    await loadSettings();
    await resetAllToolCircuitBreakerThresholds();
    const stored = JSON.parse(mem['@deft/settings']);
    expect(stored.toolCircuitBreakerOverrides).toEqual({});
    expect(stored.model).toBe('E2B');
  });
});
