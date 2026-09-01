/**
 * SettingsScreen — agent configuration UI.
 *
 * Controls:
 *   - Model selection: E2B (faster, less capable) vs E4B (slower, smarter)
 *   - Cloud fallback: use a cloud LLM when on-device is unavailable
 *   - Max steps: cap on agent loop iterations (1–200)
 *   - Settle delay: ms to wait after each action (100–2000)
 *
 * Settings are loaded from storage on mount and saved immediately on change.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  DEFAULT_SETTINGS,
  type CloudModelProfile,
  type Settings,
  loadSettings,
  resetAllToolCircuitBreakerThresholds,
  resetAllToolConfigurationOverrides,
  resetSettings,
  resetToolCircuitBreakerThreshold,
  resetToolConfigurationOverride,
  saveSettings,
  saveToolCircuitBreakerThreshold,
  saveToolConfigurationOverride,
} from '../../src/store/settingsStore';
import {
  DEFAULT_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT,
  MAX_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT,
  MIN_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT,
  TOOL_CIRCUIT_BREAKER_CATALOG,
  TOOL_LOOP_HISTORY_SIZE,
  getDefaultToolCircuitBreakerThreshold,
  type ToolActionFamily,
  type ToolCircuitBreakerCatalogEntry,
  type ToolCircuitBreakerThreshold,
} from '../../src/device-agent/tools/ToolCircuitBreakerPolicy';
import {
  FORCE_VISUAL_BLOCKED_TOOLS,
  FORCE_VISUAL_REQUIRED_TOOL,
  MAX_TOOL_DESCRIPTION_LENGTH,
  MAX_TOOL_LABEL_LENGTH,
  REQUIRED_ENABLED_TOOLS,
  UI_EFFECT_LOCKED_TOOLS,
  type ToolConfigurationOverride,
} from '../../src/device-agent/tools/ToolConfiguration';
import {
  MAX_AGENT_STEPS,
  MIN_AGENT_STEPS,
} from '../../src/device-agent/agent/AgentLimits';
import {
  isOnDeviceLLMReady,
  subscribeIsLLMReady,
} from '../../src/agent/llmBridge';
import { downloadAndInitModel } from '../../src/agent/modelManager';
import {
  clearGlobalTokens,
  getGlobalTokens,
  subscribeTokenStats,
  type TokenUsage,
} from '../../src/store/tokenStats';
import {
  getFavorites,
  loadFavorites,
  removeFavorite,
  subscribeFavorites,
} from '../../src/store/favoritesStore';
import {
  applyConfigurationImport,
  parseConfigurationImport,
  serializeConfigurationExport,
} from '../../src/store/configurationTransfer';
import { getSkills, subscribeSkills } from '../../src/store/skillStore';
import { clearHistoricalContextAndLocalFiles } from '../../src/store/contextCleanup';
import { SkillsScreen } from './SkillsScreen';
import { ModelSuggestInput } from './ModelSuggestInput';
import {
  normalizeModelContextWindowTokens,
  resolveModelContextWindow,
} from '../../src/modelCatalog/modelContextWindow';
import { moveModelProfile } from '../../src/modelCatalog/reorderModelProfiles';

type LLMStatus = 'ready' | 'loading' | 'unavailable' | 'downloading';

const SETTINGS_TABS = [
  { key: 'general', label: '通用配置', icon: 'options-outline' },
  { key: 'model', label: '模型配置', icon: 'hardware-chip-outline' },
  { key: 'tools', label: '工具', icon: 'construct-outline' },
  { key: 'skills', label: '经验库', icon: 'book-outline' },
] as const;

function cloudDefaultBaseUrl(
  provider: Settings['cloudProvider'],
  model: string,
): string {
  if (provider === 'anthropic') return 'https://api.anthropic.com/v1';
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1';
  if (provider === 'openai') return 'https://api.openai.com/v1';
  return model.toLowerCase().startsWith('claude')
    ? 'https://api.anthropic.com/v1'
    : 'https://api.openai.com/v1';
}

export function SettingsScreen() {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [loaded, setLoaded] = useState(false);
  const [llmStatus, setLLMStatus] = useState<LLMStatus>(
    isOnDeviceLLMReady() ? 'ready' : 'unavailable',
  );
  const [downloadProgress, setDownloadProgress] = useState(0);
  const downloadProgressAnim = useRef(new Animated.Value(0)).current;
  const modelChangedRef = useRef(false);
  const [apiTestState, setApiTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [apiTestInfo, setApiTestInfo] = useState('');
  const [globalTokens, setGlobalTokens] = useState<TokenUsage>(getGlobalTokens());
  const [favorites, setFavorites] = useState<string[]>(getFavorites());
  const [configurationFileBusy, setConfigurationFileBusy] = useState<'import' | 'export' | null>(null);
  const [historyCleanupBusy, setHistoryCleanupBusy] = useState(false);
  const [skillCount, setSkillCount] = useState<number>(getSkills().length);
  const [activeTab, setActiveTab] = useState<'general' | 'model' | 'tools' | 'skills'>('general');

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
  }, []);

  const importConfiguration = useCallback(async () => {
    if (configurationFileBusy) return;
    setConfigurationFileBusy('import');
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/json', 'text/plain'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset) return;
      if (asset.size != null && asset.size > 5 * 1024 * 1024) {
        Alert.alert('无法导入', '配置文件不能超过 5 MB。');
        return;
      }
      const content = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (content.length > 5 * 1024 * 1024) {
        Alert.alert('无法导入', '配置文件不能超过 5 MB。');
        return;
      }
      const parsed = parseConfigurationImport(content);
      if (!parsed.ok) {
        const message = parsed.error === 'invalid_json'
          ? '文件不是有效的 JSON。'
          : parsed.error === 'unsupported_version'
            ? '配置文件版本不受支持。'
            : parsed.error === 'invalid_settings'
              ? '通用配置或模型配置内容无效。'
              : parsed.error === 'invalid_skills'
                ? '经验库内容无效。'
                : parsed.error === 'too_many_items'
                  ? '配置文件中的数据过多。'
                  : '文件格式不受支持。';
        Alert.alert('无法导入', message);
        return;
      }
      if (parsed.value.kind === 'configuration') {
        const confirmed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            '导入配置？',
            '将覆盖当前通用配置、模型配置及同名经验；本地额外经验和收藏不会删除。',
            [
              { text: '取消', style: 'cancel', onPress: () => resolve(false) },
              { text: '导入', onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
          );
        });
        if (!confirmed) return;
      }
      const result = await applyConfigurationImport(parsed.value);
      if (result.settingsImported) setSettings(await loadSettings());
      Alert.alert(
        '导入完成',
        result.settingsImported
          ? `已导入通用和模型配置；经验新增 ${result.skillsAdded} 条、更新 ${result.skillsUpdated} 条；收藏新增 ${result.favoritesAdded} 条。`
          : `旧版收藏文件已导入，新增 ${result.favoritesAdded} 条。`,
      );
    } catch {
      Alert.alert('无法导入', '读取文件失败，请重试。');
    } finally {
      setConfigurationFileBusy(null);
    }
  }, [configurationFileBusy]);

  const exportConfiguration = useCallback(async () => {
    if (configurationFileBusy) return;
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        '导出配置？',
        '导出文件包含模型 API 地址和密钥，请仅保存或分享到可信位置。',
        [
          { text: '取消', style: 'cancel', onPress: () => resolve(false) },
          { text: '继续导出', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
    if (!confirmed) return;
    setConfigurationFileBusy('export');
    let exportUri: string | null = null;
    try {
      if (!FileSystem.cacheDirectory) throw new Error('Cache directory unavailable');
      const date = new Date().toISOString().slice(0, 10);
      exportUri = `${FileSystem.cacheDirectory}doubao-configuration-${date}.json`;
      await FileSystem.writeAsStringAsync(exportUri, serializeConfigurationExport(), {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('无法导出', '当前设备不支持文件分享。');
        return;
      }
      await Sharing.shareAsync(exportUri, {
        mimeType: 'application/json',
        UTI: 'public.json',
        dialogTitle: '导出豆泡配置',
      });
    } catch {
      Alert.alert('无法导出', '创建或分享文件失败，请重试。');
    } finally {
      if (exportUri) {
        void FileSystem.deleteAsync(exportUri, { idempotent: true }).catch(() => {});
      }
      setConfigurationFileBusy(null);
    }
  }, [configurationFileBusy]);

  const handleClearHistoricalContext = useCallback(() => {
    if (historyCleanupBusy) return;
    Alert.alert(
      '清空历史上下文',
      '将清除当前对话、历史会话记录，以及本地任务日志和工具结果文件。设置、收藏和经验不会删除。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清空',
          style: 'destructive',
          onPress: () => {
            setHistoryCleanupBusy(true);
            void clearHistoricalContextAndLocalFiles()
              .then(() => Alert.alert('已清空', '历史上下文和本地文件已清除。'))
              .catch(() => Alert.alert('清空失败', '部分本地文件无法删除，请重试。'))
              .finally(() => setHistoryCleanupBusy(false));
          },
        },
      ],
    );
  }, [historyCleanupBusy]);

  // Favorites are shared with the chat screen; load once and keep in sync.
  useEffect(() => {
    void loadFavorites();
    return subscribeFavorites(setFavorites);
  }, []);

  // Experience library entry badge; the store is loaded at app startup.
  useEffect(() => {
    return subscribeSkills((all) => setSkillCount(all.filter((s) => s.deletedAt === null).length));
  }, []);

  useEffect(() => {
    return subscribeIsLLMReady((ready) => {
      if (ready) {
        setLLMStatus('ready');
        modelChangedRef.current = false;
      } else if (modelChangedRef.current) {
        setLLMStatus('loading');
      } else {
        setLLMStatus((s) => s === 'downloading' ? s : 'unavailable');
      }
    });
  }, []);

  useEffect(() => {
    Animated.timing(downloadProgressAnim, {
      toValue: downloadProgress,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [downloadProgress, downloadProgressAnim]);

  useEffect(() => {
    return subscribeTokenStats(() => setGlobalTokens(getGlobalTokens()));
  }, []);

  const handleDownload = useCallback(() => {
    setLLMStatus('downloading');
    setDownloadProgress(0);
    downloadAndInitModel(settings.model, {
      onProgress: (p) => setDownloadProgress(p),
      onComplete: () => {
        setLLMStatus('ready');
        setDownloadProgress(1);
      },
      onError: () => {
        setLLMStatus('unavailable');
        setDownloadProgress(0);
      },
    }).catch(() => {
      setLLMStatus('unavailable');
      setDownloadProgress(0);
    });
  }, [settings.model]);

  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (patch.model !== undefined && patch.model !== settings.model) {
      modelChangedRef.current = true;
      setLLMStatus('loading');
    }
    await saveSettings(patch);
  }, [settings]);

  const updateActiveCloudProfile = useCallback(async (
    patch: Partial<Pick<
      CloudModelProfile,
      'provider' | 'baseUrl' | 'apiKey' | 'model' | 'contextWindowTokens'
    >>,
  ) => {
    const profiles = settings.cloudModelProfiles.map((profile) =>
      profile.id === settings.activeCloudModelProfileId
        ? { ...profile, ...patch }
        : profile,
    );
    await update({
      cloudModelProfiles: profiles,
      ...(patch.provider !== undefined ? { cloudProvider: patch.provider } : {}),
      ...(patch.baseUrl !== undefined ? { cloudBaseUrl: patch.baseUrl } : {}),
      ...(patch.apiKey !== undefined ? { cloudApiKey: patch.apiKey } : {}),
      ...(patch.model !== undefined ? { cloudModel: patch.model } : {}),
    });
  }, [settings.activeCloudModelProfileId, settings.cloudModelProfiles, update]);

  const selectCloudModelProfile = useCallback(async (profile: CloudModelProfile) => {
    setApiTestState('idle');
    setApiTestInfo('');
    await update({
      activeCloudModelProfileId: profile.id,
      cloudProvider: profile.provider,
      cloudBaseUrl: profile.baseUrl,
      cloudApiKey: profile.apiKey,
      cloudModel: profile.model,
    });
  }, [update]);

  const addCloudModelProfile = useCallback(async () => {
    const id = `cloud-model-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const profile: CloudModelProfile = {
      id,
      provider: 'auto',
      baseUrl: '',
      apiKey: '',
      model: '',
      contextWindowTokens: resolveModelContextWindow(''),
    };
    setApiTestState('idle');
    setApiTestInfo('');
    await update({
      cloudModelProfiles: [...settings.cloudModelProfiles, profile],
      activeCloudModelProfileId: id,
      cloudProvider: profile.provider,
      cloudBaseUrl: profile.baseUrl,
      cloudApiKey: profile.apiKey,
      cloudModel: profile.model,
    });
  }, [settings.cloudModelProfiles, update]);

  const duplicateCloudModelProfile = useCallback(async (source: CloudModelProfile) => {
    const id = `cloud-model-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const profile: CloudModelProfile = {
      ...source,
      id,
    };
    const sourceIndex = settings.cloudModelProfiles.findIndex((item) => item.id === source.id);
    const insertAt = sourceIndex >= 0 ? sourceIndex + 1 : settings.cloudModelProfiles.length;
    const profiles = [...settings.cloudModelProfiles];
    profiles.splice(insertAt, 0, profile);
    setApiTestState('idle');
    setApiTestInfo('');
    await update({
      cloudModelProfiles: profiles,
      activeCloudModelProfileId: id,
      cloudProvider: profile.provider,
      cloudBaseUrl: profile.baseUrl,
      cloudApiKey: profile.apiKey,
      cloudModel: profile.model,
    });
  }, [settings.cloudModelProfiles, update]);

  const deleteCloudModelProfile = useCallback((profile: CloudModelProfile) => {
    if (settings.cloudModelProfiles.length <= 1) {
      Alert.alert('无法删除', '至少需要保留一个模型配置。');
      return;
    }
    Alert.alert(
      '删除模型配置',
      `确定删除“${profile.model.trim() || '未命名模型'}”的配置吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            const remaining = settings.cloudModelProfiles.filter((item) => item.id !== profile.id);
            const active = profile.id === settings.activeCloudModelProfileId
              ? remaining[0]
              : remaining.find((item) => item.id === settings.activeCloudModelProfileId)
                ?? remaining[0];
            setApiTestState('idle');
            setApiTestInfo('');
            void update({
              cloudModelProfiles: remaining,
              activeCloudModelProfileId: active.id,
              cloudProvider: active.provider,
              cloudBaseUrl: active.baseUrl,
              cloudApiKey: active.apiKey,
              cloudModel: active.model,
            });
          },
        },
      ],
    );
  }, [settings.activeCloudModelProfileId, settings.cloudModelProfiles, update]);

  const reorderCloudModelProfile = useCallback((fromIndex: number, toIndex: number) => {
    const profiles = moveModelProfile(settings.cloudModelProfiles, fromIndex, toIndex);
    void update({ cloudModelProfiles: profiles });
  }, [settings.cloudModelProfiles, update]);

  const handleReset = useCallback(async () => {
    await resetSettings();
    setSettings({ ...DEFAULT_SETTINGS });
  }, []);

  const updateToolThreshold = useCallback(async (
    toolName: string,
    kind: keyof ToolCircuitBreakerThreshold,
    value: number,
  ) => {
    const defaults = getDefaultToolCircuitBreakerThreshold(toolName);
    if (!defaults) return;
    const current = settings.toolCircuitBreakerOverrides[toolName] ?? defaults;
    let next: ToolCircuitBreakerThreshold = { ...current, [kind]: value };
    if (kind === 'warningThreshold' && next.warningThreshold >= next.blockThreshold) {
      next.blockThreshold = Math.min(TOOL_LOOP_HISTORY_SIZE, next.warningThreshold + 1);
    }
    if (kind === 'blockThreshold' && next.blockThreshold <= next.warningThreshold) {
      next.warningThreshold = Math.max(1, next.blockThreshold - 1);
    }
    setSettings((previous) => ({
      ...previous,
      toolCircuitBreakerOverrides:
        next.warningThreshold === defaults.warningThreshold &&
        next.blockThreshold === defaults.blockThreshold
          ? Object.fromEntries(
              Object.entries(previous.toolCircuitBreakerOverrides).filter(
                ([name]) => name !== toolName,
              ),
            )
          : {
              ...previous.toolCircuitBreakerOverrides,
              [toolName]: next,
            },
    }));
    await saveToolCircuitBreakerThreshold(toolName, next);
  }, [settings.toolCircuitBreakerOverrides]);

  const updateToolConfiguration = useCallback(async (
    toolName: string,
    patch: ToolConfigurationOverride,
  ) => {
    const entry = TOOL_CIRCUIT_BREAKER_CATALOG.find((item) => item.name === toolName);
    const current = settings.toolConfigurationOverrides[toolName] ?? {};
    const next: ToolConfigurationOverride = { ...current, ...patch };
    if (next.label === undefined || !next.label.trim() || next.label.trim() === entry?.label) {
      delete next.label;
    } else {
      next.label = next.label.trim();
    }
    if (
      next.description === undefined ||
      !next.description.trim() ||
      next.description.trim() === entry?.description
    ) {
      delete next.description;
    } else {
      next.description = next.description.trim();
    }
    setSettings((previous) => {
      const all = { ...previous.toolConfigurationOverrides };
      if (Object.keys(next).length > 0) all[toolName] = next;
      else delete all[toolName];
      return { ...previous, toolConfigurationOverrides: all };
    });
    await saveToolConfigurationOverride(toolName, next);
  }, [settings.toolConfigurationOverrides]);

  const resetOneTool = useCallback(async (toolName: string) => {
    setSettings((previous) => {
      const thresholds = { ...previous.toolCircuitBreakerOverrides };
      const configurations = { ...previous.toolConfigurationOverrides };
      delete thresholds[toolName];
      delete configurations[toolName];
      return {
        ...previous,
        toolCircuitBreakerOverrides: thresholds,
        toolConfigurationOverrides: configurations,
      };
    });
    await resetToolCircuitBreakerThreshold(toolName);
    await resetToolConfigurationOverride(toolName);
  }, []);

  const resetAllToolSettings = useCallback(async () => {
    setSettings((previous) => ({
      ...previous,
      toolCircuitBreakerOverrides: {},
      toolConfigurationOverrides: {},
      consecutiveCircuitBreakerLimit: DEFAULT_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT,
    }));
    await resetAllToolCircuitBreakerThresholds();
    await resetAllToolConfigurationOverrides();
    await saveSettings({
      consecutiveCircuitBreakerLimit: DEFAULT_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT,
    });
  }, []);

  const handleClearTokens = useCallback(() => {
    void clearGlobalTokens();
  }, []);

  const testCloudApi = useCallback(async () => {
    if (!settings.cloudApiKey.trim()) {
      setApiTestState('fail');
      setApiTestInfo('请先填写 API Key');
      return;
    }
    setApiTestState('testing');
    setApiTestInfo('');

    const start = Date.now();
    try {
      const provider = settings.cloudProvider;
      const model = settings.cloudModel.trim() || 'gpt-4o';
      const custom = settings.cloudBaseUrl.trim().replace(/\/+$/, '');
      const base = custom || cloudDefaultBaseUrl(provider, model);
      const isAnthropic =
        provider === 'anthropic' ||
        (provider === 'auto' && model.toLowerCase().startsWith('claude'));
      const url = isAnthropic ? `${base}/messages` : `${base}/chat/completions`;
      const body = JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }],
      });
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (isAnthropic) {
        headers['x-api-key'] = settings.cloudApiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers['Authorization'] = `Bearer ${settings.cloudApiKey}`;
      }

      const resp = await fetch(url, { method: 'POST', headers, body });
      const latency = Date.now() - start;
      if (resp.ok) {
        setApiTestState('ok');
        setApiTestInfo(`连接成功 · 延迟 ${latency}ms`);
      } else {
        setApiTestState('fail');
        setApiTestInfo(`HTTP ${resp.status} · ${latency}ms`);
      }
    } catch (err) {
      setApiTestState('fail');
      setApiTestInfo(`连接失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [settings]);

  if (!loaded) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>加载中…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Experience library management renders inside the skills tab; the app has
  // no navigation stack, so views switch with plain state.
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>设置</Text>
      </View>
      <View style={styles.tabBar}>
        {SETTINGS_TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={styles.tabItem}
            onPress={() => setActiveTab(t.key)}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === t.key }}
          >
            <Ionicons
              name={t.icon}
              size={18}
              color={activeTab === t.key ? '#059669' : '#4B5563'}
            />
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>
              {t.label}
            </Text>
            {t.key === 'skills' && skillCount > 0 && (
              <View style={[
                styles.tabBadge,
                activeTab === t.key && styles.tabBadgeActive,
              ]}>
                <Text style={[
                  styles.tabBadgeText,
                  activeTab === t.key && styles.tabBadgeTextActive,
                ]}>
                  {skillCount > 99 ? '99+' : skillCount}
                </Text>
              </View>
            )}
            {activeTab === t.key && <View style={styles.tabIndicator} />}
          </TouchableOpacity>
        ))}
      </View>
      {activeTab === 'skills' ? (
        <SkillsScreen />
      ) : (
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
        {activeTab === 'model' && (
          <>
        {/* ── Model ── */}
        <SectionHeader title="本地模型" />
        <View style={styles.card}>
          <ModelToggle
            value={settings.model}
            onChange={(model) => update({ model })}
          />
          <View style={styles.divider} />
          <LLMStatusRow status={llmStatus} />
          {llmStatus === 'downloading' && (
            <>
              <View style={styles.progressTrack}>
                <Animated.View
                  style={[
                    styles.progressFill,
                    {
                      width: downloadProgressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressLabel}>
                {Math.round(downloadProgress * 100)}%
              </Text>
            </>
          )}
          {llmStatus === 'unavailable' && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity style={styles.downloadButton} onPress={handleDownload} activeOpacity={0.8}>
                <Text style={styles.downloadButtonText}>下载模型</Text>
              </TouchableOpacity>
            </>
          )}
          <View style={styles.divider} />
          <SettingTip
            text={
              settings.model === 'E4B'
                ? 'Gemma 4 E4B — 4B 参数，推理更强，占用约 2.5 GB 存储。'
                : 'Gemma 4 E2B — 2B 参数，速度更快、更省内存，适合简单任务。'
            }
          />
        </View>

        {/* ── 模型与云端 API ── */}
        <SectionHeader title="模型与云端 API" />
        <View style={styles.card}>
          <ToggleRow
            label="云端模式"
            value={settings.providerMode === 'cloud'}
            onChange={(v) => update({ providerMode: v ? 'cloud' : 'local' })}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="LLM 脱敏日志（调试）"
            value={settings.llmDebugLog}
            onChange={(v) => update({ llmDebugLog: v })}
          />
          {settings.providerMode === 'cloud' && (
            <>
              <View style={styles.divider} />
              <CloudModelProfileList
                profiles={settings.cloudModelProfiles}
                activeId={settings.activeCloudModelProfileId}
                onSelect={selectCloudModelProfile}
                onAdd={addCloudModelProfile}
                onDuplicate={duplicateCloudModelProfile}
                onDelete={deleteCloudModelProfile}
                onMove={reorderCloudModelProfile}
              />
              <View style={styles.divider} />
              <CloudProviderRow
                value={settings.cloudProvider}
                onChange={(v) => updateActiveCloudProfile({ provider: v })}
              />
              <View style={styles.divider} />
              <TextRow
                label="API 地址"
                value={settings.cloudBaseUrl}
                placeholder="https://api.openai.com/v1"
                onChangeText={(v) => updateActiveCloudProfile({ baseUrl: v })}
              />
              <View style={styles.divider} />
              <ApiKeyRow
                value={settings.cloudApiKey}
                onChangeText={(v) => updateActiveCloudProfile({ apiKey: v })}
              />
              <View style={styles.divider} />
              <ModelSuggestInput
                value={settings.cloudModel}
                placeholder={CLOUD_MODEL_PLACEHOLDER[settings.cloudProvider]}
                provider={settings.cloudProvider}
                customBaseUrl={settings.cloudBaseUrl}
                onChangeText={(v) => updateActiveCloudProfile({
                  model: v,
                  contextWindowTokens: resolveModelContextWindow(v),
                })}
              />
              <View style={styles.divider} />
              <ContextWindowRow
                value={settings.cloudModelProfiles.find(
                  (profile) => profile.id === settings.activeCloudModelProfileId,
                )?.contextWindowTokens ?? resolveModelContextWindow(settings.cloudModel)}
                onChange={(v) => updateActiveCloudProfile({ contextWindowTokens: v })}
              />
              <View style={styles.divider} />
              <View style={styles.apiTestRow}>
                <TouchableOpacity
                  style={styles.apiTestButton}
                  onPress={testCloudApi}
                  disabled={apiTestState === 'testing'}
                  activeOpacity={0.7}
                >
                  <Text style={styles.apiTestButtonText}>
                    {apiTestState === 'testing' ? '测试中…' : '测试连接'}
                  </Text>
                </TouchableOpacity>
                {apiTestInfo ? (
                  <Text
                    style={[
                      styles.apiTestInfo,
                      apiTestState === 'ok' ? styles.apiTestOk : styles.apiTestFail,
                    ]}
                  >
                    {apiTestInfo}
                  </Text>
                ) : null}
              </View>
              <View style={styles.divider} />
              <View style={styles.apiTestRow}>
                <Text style={styles.globalTokenLabel}>全局累计消耗</Text>
                <Text style={styles.apiTestInfo}>
                  {globalTokens.total.toLocaleString()} tokens（提示{' '}
                  {globalTokens.prompt.toLocaleString()} / 生成{' '}
                  {globalTokens.completion.toLocaleString()}）
                </Text>
                <TouchableOpacity
                  style={styles.clearTokenButton}
                  onPress={handleClearTokens}
                  activeOpacity={0.7}
                >
                  <Text style={styles.clearTokenButtonText}>清空</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
          <View style={styles.divider} />
          <SettingTip
            text="云端模式：任务只调用已配置的云端 API，不会自动下载或加载本地模型。API 地址留空则使用所选服务商默认端点；可填写任意 OpenAI 兼容地址（智谱 / 百炼 / 火山方舟等）。"
          />
        </View>

          </>
        )}
        {activeTab === 'tools' && (
          <ToolsSettingsTab
            settings={settings}
            onTavilyApiKeyChange={(value) => update({ tavilyApiKey: value })}
            onConsecutiveBlockLimitChange={(value) =>
              update({ consecutiveCircuitBreakerLimit: value })
            }
            onChange={updateToolThreshold}
            onConfigurationChange={updateToolConfiguration}
            onResetOne={resetOneTool}
            onResetAll={resetAllToolSettings}
          />
        )}
        {activeTab === 'general' && (
          <>
        {/* ── Agent loop ── */}
        <SectionHeader title="执行配置" />
        <View style={styles.card}>
          <StepperRow
            label="最大步数"
            value={settings.maxSteps}
            min={MIN_AGENT_STEPS}
            max={MAX_AGENT_STEPS}
            onChange={(v) => update({ maxSteps: v })}
          />
          <View style={styles.divider} />
          <StepperRow
            label="动作间隔（毫秒）"
            value={settings.settleMs}
            min={100}
            max={2000}
            step={100}
            unit="ms"
            onChange={(v) => update({ settleMs: v })}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="节点中心手势优先"
            value={settings.nodeTargetGestureTapEnabled}
            onChange={(v) => update({ nodeTargetGestureTapEnabled: v })}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="输出思考过程"
            value={settings.enableThinking}
            onChange={(v) => update({ enableThinking: v })}
          />
          <View style={styles.divider} />
          <StepperRow
            label="失败重试"
            value={settings.retryOnError}
            min={0}
            max={3}
            onChange={(v) => update({ retryOnError: v })}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="计划模式（拆分子任务）"
            value={settings.planMode}
            onChange={(v) => update({ planMode: v })}
          />
          {settings.planMode && (
            <>
              <View style={styles.divider} />
              <StepperRow
                label="最大子任务数"
                value={settings.maxSubTasks}
                min={1}
                max={20}
                onChange={(v) => update({ maxSubTasks: v })}
              />
            </>
          )}
          <View style={styles.divider} />
          <StepperRow
            label="超时（秒）"
            value={settings.timeoutSecs}
            min={0}
            max={300}
            step={30}
            unit="s"
            onChange={(v) => update({ timeoutSecs: v })}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="智能上下文压缩"
            value={settings.contextCompressionEnabled}
            onChange={(v) => update({ contextCompressionEnabled: v })}
          />
          {settings.contextCompressionEnabled && (
            <>
              <View style={styles.divider} />
              <PercentageSliderRow
                label="摘要触发阈值"
                value={settings.contextCompressionThresholdPercent}
                min={1}
                max={95}
                onChange={(v) => update({ contextCompressionThresholdPercent: v })}
              />
              <View style={styles.divider} />
              <StepperRow
                label="压缩时保留原文轮数"
                value={settings.contextCompressionProtectedRecentRounds}
                min={1}
                max={20}
                step={1}
                onChange={(v) => update({ contextCompressionProtectedRecentRounds: v })}
              />
            </>
          )}
          <View style={styles.divider} />
          <StepperRow
            label="连续会话保留对话轮数"
            value={settings.maxConversationHistoryTurns}
            min={0}
            max={50}
            step={1}
            onChange={(v) => update({ maxConversationHistoryTurns: v })}
          />
          <View style={styles.divider} />
          <StepperRow
            label="最大保留历史对话"
            value={settings.maxStoredSessions}
            min={10}
            max={200}
            step={10}
            onChange={(v) => update({ maxStoredSessions: v })}
          />
          <View style={styles.divider} />
          <StepperRow
            label="屏幕内容长度"
            value={settings.maxScreenLength}
            min={0}
            max={20000}
            step={2000}
            unit=" ch"
            onChange={(v) => update({ maxScreenLength: v })}
          />
          <View style={styles.divider} />
          <SettingTip
            text="最大步数：单个任务最多执行的动作数。动作间隔：每次操作后的等待时间。默认点击链路会查询实时原始无障碍树，以节点实时 bounds 的中心手势激活目标；手势被拒绝时降级到节点或可点击祖先动作。关闭“节点中心手势优先”可回滚到节点动作优先。失败重试：按指数退避重试失败的模型调用。计划模式：由模型把复杂任务拆成子任务执行。超时：N 秒后停止任务（0 = 不限制）。智能上下文压缩：每轮按固定规则卸载旧工具结果，估算上下文达到“摘要触发阈值”时生成一次摘要；关闭后不压缩可用上下文。压缩时保留原文轮数：压缩时分别保留最近 N 个历史轮次和最近 N 个真实对话轮次，两者取并集。连续会话保留对话轮数：本轮新指令最多携带此前多少轮用户与豆泡对话（每条用户消息开启一轮，0 = 不携带），并受 8,000 字符总上限保护。最大保留历史对话：历史栏最多保留的最近会话数（超出后自动丢弃最旧记录）。屏幕内容长度：截断无障碍树以保护上下文窗口（0 = 不截断）。"
          />
        </View>

        {/* ── Visual configuration ── */}
        <SectionHeader title="视觉配置" />
        <View style={styles.card}>
          <ToggleRow
            label="强制视觉模式"
            value={settings.forceVisualMode}
            onChange={(v) => update({ forceVisualMode: v })}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="截屏语义增强"
            value={settings.screenshotNodeMarkersEnabled}
            onChange={(v) => update({ screenshotNodeMarkersEnabled: v })}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="截屏缩放"
            value={settings.screenshotDownscalingEnabled}
            onChange={(v) => update({ screenshotDownscalingEnabled: v })}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="OCR 增强"
            value={settings.ocrEnhancementEnabled}
            onChange={(v) => update({ ocrEnhancementEnabled: v })}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="留存原始与标记截图（相册与调试目录）"
            value={settings.keepScreenshots}
            onChange={(v) => update({ keepScreenshots: v })}
          />
          <View style={styles.divider} />
          <SettingTip
            text="强制视觉模式：关闭独立结构查询工具，手机 UI 统一通过 screenshot 观察；截图仍同时附带近似同帧的无障碍树，并由 Agent 按需调用。截屏语义增强：在发送给模型的截图副本上绘制短期 ref 边框，不影响 ref 生成和点击逻辑。截屏缩放：默认将发送给模型的截图等比缩至最长边 2000 像素并以 JPEG 85 编码；OCR、坐标换算和本地截图仍使用原始尺寸。OCR 增强：允许 Agent 在截图时按需运行端侧 OCR，并返回可点击的文字 ref；关闭后不运行 OCR。截图留存仅用于本地调试。"
          />
        </View>

        {/* ── Custom instructions ── */}
        <SectionHeader title="自定义指令" />
        <View style={styles.card}>
          <CustomInstructionsInput
            value={settings.customInstructions}
            onChangeText={(v) => update({ customInstructions: v })}
          />
          <View style={styles.divider} />
          <SettingTip
            text="追加到每次模型调用提示词末尾的额外指令（云端与本地模型均生效）。可用于给 agent 设定行为规则、限制或补充背景信息。"
          />
        </View>

        {/* ── Context variables ── */}
        <SectionHeader title="上下文变量" />
        <View style={styles.card}>
          <ContextJsonInput
            value={settings.contextJson}
            onChangeText={(v) => update({ contextJson: v })}
          />
          <View style={styles.divider} />
          <SettingTip
            text={'每次调用都会注入到提示词中的键值对 JSON。示例：{"username":"张三","city":"北京"}。无效 JSON 会被忽略。'}
          />
        </View>

        {/* ── Command suggestions and favorites ── */}
        <SectionHeader title="指令" />
        <View style={styles.card}>
          <ToggleRow
            label="推荐指令集"
            value={settings.recommendedCommandsEnabled}
            onChange={(v) => update({ recommendedCommandsEnabled: v })}
          />
          <View style={styles.divider} />
          <SettingTip text="开启后，聊天首页展示系统内置的推荐指令；关闭时保持展示最近指令。不会修改你的收藏。" />
          <View style={styles.divider} />
          <View style={styles.commandGroupHeader}>
            <Text style={styles.commandGroupTitle}>收藏指令</Text>
            <Text style={styles.commandGroupCount}>{favorites.length} 条</Text>
          </View>
          {favorites.length > 0 ? (
            favorites.map((cmd) => (
              <React.Fragment key={cmd}>
                <View style={styles.divider} />
                <SavedCommandRow
                  text={cmd}
                  onRemove={() => removeFavorite(cmd)}
                />
              </React.Fragment>
            ))
          ) : (
            <>
              <View style={styles.divider} />
              <Text style={styles.commandEmptyText}>暂无收藏指令</Text>
            </>
          )}
          <View style={styles.divider} />
          <SettingTip text="在聊天中长按指令或左滑消息即可收藏；主页收藏入口可快速填入收藏指令。" />
        </View>

        {/* ── Voice ── */}
        <SectionHeader title="语音" />
        <View style={styles.card}>
          <ToggleRow
            label="按住说话模式"
            value={settings.voiceMode}
            onChange={(v) => update({ voiceMode: v })}
          />
          <View style={styles.divider} />
          <SettingTip
            text="按住麦克风录音，松手后自动识别并提交。优先使用端侧 Whisper 识别，不可用时回退系统语音识别；同时开启回复语音播报。"
          />
          <View style={styles.divider} />
          <ToggleRow
            label="语音播报回复（TTS）"
            value={settings.ttsEnabled}
            onChange={(v) => update({ ttsEnabled: v })}
          />
          <View style={styles.divider} />
          <SettingTip
            text="用语音播报 agent 的完成消息（端侧 Kokoro 或系统语音）。开启「按住说话」模式时自动启用。"
          />
        </View>

        {/* ── Portable configuration backup ── */}
        <SectionHeader title="配置备份" />
        <View style={styles.card}>
          <View style={styles.commandFileActions}>
            <TouchableOpacity
              style={[
                styles.commandFileButton,
                configurationFileBusy != null && styles.commandFileButtonDisabled,
              ]}
              onPress={importConfiguration}
              disabled={configurationFileBusy != null}
              accessibilityRole="button"
              accessibilityLabel="导入豆泡配置文件"
            >
              <Text style={styles.commandFileButtonText}>
                {configurationFileBusy === 'import' ? '导入中…' : '导入配置'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.commandFileButton,
                configurationFileBusy != null && styles.commandFileButtonDisabled,
              ]}
              onPress={exportConfiguration}
              disabled={configurationFileBusy != null}
              accessibilityRole="button"
              accessibilityLabel="导出豆泡配置文件"
            >
              <Text style={styles.commandFileButtonText}>
                {configurationFileBusy === 'export' ? '导出中…' : '导出配置'}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.divider} />
          <SettingTip text="一份 JSON 文件备份通用配置、模型配置、经验库和收藏指令。导入会覆盖配置和同名经验，但不删除本地额外经验或收藏。文件包含模型 API Key，请妥善保管。" />
        </View>

        {/* ── Historical context fallback ── */}
        <SectionHeader title="历史数据" />
        <View style={styles.card}>
          <View style={styles.apiTestRow}>
            <View style={styles.historyCleanupTextWrap}>
              <Text style={styles.historyCleanupLabel}>清空历史上下文</Text>
              <Text style={styles.historyCleanupHint}>
                清除当前对话、历史会话记录及本地任务文件，用于排除错误历史的持续影响。
              </Text>
            </View>
            <TouchableOpacity
              style={[
                styles.historyCleanupButton,
                historyCleanupBusy && styles.commandFileButtonDisabled,
              ]}
              onPress={handleClearHistoricalContext}
              disabled={historyCleanupBusy}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="清空历史上下文和本地文件"
            >
              <Text style={styles.historyCleanupButtonText}>
                {historyCleanupBusy ? '清理中…' : '清空'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Reset ── */}
        <TouchableOpacity style={styles.resetButton} onPress={handleReset} activeOpacity={0.7}>
          <Text style={styles.resetButtonText}>恢复默认设置</Text>
        </TouchableOpacity>

          </>
        )}
        </ScrollView>
      </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title.toUpperCase()}</Text>;
}

