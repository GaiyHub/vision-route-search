import React, { useEffect, useRef, useState } from 'react';
import {
  AppState as NativeAppState,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { OnboardingNavigator } from './app/onboarding/OnboardingNavigator';
import { ChatScreen } from './app/chat/ChatScreen';
import { HistoryScreen } from './app/history/HistoryScreen';
import { SettingsScreen } from './app/settings/SettingsScreen';
import { isOnboardingComplete, completeOnboarding } from './src/store/onboardingStore';
import { loadSettings, subscribeSettings } from './src/store/settingsStore';
import { loadSkills } from './src/store/skillStore';
import { setHistoryLimit } from './src/store/historyStore';
import { AgentOverlay } from './src/components/AgentOverlay';
import { requestBatteryExemption } from './src/agent/agentBridge';
import { getAgentState, subscribeAgentState } from './src/store/agentStore';
import { unregisterLLM } from './src/agent/llmBridge';
import { initModel } from './src/agent/modelManager';
import { restoreWatchdogs } from './src/agent/watchdogBridge';
import { BrowserHost } from './src/browser';
import { refreshModelCatalogOnce } from './src/modelCatalog/modelCatalog';

type AppState = 'loading' | 'onboarding' | 'main';
type MainTab = 'chat' | 'history' | 'settings';

/**
 * Mirror the keepScreenshots setting into the native capture module so the
 * Kotlin side knows whether to persist shots beyond the working cache dir.
 * Android-only; no-op when the module is unavailable.
 */
function syncShotRetention(enabled: boolean): void {
  try {
    const ctrl = require('react-native-accessibility-controller') as {
      setShotRetention?: (enabled: boolean) => void;
    };
    ctrl.setShotRetention?.(enabled);
  } catch {
    // Ignore — the setting simply has no effect without the native module.
  }
}

/**
 * Root component.
 *
 * On launch:
 *   1. Loads persisted settings into the in-memory cache.
 *   2. Checks whether onboarding has been completed.
 *   3. Shows OnboardingNavigator if not, otherwise the main tabbed UI.
 */
export default function App() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [tab, setTab] = useState<MainTab>('chat');
  const [firstCommand, setFirstCommand] = useState<string | undefined>(undefined);
  const currentModelRef = useRef<'E2B' | 'E4B' | null>(null);
  const currentProviderModeRef = useRef<'cloud' | 'local' | null>(null);

  useEffect(() => {
    Promise.all([loadSettings(), isOnboardingComplete(), loadSkills()]).then(([settings, done]) => {
      setAppState(done ? 'main' : 'onboarding');
      currentModelRef.current = settings.model;
      currentProviderModeRef.current = settings.providerMode;
      setHistoryLimit(settings.maxStoredSessions);
      syncShotRetention(settings.keepScreenshots);
      if (settings.providerMode === 'local') {
        initOnDeviceLLM(settings.model).catch(() => {});
      } else {
        unregisterLLM();
      }
      restoreWatchdogs();
      // Keep cached suggestions immediately usable, then refresh the public
      // catalog and the configured provider exactly once for this app launch.
      void refreshModelCatalogOnce(settings).catch(() => {});
    });
    // MIUI freezes background apps unless battery optimization is disabled —
    // ask once at startup so long agent runs survive going to background.
    requestBatteryExemption();
  }, []);

  // Reinitialize the on-device LLM when the user changes the model in Settings.
  useEffect(() => {
    return subscribeSettings((settings) => {
      const modelChanged = settings.model !== currentModelRef.current;
      const providerModeChanged = settings.providerMode !== currentProviderModeRef.current;
      currentModelRef.current = settings.model;
      currentProviderModeRef.current = settings.providerMode;
      if (settings.providerMode === 'cloud') {
        unregisterLLM();
      } else if (modelChanged || providerModeChanged) {
        initOnDeviceLLM(settings.model).catch(() => {});
      }
      // Keep the persisted session history capped at the configured size.
      setHistoryLimit(settings.maxStoredSessions);
      // Keep the native screenshot retention in sync with the setting.
      syncShotRetention(settings.keepScreenshots);
    });
  }, []);

  // Interactive completion cards live on the chat tab. If a task finishes
  // while DouPao is already visible (or the user returns while it is waiting),
  // take them directly to that card instead of requiring the floating overlay.
  useEffect(() => {
    const focusPendingCompletion = () => {
      if (
        NativeAppState.currentState === 'active'
        && getAgentState().completionPending
      ) {
        setTab('chat');
      }
    };
    const unsubscribe = subscribeAgentState((state) => {
      if (state.completionPending) focusPendingCompletion();
    });
    const appStateSubscription = NativeAppState.addEventListener('change', (state) => {
      if (state === 'active') focusPendingCompletion();
    });
    return () => {
      unsubscribe();
      appStateSubscription.remove();
    };
  }, []);

  const handleOnboardingComplete = async (cmd?: string) => {
    await completeOnboarding();
    if (cmd) setFirstCommand(cmd);
    setAppState('main');
  };

  if (appState === 'loading') {
    return (
      <SafeAreaProvider>
        <View style={styles.loadingContainer}>
          <StatusBar style="dark" />
        </View>
      </SafeAreaProvider>
    );
  }

  if (appState === 'onboarding') {
    return (
      <SafeAreaProvider>
        <OnboardingNavigator onComplete={handleOnboardingComplete} />
        <StatusBar style="dark" />
      </SafeAreaProvider>
    );
  }

  // Main app — navigation lives in a compact top-left drawer.
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.screen}>
          {tab === 'chat'     && <ChatScreen initialCommand={firstCommand} />}
          {tab === 'history'  && <HistoryScreen />}
          {tab === 'settings' && <SettingsScreen />}
        </View>
        <NavigationDrawer tab={tab} onTab={setTab} />
        <AgentOverlay />
        {/* Browser tools own their UI/session below; the app only mounts the host. */}
        <BrowserHost />
        {/* 端侧 ExecuTorch 语音（Whisper/Kokoro）在云端优先模式下暂不挂载：
            其 hooks 在当前构建中会触发运行时崩溃，且非必需。
            语音输入/播报回退到系统 expo-speech-recognition / expo-speech。 */}
        <VoiceModuleDisabled />
        <StatusBar style="dark" />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