function LLMStatusRow({ status }: { status: LLMStatus }) {
  const config = {
    ready:       { label: '模型就绪',     dot: '#10B981', text: '#059669' },
    loading:     { label: '模型加载中…',  dot: '#FACC15', text: '#B45309' },
    unavailable: { label: '未下载',       dot: '#6B7280', text: '#6B7280' },
    downloading: { label: '下载中…',      dot: '#3B82F6', text: '#2563EB' },
  }[status];

  return (
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: config.dot }]} />
      <Text style={[styles.statusText, { color: config.text }]}>{config.label}</Text>
    </View>
  );
}

function SettingTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.tipWrap}>
      <TouchableOpacity
        style={styles.tipButton}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.tipIcon}>{open ? '×' : '?'}</Text>
      </TouchableOpacity>
      {open && <Text style={styles.tipText}>{text}</Text>}
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#E5E7EB', true: '#A7F3D0' }}
        thumbColor={value ? '#10B981' : '#9CA3AF'}
      />
    </View>
  );
}

function PercentageSliderRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);

  useEffect(() => {
    setDraft(value);
    draftRef.current = value;
  }, [value]);

  const valueAt = useCallback((locationX: number) => {
    if (trackWidth <= 0) return draftRef.current;
    const ratio = Math.max(0, Math.min(1, locationX / trackWidth));
    return Math.round(min + ratio * (max - min));
  }, [max, min, trackWidth]);

  const updateFromEvent = useCallback((event: GestureResponderEvent, commit: boolean) => {
    const next = valueAt(event.nativeEvent.locationX);
    draftRef.current = next;
    setDraft(next);
    if (commit) onChange(next);
  }, [onChange, valueAt]);

  const adjust = useCallback((delta: number) => {
    const next = Math.max(min, Math.min(max, draftRef.current + delta));
    draftRef.current = next;
    setDraft(next);
    onChange(next);
  }, [max, min, onChange]);

  const progress = max === min ? 0 : (draft - min) / (max - min);
  const thumbLeft = trackWidth > 0 ? progress * trackWidth - 9 : 0;

  return (
    <View style={styles.percentageSliderRow}>
      <View style={styles.percentageSliderHeader}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.percentageSliderValue}>{draft}%</Text>
      </View>
      <View
        style={styles.percentageSliderTouchArea}
        onLayout={(event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => updateFromEvent(event, false)}
        onResponderMove={(event) => updateFromEvent(event, false)}
        onResponderRelease={(event) => updateFromEvent(event, true)}
        onResponderTerminate={() => onChange(draftRef.current)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: draft, text: `${draft}%` }}
        accessibilityActions={[
          { name: 'increment', label: '增加百分比' },
          { name: 'decrement', label: '减少百分比' },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') adjust(1);
          if (event.nativeEvent.actionName === 'decrement') adjust(-1);
        }}
      >
        <View style={styles.percentageSliderTrack}>
          <View style={[styles.percentageSliderFill, { width: `${progress * 100}%` }]} />
        </View>
        <View style={[styles.percentageSliderThumb, { left: thumbLeft }]} />
      </View>
      <View style={styles.percentageSliderBounds}>
        <Text style={styles.percentageSliderBoundText}>{min}%</Text>
        <Text style={styles.percentageSliderBoundText}>{max}%</Text>
      </View>
    </View>
  );
}