// ---------------------------------------------------------------------------
// On-device LLM initialization
// ---------------------------------------------------------------------------

async function initOnDeviceLLM(model: 'E2B' | 'E4B'): Promise<void> {
  try {
    // On-device LLM is optional (cloud is the default M1 path). Probe the
    // executorch module first so a missing/incompatible native module never
    // crashes the app at launch.
    require('react-native-executorch');
    await initModel(model);
  } catch {
    // Optional feature — swallow failures.
  }
}

/** Placeholder — on-device ExecuTorch voice is currently disabled. */
function VoiceModuleDisabled(): null {
  return null;
}

// ---------------------------------------------------------------------------
// Collapsible navigation drawer
// ---------------------------------------------------------------------------

interface NavigationDrawerProps {
  tab: MainTab;
  onTab: (t: MainTab) => void;
}

const TABS: { key: MainTab; label: string }[] = [
  { key: 'chat',     label: '聊天' },
  { key: 'history',  label: '历史' },
  { key: 'settings', label: '设置' },
];

function NavigationDrawer({ tab, onTab }: NavigationDrawerProps) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const selectTab = (next: MainTab) => {
    setOpen(false);
    onTab(next);
  };

  return (
    <View pointerEvents="box-none" style={styles.drawerLayer}>
      {open ? (
        <TouchableOpacity
          style={styles.drawerBackdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
          accessibilityLabel="关闭导航抽屉"
        />
      ) : null}
      <TouchableOpacity
        style={[styles.drawerButton, { top: insets.top + 7 }]}
        onPress={() => setOpen((current) => !current)}
        activeOpacity={0.72}
        accessibilityRole="button"
        accessibilityLabel={open ? '关闭导航抽屉' : '打开导航抽屉'}
        accessibilityState={{ expanded: open }}
      >
        <Ionicons name="menu-outline" size={26} color="#374151" />
      </TouchableOpacity>
      {open ? (
        <View style={[styles.drawerMenu, { top: insets.top + 54 }]}>
          {TABS.map(({ key, label }) => {
            const active = tab === key;
            const color = active ? '#059669' : '#6B7280';
            return (
              <TouchableOpacity
                key={key}
                style={[styles.drawerItem, active && styles.drawerItemActive]}
                onPress={() => selectTab(key)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <View style={styles.drawerItemIcon}>
                  <TabIcon tab={key} color={color} />
                </View>
                <Text style={[styles.drawerItemLabel, active && styles.drawerItemLabelActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// iOS-style monochrome line icons drawn with plain Views (no icon library).
function TabIcon({ tab, color }: { tab: MainTab; color: string }) {
  if (tab === 'chat') return <ChatBubbleIcon color={color} />;
  if (tab === 'history') return <ClockIcon color={color} />;
  return <SlidersIcon color={color} />;
}

function ChatBubbleIcon({ color }: { color: string }) {
  return (
    <View style={styles.chatIconWrap}>
      <View style={[styles.chatIconBody, { borderColor: color }]}>
        <View style={[styles.chatIconTail, { borderBottomColor: color }]} />
      </View>
    </View>
  );
}

function ClockIcon({ color }: { color: string }) {
  return (
    <View style={[styles.clockIcon, { borderColor: color }]}>
      <View style={[styles.clockHandV, { backgroundColor: color }]} />
      <View style={[styles.clockHandH, { backgroundColor: color }]} />
    </View>
  );
}

function SlidersIcon({ color }: { color: string }) {
  return (
    <View style={styles.slidersIcon}>
      <View style={styles.sliderRow}>
        <View style={[styles.sliderLine, { backgroundColor: color }]} />
        <View style={[styles.sliderKnob, { backgroundColor: color }]} />
      </View>
      <View style={[styles.sliderRow, styles.sliderRowMiddle]}>
        <View style={[styles.sliderLine, styles.sliderLineShort, { backgroundColor: color }]} />
        <View style={[styles.sliderKnob, styles.sliderKnobLeft, { backgroundColor: color }]} />
      </View>
      <View style={styles.sliderRow}>
        <View style={[styles.sliderLine, styles.sliderLineShort, { backgroundColor: color }]} />
        <View style={[styles.sliderKnob, styles.sliderKnobRight, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#F6F7F9',
  },
  root: {
    flex: 1,
    backgroundColor: '#F6F7F9',
  },
  screen: {
    flex: 1,
  },

  drawerLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    elevation: 100,
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,24,39,0.08)',
  },
  drawerButton: {
    position: 'absolute',
    left: 12,
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  drawerMenu: {
    position: 'absolute',
    left: 12,
    width: 188,
    padding: 8,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 14,
    gap: 4,
  },
  drawerItem: {
    minHeight: 46,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 12,
  },
  drawerItemActive: {
    backgroundColor: '#E7F8EF',
  },
  drawerItemIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerItemLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#4B5563',
  },
  drawerItemLabelActive: {
    color: '#059669',
    fontWeight: '700',
  },

  // Drawn icons
  chatIconWrap: {
    width: 22,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatIconBody: {
    width: 19,
    height: 14,
    borderWidth: 1.8,
    borderRadius: 4,
  },
  chatIconTail: {
    position: 'absolute',
    left: 2,
    bottom: -4,
    width: 0,
    height: 0,
    borderLeftWidth: 3,
    borderRightWidth: 3,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopWidth: 0,
    borderBottomWidth: 4,
  },
  clockIcon: {
    width: 19,
    height: 19,
    borderRadius: 9.5,
    borderWidth: 1.8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockHandV: {
    position: 'absolute',
    width: 1.8,
    height: 5,
    borderRadius: 1,
    top: 4.5,
    left: 8.6,
  },
  clockHandH: {
    position: 'absolute',
    width: 4,
    height: 1.8,
    borderRadius: 1,
    top: 8.6,
    left: 8.6,
  },
  slidersIcon: {
    width: 22,
    height: 18,
    justifyContent: 'space-between',
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sliderRowMiddle: {
    justifyContent: 'flex-end',
  },
  sliderLine: {
    width: 20,
    height: 1.6,
    borderRadius: 1,
  },
  sliderLineShort: {
    width: 14,
  },
  sliderKnob: {
    position: 'absolute',
    left: 12,
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  sliderKnobLeft: {
    left: 0,
  },
  sliderKnobRight: {
    left: 9,
  },
});