function ModelToggle({
  value,
  onChange,
}: {
  value: 'E2B' | 'E4B';
  onChange: (v: 'E2B' | 'E4B') => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>模型</Text>
      <View style={styles.segmentControl}>
        {(['E2B', 'E4B'] as const).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.segment, value === m && styles.segmentActive]}
            onPress={() => onChange(m)}
            activeOpacity={0.75}
          >
            <Text style={[styles.segmentText, value === m && styles.segmentTextActive]}>
              {m}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function TextRow({
  label,
  value,
  placeholder,
  secureTextEntry,
  onChangeText,
}: {
  label: string;
  value: string;
  placeholder?: string;
  secureTextEntry?: boolean;
  onChangeText: (v: string) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <TextInput
        style={styles.textInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#444"
        secureTextEntry={secureTextEntry}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
      />
    </View>
  );
}

function ContextWindowRow({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = useCallback(() => {
    const normalized = normalizeModelContextWindowTokens(draft);
    setDraft(String(normalized));
    if (normalized !== value) onChange(normalized);
  }, [draft, onChange, value]);

  return (
    <View style={styles.contextWindowRow}>
      <View style={styles.contextWindowLabelWrap}>
        <Text style={styles.rowLabel}>最大上下文窗口</Text>
        <Text style={styles.contextWindowHint}>按 Token 填写，未知模型默认 128K</Text>
      </View>
      <TextInput
        style={styles.contextWindowInput}
        value={draft}
        onChangeText={(next) => setDraft(next.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onSubmitEditing={commit}
        keyboardType="number-pad"
        returnKeyType="done"
        selectTextOnFocus
        accessibilityLabel="最大上下文窗口 Token 数"
      />
    </View>
  );
}

/**
 * API Key row with an explicit lock: editing starts locked so an accidental
 * tap cannot clobber a configured key. Tapping the lock icon toggles between
 * locked (read-only) and unlocked (editable) states.
 */
function ApiKeyRow({
  value,
  onChangeText,
  label = 'API Key',
  placeholder = 'API Key',
}: {
  value: string;
  onChangeText: (v: string) => void;
  label?: string;
  placeholder?: string;
}) {
  const [locked, setLocked] = useState(true);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <TextInput
        style={[styles.textInput, locked && styles.textInputLocked]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#444"
        secureTextEntry
        editable={!locked}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
      />
      <TouchableOpacity
        onPress={() => setLocked((l) => !l)}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityLabel={locked ? `解锁编辑${label}` : `锁定${label}`}
        activeOpacity={0.6}
      >
        <Text style={styles.lockIcon}>{locked ? '🔒' : '🔓'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const CLOUD_MODEL_PLACEHOLDER: Record<Settings['cloudProvider'], string> = {
  auto: 'claude-sonnet-4-6 或 gpt-4o',
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  openrouter: 'google/gemma-3-27b-it',
};

const CLOUD_PROVIDERS: Array<{ value: Settings['cloudProvider']; label: string }> = [
  { value: 'auto',       label: '自动识别'   },
  { value: 'anthropic',  label: 'Anthropic'  },
  { value: 'openai',     label: 'OpenAI'     },
  { value: 'openrouter', label: 'OpenRouter' },
];

function CloudModelProfileList({
  profiles,
  activeId,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
  onMove,
}: {
  profiles: CloudModelProfile[];
  activeId: string;
  onSelect: (profile: CloudModelProfile) => void;
  onAdd: () => void;
  onDuplicate: (profile: CloudModelProfile) => void;
  onDelete: (profile: CloudModelProfile) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
}) {
  return (
    <View style={styles.modelProfileWrap}>
      <View style={styles.modelProfileHeader}>
        <View>
          <Text style={styles.modelProfileTitle}>已保存模型</Text>
          <Text style={styles.modelProfileHint}>点击切换，右侧可复制、排序或删除</Text>
        </View>
        <TouchableOpacity
          style={styles.modelProfileAddButton}
          onPress={onAdd}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="新增模型配置"
        >
          <Ionicons name="add" size={16} color="#047857" />
          <Text style={styles.modelProfileAddText}>新增</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.modelProfileList}>
        {profiles.map((profile, index) => (
          <DraggableCloudModelProfileRow
            key={profile.id}
            profile={profile}
            index={index}
            count={profiles.length}
            active={profile.id === activeId}
            onSelect={onSelect}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onMove={onMove}
          />
        ))}
      </View>
    </View>
  );
}

function DraggableCloudModelProfileRow({
  profile,
  index,
  count,
  active,
  onSelect,
  onDuplicate,
  onDelete,
  onMove,
}: {
  profile: CloudModelProfile;
  index: number;
  count: number;
  active: boolean;
  onSelect: (profile: CloudModelProfile) => void;
  onDuplicate: (profile: CloudModelProfile) => void;
  onDelete: (profile: CloudModelProfile) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
}) {
  const translateY = useRef(new Animated.Value(0)).current;
  const rowStepRef = useRef(78);
  const [dragging, setDragging] = useState(false);
  const label = profile.model.trim() || '未命名模型';

  const finishDrag = useCallback((dy: number) => {
    const offset = Math.round(dy / rowStepRef.current);
    const target = Math.max(0, Math.min(count - 1, index + offset));
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      speed: 24,
      bounciness: 0,
    }).start(() => {
      setDragging(false);
      if (target !== index) onMove(index, target);
    });
  }, [count, index, onMove, translateY]);

  const panResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 2,
    onPanResponderGrant: () => {
      setDragging(true);
      translateY.stopAnimation();
      translateY.setValue(0);
    },
    onPanResponderMove: (_event, gesture) => translateY.setValue(gesture.dy),
    onPanResponderRelease: (_event, gesture) => finishDrag(gesture.dy),
    onPanResponderTerminate: (_event, gesture) => finishDrag(gesture.dy),
    onPanResponderTerminationRequest: () => false,
  }), [finishDrag, translateY]);

  return (
    <Animated.View
      style={[
        styles.modelProfileItem,
        active && styles.modelProfileItemActive,
        dragging && styles.modelProfileItemDragging,
        { transform: [{ translateY }] },
      ]}
      onLayout={(event) => {
        rowStepRef.current = event.nativeEvent.layout.height + 8;
      }}
    >
      <TouchableOpacity
        style={styles.modelProfileSelectArea}
        onPress={() => onSelect(profile)}
        activeOpacity={0.72}
        accessibilityRole="radio"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`切换到${label}`}
      >
        <View style={[styles.modelProfileRadio, active && styles.modelProfileRadioActive]}>
          {active && <View style={styles.modelProfileRadioDot} />}
        </View>
        <View style={styles.modelProfileTextWrap}>
          <Text style={styles.modelProfileName} numberOfLines={1}>{label}</Text>
          <Text style={styles.modelProfileEndpoint} numberOfLines={1}>
            {profile.baseUrl.trim() || '使用服务商默认 API 地址'}
          </Text>
          <Text style={styles.modelProfileMeta} numberOfLines={1}>
            {profile.provider === 'auto' ? '自动识别协议' : profile.provider}
            {' · '}
            {profile.apiKey.trim() ? '已配置 API Key' : '未配置 API Key'}
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => onDuplicate(profile)}
        style={styles.modelProfileCopyButton}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={`复制${label}配置`}
      >
        <Ionicons name="copy-outline" size={17} color="#6B7280" />
      </TouchableOpacity>
      <View
        style={styles.modelProfileDragHandle}
        {...panResponder.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`拖动${label}排序`}
        accessibilityActions={[
          ...(index > 0 ? [{ name: 'decrement' as const, label: '上移' }] : []),
          ...(index < count - 1 ? [{ name: 'increment' as const, label: '下移' }] : []),
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'decrement' && index > 0) {
            onMove(index, index - 1);
          } else if (event.nativeEvent.actionName === 'increment' && index < count - 1) {
            onMove(index, index + 1);
          }
        }}
      >
        <Ionicons name="reorder-three-outline" size={22} color="#6B7280" />
      </View>
      <TouchableOpacity
        onPress={() => onDelete(profile)}
        style={styles.modelProfileDeleteButton}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={`删除${label}配置`}
      >
        <Ionicons name="trash-outline" size={17} color="#9CA3AF" />
      </TouchableOpacity>
    </Animated.View>
  );
}

function CloudProviderRow({
  value,
  onChange,
}: {
  value: Settings['cloudProvider'];
  onChange: (v: Settings['cloudProvider']) => void;
}) {
  return (
    <View style={styles.providerRow}>
      <Text style={styles.rowLabel}>模型服务商</Text>
      <View style={styles.providerControl}>
        {CLOUD_PROVIDERS.map((p) => (
          <TouchableOpacity
            key={p.value}
            style={[styles.providerSegment, value === p.value && styles.providerSegmentActive]}
            onPress={() => onChange(p.value)}
            activeOpacity={0.75}
          >
            <Text style={[styles.providerSegmentText, value === p.value && styles.providerSegmentTextActive]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function CustomInstructionsInput({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (v: string) => void;
}) {
  return (
    <TextInput
      style={styles.customInstructionsInput}
      value={value}
      onChangeText={onChangeText}
      placeholder="e.g. Never open social media apps. Always confirm before sending messages."
      placeholderTextColor="#3a3a3a"
      multiline
      numberOfLines={4}
      autoCapitalize="sentences"
      autoCorrect
      returnKeyType="default"
      textAlignVertical="top"
    />
  );
}

function ContextJsonInput({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (v: string) => void;
}) {
  return (
    <TextInput
      style={styles.customInstructionsInput}
      value={value}
      onChangeText={onChangeText}
      placeholder={'{"username":"Matt","language":"English"}'}
      placeholderTextColor="#3a3a3a"
      multiline
      numberOfLines={3}
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="default"
      textAlignVertical="top"
    />
  );
}

function SavedCommandRow({ text, onRemove }: { text: string; onRemove: () => void }) {
  return (
    <View style={styles.savedCmdRow}>
      <Ionicons name="star" size={16} color="#059669" />
      <Text style={styles.savedCmdText} numberOfLines={1}>{text}</Text>
      <TouchableOpacity
        onPress={onRemove}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.6}
      >
        <Text style={styles.savedCmdRemove}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

function StepperRow({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  const decrement = () => onChange(Math.max(min, value - step));
  const increment = () => onChange(Math.min(max, value + step));

  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.stepper}>
        <TouchableOpacity
          style={[styles.stepperBtn, value <= min && styles.stepperBtnDisabled]}
          onPress={decrement}
          disabled={value <= min}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.stepperBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.stepperValue}>
          {value}{unit ?? ''}
        </Text>
        <TouchableOpacity
          style={[styles.stepperBtn, value >= max && styles.stepperBtnDisabled]}
          onPress={increment}
          disabled={value >= max}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.stepperBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const TOOL_FAMILY_LABELS: Record<ToolActionFamily, string> = {
  navigation: '点击与导航',
  input: '文本与状态输入',
  gesture: '滚动与手势',
  wait: '等待与轮询',
  observation: '查询与观察',
  exempt: '安全豁免',
};

function ToolsSettingsTab({
  settings,
  onTavilyApiKeyChange,
  onConsecutiveBlockLimitChange,
  onChange,
  onConfigurationChange,
  onResetOne,
  onResetAll,
}: {
  settings: Settings;
  onTavilyApiKeyChange: (value: string) => void;
  onConsecutiveBlockLimitChange: (value: number) => void;
  onChange: (
    toolName: string,
    kind: keyof ToolCircuitBreakerThreshold,
    value: number,
  ) => void;
  onConfigurationChange: (toolName: string, patch: ToolConfigurationOverride) => void;
  onResetOne: (toolName: string) => void;
  onResetAll: () => void;
}) {
  const families: ToolActionFamily[] = [
    'navigation',
    'input',
    'gesture',
    'wait',
    'observation',
    'exempt',
  ];

  return (
    <>
      <SectionHeader title="联网搜索" />
      <View style={styles.card}>
        <ApiKeyRow
          label="Tavily API Key"
          placeholder="tvly-..."
          value={settings.tavilyApiKey}
          onChangeText={onTavilyApiKeyChange}
        />
        <View style={styles.divider} />
        <SettingTip text="web_search 默认使用 Tavily Basic 搜索。API Key 仅用于联网搜索，不会写入模型配置或提示词；工具仍可在下方单独启用、禁用和编辑描述。" />
      </View>
      <View style={styles.toolsIntroCard}>
        <Text style={styles.toolsIntroTitle}>工具熔断阈值</Text>
        <Text style={styles.toolsIntroText}>
          连续无进展达到警告值时提醒模型，达到阻断值时跳过重复执行。修改将在下一次新任务中生效。
        </Text>
        <View style={styles.divider} />
        <StepperRow
          label="连续熔断终止阈值"
          value={settings.consecutiveCircuitBreakerLimit}
          min={MIN_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT}
          max={MAX_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT}
          onChange={onConsecutiveBlockLimitChange}
        />
        <Text style={styles.toolsIntroText}>
          连续出现这么多次硬熔断后强制终止执行；任一工具实际开始执行即重新计数。
        </Text>
        <TouchableOpacity
          style={styles.toolResetAllButton}
          onPress={onResetAll}
          disabled={
            Object.keys(settings.toolCircuitBreakerOverrides).length === 0 &&
            Object.keys(settings.toolConfigurationOverrides).length === 0 &&
            settings.consecutiveCircuitBreakerLimit ===
              DEFAULT_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT
          }
          activeOpacity={0.7}
        >
          <Text style={styles.toolResetText}>全部恢复默认</Text>
        </TouchableOpacity>
      </View>
      {families.map((family) => {
        const entries = TOOL_CIRCUIT_BREAKER_CATALOG.filter((entry) => entry.family === family);
        if (entries.length === 0) return null;
        return (
          <React.Fragment key={family}>
            <SectionHeader title={TOOL_FAMILY_LABELS[family]} />
            {entries.map((entry) => {
              const forcedState = settings.forceVisualMode
                ? entry.name === FORCE_VISUAL_REQUIRED_TOOL
                  ? 'enabled'
                  : FORCE_VISUAL_BLOCKED_TOOLS.has(entry.name)
                    ? 'disabled'
                    : undefined
                : undefined;
              const configuredEnabled =
                REQUIRED_ENABLED_TOOLS.has(entry.name) ||
                (settings.toolConfigurationOverrides[entry.name]?.enabled ?? true);
              return (
                <ToolThresholdCard
                  key={entry.name}
                  entry={entry}
                  enabled={forcedState ? forcedState === 'enabled' : configuredEnabled}
                  forcedState={forcedState}
                  configuration={settings.toolConfigurationOverrides[entry.name] ?? {}}
                  value={
                    settings.toolCircuitBreakerOverrides[entry.name] ??
                    getDefaultToolCircuitBreakerThreshold(entry.name)
                  }
                  overridden={
                    settings.toolCircuitBreakerOverrides[entry.name] !== undefined ||
                    settings.toolConfigurationOverrides[entry.name] !== undefined
                  }
                  onChange={onChange}
                  onConfigurationChange={onConfigurationChange}
                  onReset={onResetOne}
                />
              );
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}

function ToolThresholdCard({
  entry,
  enabled,
  forcedState,
  configuration,
  value,
  overridden,
  onChange,
  onConfigurationChange,
  onReset,
}: {
  entry: ToolCircuitBreakerCatalogEntry;
  enabled: boolean;
  forcedState?: 'enabled' | 'disabled';
  configuration: ToolConfigurationOverride;
  value: ToolCircuitBreakerThreshold | null;
  overridden: boolean;
  onChange: (
    toolName: string,
    kind: keyof ToolCircuitBreakerThreshold,
    value: number,
  ) => void;
  onConfigurationChange: (toolName: string, patch: ToolConfigurationOverride) => void;
  onReset: (toolName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const uiEffect = configuration.uiEffect ?? defaultUiEffectSetting(entry);
  return (
    <View style={styles.toolCard}>
      <View style={styles.toolHeaderRow}>
        <View style={styles.toolTitleWrap}>
          <Text style={styles.toolTitle}>{configuration.label ?? entry.label}</Text>
          <Text style={styles.toolName}>{entry.name}</Text>
        </View>
        <Text style={[styles.toolStatus, enabled ? styles.toolStatusEnabled : styles.toolStatusDisabled]}>
          {forcedState
            ? forcedState === 'enabled' ? '视觉模式必需' : '视觉模式禁用'
            : enabled
            ? REQUIRED_ENABLED_TOOLS.has(entry.name)
              ? '必需工具'
              : entry.behavior === 'exempt'
                ? '不熔断'
                : '已启用'
            : '已禁用'}
        </Text>
      </View>
      <View style={styles.toolConfigurationRow}>
        <Text style={styles.toolConfigurationLabel}>允许模型使用</Text>
        <Switch
          value={enabled}
          disabled={REQUIRED_ENABLED_TOOLS.has(entry.name) || forcedState !== undefined}
          onValueChange={(next) => onConfigurationChange(entry.name, { enabled: next })}
          trackColor={{ false: '#D1D5DB', true: '#A7F3D0' }}
          thumbColor={enabled ? '#059669' : '#F9FAFB'}
        />
      </View>
      <TouchableOpacity
        style={styles.toolExpandRow}
        onPress={() => setExpanded((current) => !current)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <Text style={styles.toolExpandText}>{expanded ? '收起详细配置' : '展开详细配置'}</Text>
        <Text style={styles.toolExpandIcon}>{expanded ? '⌃' : '⌄'}</Text>
      </TouchableOpacity>
      {expanded && (
        <>
          <View style={styles.toolDivider} />
      {!UI_EFFECT_LOCKED_TOOLS.has(entry.name) && (
        <View style={styles.toolUiEffectRow}>
        <Text style={styles.toolConfigurationLabel}>是否会改变 UI</Text>
        <View style={styles.toolUiEffectOptions}>
          {([
            ['change', '是'],
            ['none', '否'],
            ['adaptive', '自适应'],
          ] as const).map(([value, label]) => (
            <TouchableOpacity
              key={value}
              style={[
                styles.toolUiEffectOption,
                uiEffect === value && styles.toolUiEffectOptionActive,
              ]}
              onPress={() => onConfigurationChange(entry.name, { uiEffect: value })}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.toolUiEffectOptionText,
                uiEffect === value && styles.toolUiEffectOptionTextActive,
              ]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        </View>
      )}
      {!UI_EFFECT_LOCKED_TOOLS.has(entry.name) && uiEffect === 'adaptive' && (
        <Text style={styles.toolUiEffectHint}>每次调用时由模型判断该动作是否会改变屏幕状态。</Text>
      )}
      {REQUIRED_ENABLED_TOOLS.has(entry.name) && (
        <Text style={styles.toolRequiredText}>核心执行、安全确认或任务结束流程依赖此工具，因此不可禁用。</Text>
      )}
      {forcedState && (
        <Text style={styles.toolRequiredText}>
          {forcedState === 'enabled'
            ? '强制视觉模式下 screenshot 始终可用。'
            : '强制视觉模式下页面结构工具不可用；关闭该模式后恢复原配置。'}
        </Text>
      )}
      <View style={styles.toolMetadataWrap}>
        <Text style={styles.toolMetadataLabel}>显示名称</Text>
        <TextInput
          key={`${entry.name}:label:${configuration.label ?? ''}`}
          style={styles.toolMetadataInput}
          defaultValue={configuration.label ?? entry.label}
          maxLength={MAX_TOOL_LABEL_LENGTH}
          onEndEditing={(event) =>
            onConfigurationChange(entry.name, { label: event.nativeEvent.text })
          }
        />
        <Text style={styles.toolMetadataLabel}>模型描述</Text>
        <TextInput
          key={`${entry.name}:description:${configuration.description ?? ''}`}
          style={[styles.toolMetadataInput, styles.toolDescriptionInput]}
          defaultValue={configuration.description ?? entry.description}
          multiline
          maxLength={MAX_TOOL_DESCRIPTION_LENGTH}
          textAlignVertical="top"
          onEndEditing={(event) =>
            onConfigurationChange(entry.name, { description: event.nativeEvent.text })
          }
        />
        <Text style={styles.toolMetadataHint}>工具名和参数结构固定不变；描述将在下一次新任务中提供给模型。</Text>
      </View>
      {entry.behavior === 'exempt' || !value ? (
        <Text style={styles.toolExemptText}>为保证确认和任务结束路径可用，此工具固定豁免。</Text>
      ) : (
        <>
          <View style={styles.toolDivider} />
          <StepperRow
            label="警告阈值"
            value={value.warningThreshold}
            min={1}
            max={TOOL_LOOP_HISTORY_SIZE - 1}
            onChange={(next) => onChange(entry.name, 'warningThreshold', next)}
          />
          {entry.behavior === 'block' ? (
            <>
              <View style={styles.toolDivider} />
              <StepperRow
                label="阻断阈值"
                value={value.blockThreshold}
                min={2}
                max={TOOL_LOOP_HISTORY_SIZE}
                onChange={(next) => onChange(entry.name, 'blockThreshold', next)}
              />
            </>
          ) : (
            <Text style={styles.toolExemptText}>只读工具达到阈值后提醒换用推进动作，不阻断读取。</Text>
          )}
          {overridden && (
            <TouchableOpacity
              style={styles.toolResetOneButton}
              onPress={() => onReset(entry.name)}
              activeOpacity={0.7}
            >
              <Text style={styles.toolResetText}>恢复此工具默认值</Text>
            </TouchableOpacity>
          )}
        </>
      )}
        </>
      )}
    </View>
  );
}

function defaultUiEffectSetting(
  entry: ToolCircuitBreakerCatalogEntry,
): NonNullable<ToolConfigurationOverride['uiEffect']> {
  if (entry.name === 'browser_use' || entry.family === 'wait') return 'adaptive';
  if (entry.name === 'confirm_action' || entry.name === 'ask_user') return 'change';
  if (entry.family === 'navigation' || entry.family === 'input' || entry.family === 'gesture') {
    return 'change';
  }
  return 'none';
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F6F7F9',
  },

  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#6B7280',
    fontSize: 14,
  },

  header: {
    paddingLeft: 64,
    paddingRight: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2329',
    letterSpacing: -0.3,
  },

  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 6,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  tabItem: {
    flex: 1,
    minHeight: 54,
    paddingHorizontal: 2,
    paddingTop: 2,
    paddingBottom: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    position: 'relative',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  tabTextActive: {
    color: '#059669',
    fontWeight: '700',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: -1,
    width: 44,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#059669',
  },
  tabBadge: {
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  tabBadgeActive: {
    backgroundColor: '#D1FAE5',
  },
  tabBadgeText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    color: '#6B7280',
  },
  tabBadgeTextActive: {
    color: '#047857',
  },

  scroll: {
    flex: 1,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 40,
    gap: 8,
  },

  sectionHeader: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 0.8,
    paddingHorizontal: 4,
    marginTop: 16,
    marginBottom: 6,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F3F5',
    marginHorizontal: 16,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  rowLabel: {
    fontSize: 15,
    color: '#3C4048',
    flex: 1,
  },
  percentageSliderRow: {
    paddingHorizontal: 16,
    paddingTop: 13,
    paddingBottom: 10,
  },
  percentageSliderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  percentageSliderValue: {
    minWidth: 48,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '700',
    color: '#059669',
  },
  percentageSliderTouchArea: {
    height: 30,
    justifyContent: 'center',
  },
  percentageSliderTrack: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: '#E5E7EB',
  },
  percentageSliderFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  percentageSliderThumb: {
    position: 'absolute',
    top: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#059669',
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  percentageSliderBounds: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  percentageSliderBoundText: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  textInput: {
    flex: 2,
    fontSize: 13,
    color: '#3C4048',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F1F3F5',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  contextWindowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  contextWindowLabelWrap: {
    flex: 1,
  },
  contextWindowHint: {
    color: '#9CA3AF',
    fontSize: 11,
    marginTop: 3,
  },
  contextWindowInput: {
    width: 116,
    fontSize: 13,
    color: '#3C4048',
    textAlign: 'right',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  textInputLocked: {
    opacity: 0.55,
  },
  lockIcon: {
    fontSize: 16,
  },
  modelProfileWrap: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  modelProfileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  modelProfileTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2329',
  },
  modelProfileHint: {
    marginTop: 2,
    fontSize: 11,
    color: '#6B7280',
  },
  modelProfileAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  modelProfileAddText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#047857',
  },
  modelProfileList: {
    gap: 8,
  },
  modelProfileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 11,
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  modelProfileItemActive: {
    borderColor: '#6EE7B7',
    backgroundColor: '#ECFDF5',
  },
  modelProfileItemDragging: {
    zIndex: 10,
    elevation: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
  },
  modelProfileSelectArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modelProfileRadio: {
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelProfileRadioActive: {
    borderColor: '#059669',
  },
  modelProfileRadioDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#059669',
  },
  modelProfileTextWrap: {
    flex: 1,
  },
  modelProfileName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F2329',
  },
  modelProfileEndpoint: {
    marginTop: 2,
    fontSize: 11,
    color: '#4B5563',
  },
  modelProfileMeta: {
    marginTop: 2,
    fontSize: 10,
    color: '#6B7280',
  },
  modelProfileDeleteButton: {
    padding: 5,
  },
  modelProfileCopyButton: {
    padding: 5,
  },
  modelProfileDragHandle: {
    width: 30,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },

  tipWrap: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'flex-end',
  },
  tipButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipIcon: {
    fontSize: 13,
    fontWeight: '700',
    color: '#059669',
    lineHeight: 16,
  },
  tipText: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 18,
    marginTop: 8,
    width: '100%',
  },
  apiTestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  apiTestButton: {
    backgroundColor: '#10B981',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  apiTestButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  apiTestInfo: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  globalTokenLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1F2329',
  },
  clearTokenButton: {
    backgroundColor: '#FDECEC',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  clearTokenButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#EF4444',
  },
  historyCleanupTextWrap: {
    flex: 1,
    gap: 4,
  },
  historyCleanupLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2329',
  },
  historyCleanupHint: {
    fontSize: 12,
    lineHeight: 17,
    color: '#6B7280',
  },
  historyCleanupButton: {
    backgroundColor: '#FDECEC',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  historyCleanupButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#DC2626',
  },
  apiTestOk: {
    color: '#059669',
  },
  apiTestFail: {
    color: '#EF4444',
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // Segment control (E2B / E4B)
  segmentControl: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F1F3F5',
    overflow: 'hidden',
  },
  segment: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  segmentActive: {
    backgroundColor: '#fff',
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  segmentTextActive: {
    color: '#F6F7F9',
  },

  // Stepper
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F1F3F5',
    borderWidth: 1,
    borderColor: '#F1F3F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: {
    opacity: 0.35,
  },
  stepperBtnText: {
    fontSize: 18,
    color: '#3C4048',
    fontWeight: '400',
    lineHeight: 22,
  },
  stepperValue: {
    fontSize: 15,
    color: '#3C4048',
    fontWeight: '600',
    minWidth: 44,
    textAlign: 'center',
  },

  // Model download button + progress
  downloadButton: {
    marginHorizontal: 16,
    marginVertical: 12,
    backgroundColor: '#10B981',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  downloadButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  progressTrack: {
    marginHorizontal: 16,
    marginTop: 10,
    height: 4,
    backgroundColor: '#E9ECF0',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 2,
  },
  progressLabel: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 6,
    fontSize: 11,
    color: '#2563EB',
    textAlign: 'right',
  },

  // Cloud provider selector
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  providerControl: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  providerSegment: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  providerSegmentActive: {
    backgroundColor: '#10B981',
  },
  providerSegmentText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  providerSegmentTextActive: {
    color: '#FFFFFF',
  },

  // Custom instructions
  customInstructionsInput: {
    marginHorizontal: 16,
    marginVertical: 12,
    minHeight: 90,
    fontSize: 13,
    color: '#3C4048',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 10,
    lineHeight: 20,
  },

  // Reset button
  resetButton: {
    marginTop: 24,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FDECEC',
  },
  resetButtonText: {
    fontSize: 14,
    color: '#FF6B6B',
    fontWeight: '500',
  },

  toolsIntroCard: {
    backgroundColor: '#ECFDF5',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    padding: 16,
    gap: 8,
  },
  toolsIntroTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#065F46',
  },
  toolsIntroText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#047857',
  },
  toolCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
    marginBottom: 8,
  },
  toolHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  toolTitleWrap: {
    flex: 1,
  },
  toolTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2329',
  },
  toolName: {
    marginTop: 2,
    fontSize: 11,
    color: '#9CA3AF',
  },
  toolStatus: {
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  toolStatusEnabled: {
    color: '#047857',
    backgroundColor: '#D1FAE5',
  },
  toolStatusDisabled: {
    color: '#6B7280',
    backgroundColor: '#F3F4F6',
  },
  toolDivider: {
    height: 1,
    backgroundColor: '#F1F3F5',
    marginHorizontal: 16,
  },
  toolExemptText: {
    paddingHorizontal: 16,
    paddingBottom: 13,
    color: '#6B7280',
    fontSize: 12,
    lineHeight: 18,
  },
  toolConfigurationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  toolConfigurationLabel: {
    fontSize: 13,
    color: '#3C4048',
  },
  toolExpandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F3F5',
  },
  toolExpandText: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '500',
  },
  toolExpandIcon: {
    color: '#9CA3AF',
    fontSize: 16,
  },
  toolUiEffectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  toolUiEffectOptions: {
    flexDirection: 'row',
    padding: 2,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  toolUiEffectOption: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  toolUiEffectOptionActive: {
    backgroundColor: '#FFFFFF',
  },
  toolUiEffectOptionText: {
    color: '#6B7280',
    fontSize: 12,
  },
  toolUiEffectOptionTextActive: {
    color: '#047857',
    fontWeight: '600',
  },
  toolUiEffectHint: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    color: '#6B7280',
    fontSize: 11,
    lineHeight: 16,
  },
  toolRequiredText: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    fontSize: 11,
    lineHeight: 16,
    color: '#B45309',
  },
  toolMetadataWrap: {
    paddingHorizontal: 16,
    paddingBottom: 13,
    gap: 6,
  },
  toolMetadataLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  toolMetadataInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#1F2329',
    backgroundColor: '#F9FAFB',
  },
  toolDescriptionInput: {
    minHeight: 88,
    lineHeight: 18,
  },
  toolMetadataHint: {
    fontSize: 11,
    lineHeight: 16,
    color: '#9CA3AF',
  },
  toolResetOneButton: {
    alignSelf: 'flex-end',
    marginRight: 16,
    marginBottom: 12,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  toolResetAllButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  toolResetText: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '600',
  },

  // Saved command row
  savedCmdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  commandGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  commandGroupTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3C4048',
  },
  commandGroupCount: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  commandFileActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 13,
  },
  commandFileButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  commandFileButtonDisabled: {
    opacity: 0.45,
  },
  commandFileButtonText: {
    fontSize: 13,
    color: '#047857',
    fontWeight: '600',
  },
  commandEmptyText: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 13,
    color: '#9CA3AF',
  },
  savedCmdText: {
    flex: 1,
    fontSize: 14,
    color: '#9CA3AF',
  },
  savedCmdRemove: {
    fontSize: 14,
    color: '#6B7280',
  },
});
