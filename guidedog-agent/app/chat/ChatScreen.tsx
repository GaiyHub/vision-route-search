/**
 * ChatScreen — the main Deft agent interface.
 *
 * Users type or speak commands here. The screen shows:
 *   - A scrollable list of chat messages (user commands, agent actions, screen updates)
 *   - A text input bar with a send button
 *   - A shared text composer for new tasks and in-progress supplements
 *
 * Agent actions and screen-state changes arrive as messages with kind='action'
 * or kind='screen', displayed with distinct visual treatments to distinguish
 * them from plain conversation.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  TouchableOpacity,
  View,
  Animated,
  ScrollView,
  AppState,
  AppStateStatus,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMarkdown, type MarkedStyles } from 'react-native-marked';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import type {
  PanGestureHandlerGestureEvent,
  PanGestureHandlerStateChangeEvent,
} from 'react-native-gesture-handler';
import {
  subscribeConfirm,
  resolveUserConfirm,
  type PendingConfirm,
} from '../../src/store/confirmStore';
import {
  CLARIFICATION_MAX_LENGTH,
  submitUserClarification,
  subscribeClarification,
  type PendingClarification,
} from '../../src/store/clarificationStore';
import {
  type ChatMessage,
  addMessage,
  clearMessages,
  subscribe,
} from '../../src/store/chatStore';
import {
  recordCommand,
  subscribeRecentCommands,
} from '../../src/store/recentCommandsStore';
import {
  getFavorites,
  isFavorite,
  loadFavorites,
  removeFavorite,
  subscribeFavorites,
  toggleFavorite,
} from '../../src/store/favoritesStore';
import {
  handleUserTextInput,
  stopAgent,
  loadResumableTask,
  clearResumableTask,
  COMPLETION_SUPPLEMENT_MAX_LENGTH,
  beginCompletionSupplement,
  rejectCompletion,
  resolveCompletionDecision,
  submitCompletionSupplement,
  type ResumableTask,
} from '../../src/agent/agentBridge';
import { getAgentState, subscribeAgentState, type AgentState } from '../../src/store/agentStore';
import { DEFAULT_AGENT_STEPS } from '../../src/device-agent/agent/AgentLimits';
import {
  getExecutionState,
  subscribeExecution,
  type ExecutionStep,
} from '../../src/store/executionStore';
import { runPreflight, type PreflightItem } from '../../src/util/taskPreflight';
import { getSettings, saveSettings, subscribeSettings } from '../../src/store/settingsStore';
import { ScreenPreview } from '../../src/components/ScreenPreview';
import { speakText, stopSpeech } from '../../src/voice/voiceBridge';
import { shouldInterruptSpeechOnHostEntry } from '../../src/voice/hostEntrySpeechPolicy';
import {
  MAX_ACTIVE_WATCHDOGS,
  parseWatchCommand,
  pauseWatchdogById,
  resumeWatchdogById,
  startWatchdog,
  stopWatchdog,
} from '../../src/agent/watchdogBridge';
import { getWatchdogs as _getWatchdogs, type WatchdogConfig } from '../../src/store/watchdogStore';
import {
  getTaskTokens,
  getPromptCacheHitRate,
  subscribeTokenStats,
  type TokenUsage,
} from '../../src/store/tokenStats';
import {
  RECOMMENDED_COMMANDS,
  getCommandSuggestions,
  getFavoriteCommands,
} from '../../src/store/recommendedCommands';
import { MessageSubmitGuard } from '../../src/util/MessageSubmitGuard';
import { formatMessageTimestamp } from '../../src/util/messageTimestamp';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Watchdog listing helpers
// ---------------------------------------------------------------------------

function formatWatchdogRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const secs = Math.floor(diff / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (secs < 60) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  return `${days} 天前`;
}

function describeWatchdog(w: WatchdogConfig): string {
  const lastRun = w.lastRunAt ? formatWatchdogRelativeTime(w.lastRunAt) : '从未运行';
  const pausedTag = w.status === 'paused' ? ' [已暂停]' : '';
  return `• ${w.id}${pausedTag}: ${w.task}（上次检查：${lastRun}，${w.triggerCount}/${w.maxTicks} 次）`;
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

interface ChatScreenProps {
  initialCommand?: string;
}

export function ChatScreen({ initialCommand }: ChatScreenProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [recommendedCommandsEnabled, setRecommendedCommandsEnabled] = useState(
    getSettings().recommendedCommandsEnabled,
  );
  const [dismissedRecommendedCommands, setDismissedRecommendedCommands] = useState(
    getSettings().dismissedRecommendedCommands,
  );
  const [agentState, setAgentState] = useState<AgentState>({
    isRunning: false,
    currentTask: null,
    currentStep: 0,
    maxSteps: DEFAULT_AGENT_STEPS,
    currentScreenState: null,
    actionCount: 0,
    completionPending: null,
  });
  const [resumableTask, setResumableTask] = useState<ResumableTask | null>(null);
  const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([]);
  const [executionRunning, setExecutionRunning] = useState(false);
  const [executionThinking, setExecutionThinking] = useState('');
  const [executionStatus, setExecutionStatus] = useState('');
  const [taskTokens, setTaskTokens] = useState<TokenUsage>(getTaskTokens());
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [pendingClarification, setPendingClarification] = useState<PendingClarification | null>(null);
  const [preflight, setPreflight] = useState<PreflightItem[] | null>(null);
  const [preflightVisible, setPreflightVisible] = useState(false);
  const [preflightFixingId, setPreflightFixingId] = useState<PreflightItem['id'] | null>(null);
  const preflightFixingRef = useRef(false);
  const messageSubmitGuardRef = useRef(new MessageSubmitGuard());
  const isRunningRef = useRef(false);
  const [favorites, setFavorites] = useState<string[]>(getFavorites());
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const agentStartTimeRef = useRef<number | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const inputRef = useRef<TextInput>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const ttsEnabledRef = useRef(getSettings().ttsEnabled || getSettings().voiceMode);
  // Maps message id → pending state from the previous update, used to detect transitions.
  const prevPendingRef = useRef<Map<string, boolean>>(new Map());

  // Pre-fill input with first command selected during onboarding.
  useEffect(() => {
    if (initialCommand) setInputText(initialCommand);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every phase reuses one continuous composer and one draft. Gates may change
  // where submitted text is routed, but never change or clear the composer UI.
  useEffect(() => {
    setInputError(null);
    if (pendingClarification || agentState.completionPending) {
      const id = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(id);
    }
  }, [pendingClarification?.id, agentState.completionPending?.result]);

  // A leftover preflight modal must never overlay a running task: it blocks
  // the screen the agent is supposed to observe and operate on (the agent
  // then wastes steps trying to dismiss DouPao's own dialog instead of the
  // user's task). Dismiss it the moment a task starts running.
  useEffect(() => {
    if (agentState.isRunning) setPreflightVisible(false);
  }, [agentState.isRunning]);

  // Check for an interrupted task on mount.
  useEffect(() => {
    loadResumableTask().then((t) => {
      if (t) setResumableTask(t);
    });
  }, []);

  // Track the latest speech-output settings without re-subscribing to messages.
  useEffect(() => {
    return subscribeSettings((s) => {
      ttsEnabledRef.current = s.ttsEnabled || s.voiceMode;
      setRecommendedCommandsEnabled(s.recommendedCommandsEnabled);
      setDismissedRecommendedCommands(s.dismissedRecommendedCommands);
    });
  }, []);

  // Entering DouPao from another app is an explicit request to take over the
  // conversation, so stop any response still being spoken. The ask_user flow
  // marks its own automated foreground transition and consumes the one-shot
  // exemption here, otherwise it would immediately cut off its new question.
  useEffect(() => {
    let previousState: AppStateStatus = AppState.currentState;
    if (
      previousState === 'active'
      && shouldInterruptSpeechOnHostEntry()
    ) {
      stopSpeech();
    }
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      const enteredForeground = state === 'active' && previousState !== 'active';
      previousState = state;
      if (enteredForeground && shouldInterruptSpeechOnHostEntry()) {
        stopSpeech();
      }
    });
    return () => subscription.remove();
  }, []);

  // Load favorites from the local file once, migrating any legacy saved
  // commands the first time (then clearing the old setting).
  useEffect(() => {
    void loadFavorites({
      legacyCommands: getSettings().savedCommands,
      onLegacyMigrated: (cmds) => {
        if (cmds.length > 0) {
          void saveSettings({ savedCommands: [] });
        }
      },
    });
  }, []);

  // Keep the favorites list in sync with the store.
  useEffect(() => subscribeFavorites(setFavorites), []);

  // Track recently sent commands for the quick-fill chips above the input bar.
  useEffect(() => {
    return subscribeRecentCommands(setRecentCommands);
  }, []);

  // Subscribe to the shared message store; trigger TTS when an agent text message resolves.
  useEffect(() => {
    const unsub = subscribe((msgs) => {
      setMessages(msgs);

      if (ttsEnabledRef.current) {
        for (const msg of msgs) {
          if (msg.role === 'agent' && msg.kind === 'text' && !msg.pending) {
            const prevPending = prevPendingRef.current.get(msg.id);
            // Speak when: newly added as resolved, or just transitioned from pending→resolved.
            if (prevPending === undefined || prevPending === true) {
              void speakText(msg.text);
            }
          }
        }
      }

      const next = new Map<string, boolean>();
      for (const msg of msgs) next.set(msg.id, !!msg.pending);
      prevPendingRef.current = next;
    });
    return unsub;
  }, []);

  // Subscribe to agent running state
  useEffect(() => {
    const unsub = subscribeAgentState((state) => {
      setAgentState(state);
      isRunningRef.current = state.isRunning;
      if (state.isRunning && agentStartTimeRef.current === null) {
        agentStartTimeRef.current = Date.now();
        setElapsedSecs(0);
      } else if (!state.isRunning) {
        agentStartTimeRef.current = null;
      }
    });
    return unsub;
  }, []);

  // High-risk action confirmation gate (confirm_action tool).
  useEffect(() => {
    return subscribeConfirm(setPendingConfirm);
  }, []);

  // Model-requested clarification gate (ask_user tool).
  useEffect(() => {
    return subscribeClarification(setPendingClarification);
  }, []);

  // Subscribe to the collapsible execution-process panel data.
  useEffect(() => {
    return subscribeExecution(() => {
      const state = getExecutionState();
      setExecutionSteps(state.steps);
      setExecutionRunning(state.running);
      setExecutionThinking(state.thinking);
      setExecutionStatus(state.status);
    });
  }, []);

  // Per-task token accounting (accumulated while a task runs, kept after it
  // ends, reset when the next task starts).
  useEffect(() => {
    return subscribeTokenStats(() => {
      setTaskTokens(getTaskTokens());
    });
  }, []);

  // Tick elapsed time every second while the agent is running.
  useEffect(() => {
    if (!agentState.isRunning) return;
    const id = setInterval(() => {
      const start = agentStartTimeRef.current;
      if (start !== null) setElapsedSecs(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [agentState.isRunning]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  }, [messages]);

  // User decisions are rendered inside the conversation. Keep a newly
  // presented card visible, including after its text field opens the keyboard.
  useEffect(() => {
    if (
      preflightVisible
      || pendingConfirm
      || pendingClarification
      || agentState.completionPending
    ) {
      const id = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
      return () => clearTimeout(id);
    }
  }, [
    preflightVisible,
    pendingConfirm?.id,
    pendingClarification?.id,
    agentState.completionPending?.result,
    agentState.completionPending?.phase,
  ]);

  const sendText = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Task-start gate: every required permission must be granted before a new
    // task may start. Corrections while running are not blocked.
    if (!isRunningRef.current) {
      const items = await runPreflight();
      if (items.some((i) => !i.granted)) {
        setPreflight(items);
        setPreflightVisible(true);
        return;
      }
    }

    setInputText('');
    stopSpeech();
    recordCommand(trimmed);
    addMessage('user', 'text', trimmed);

    // /watch command: set up a recurring background check.
    if (trimmed.toLowerCase().startsWith('/watch')) {
      const parsed = parseWatchCommand(trimmed);
      if (parsed) {
        const config = startWatchdog(parsed.task, parsed.intervalMs);
        if (!config) {
          addMessage('agent', 'text', `定时任务已达上限（${MAX_ACTIVE_WATCHDOGS} 个），请先 /stopwatch <id> 取消一个。`);
          return;
        }
        const intervalText = parsed.intervalMs >= 3_600_000
          ? `${Math.round(parsed.intervalMs / 3_600_000)}h`
          : parsed.intervalMs >= 60_000
            ? `${Math.round(parsed.intervalMs / 60_000)}m`
            : `${Math.round(parsed.intervalMs / 1_000)}s`;
        addMessage('agent', 'text', `定时任务已启动（每 ${intervalText}）："${config.task}"\n满足条件时我会通知你。ID: ${config.id}`);
      } else {
        addMessage('agent', 'text', '用法：/watch every <间隔> <m|h|s>: <条件>\n示例：/watch every 5m: 外卖是否在 5 分钟内到达');
      }
      return;
    }

    // /stopwatch command: cancel a watchdog by ID, or list active/paused ones.
    if (trimmed.toLowerCase().startsWith('/stopwatch')) {
      const id = trimmed.split(/\s+/)[1];
      if (id) {
        stopWatchdog(id);
        addMessage('agent', 'text', `定时任务 ${id} 已取消。`);
      } else {
        const watchdogs = _getWatchdogs().filter(
          (w: WatchdogConfig) => w.status === 'active' || w.status === 'paused',
        );
        if (watchdogs.length === 0) {
          addMessage('agent', 'text', '没有进行中的定时任务。');
        } else {
          addMessage('agent', 'text', '进行中的定时任务：\n' + watchdogs.map(describeWatchdog).join('\n'));
        }
      }
      return;
    }

    // /pausewatch command: pause an active watchdog by ID (keeps its config; stops ticking).
    if (trimmed.toLowerCase().startsWith('/pausewatch')) {
      const id = trimmed.split(/\s+/)[1];
      const target = id ? _getWatchdogs().find((w: WatchdogConfig) => w.id === id) : undefined;
      if (!id) {
        addMessage('agent', 'text', '用法：/pausewatch <id>，可用 /stopwatch 查看 ID。');
      } else if (!target || target.status !== 'active') {
        addMessage('agent', 'text', `没有 ID 为 ${id} 的定时任务。`);
      } else {
        pauseWatchdogById(id);
        addMessage('agent', 'text', `定时任务 ${id} 已暂停，可用 /resumewatch ${id} 恢复。`);
      }
      return;
    }

    // /resumewatch command: resume a paused watchdog by ID.
    if (trimmed.toLowerCase().startsWith('/resumewatch')) {
      const id = trimmed.split(/\s+/)[1];
      const target = id ? _getWatchdogs().find((w: WatchdogConfig) => w.id === id) : undefined;
      if (!id) {
        addMessage('agent', 'text', '用法：/resumewatch <id>，可用 /stopwatch 查看 ID。');
      } else if (!target || target.status !== 'paused') {
        addMessage('agent', 'text', `没有暂停中的 ID 为 ${id} 的定时任务。`);
      } else {
        resumeWatchdogById(id);
        addMessage('agent', 'text', `定时任务 ${id} 已恢复。`);
      }
      return;
    }

    handleUserTextInput(trimmed);
  }, []);

  const submitInputText = useCallback(async (text: string) => {
    const submitGuard = messageSubmitGuardRef.current;
    if (!submitGuard.tryAcquire(text)) return;
    try {
      if (pendingClarification) {
        const result = submitUserClarification(text);
        if (result.ok) {
          setInputText('');
          setInputError(null);
          stopSpeech();
          addMessage('user', 'text', text.trim());
        } else if (result.error === 'too_long') {
          setInputError(`补充信息不能超过 ${CLARIFICATION_MAX_LENGTH} 个字符`);
        } else if (result.error === 'empty') {
          setInputError('请输入补充信息');
        } else {
          setInputError('该补充请求已失效，请重试');
        }
        return;
      }

      // Read the synchronous store at send time. The Activity may have just
      // returned from an external app, while this callback still closes over
      // the previous React render's completion phase.
      const completionPending = getAgentState().completionPending;
      if (completionPending) {
        if (completionPending.phase === 'decision') {
          beginCompletionSupplement({ foregroundHost: false });
        }
        const result = submitCompletionSupplement(text);
        if (result.ok) {
          setInputText('');
          setInputError(null);
          stopSpeech();
          addMessage('user', 'text', text.trim());
        } else if (result.error === 'too_long') {
          setInputError(`补充信息不能超过 ${COMPLETION_SUPPLEMENT_MAX_LENGTH} 个字符`);
        } else if (result.error === 'empty') {
          setInputError('请输入补充信息');
        } else {
          setInputError('该补充请求已失效，请重试');
        }
        return;
      }

      if (isRunningRef.current) {
        const trimmed = text.trim();
        if (!trimmed) return;
        setInputText('');
        setInputError(null);
        stopSpeech();
        addMessage('user', 'text', trimmed);
        handleUserTextInput(trimmed);
        return;
      }

      await sendText(text);
    } finally {
      submitGuard.release();
    }
  }, [pendingClarification, sendText]);

  const refreshPreflight = useCallback(async (freshScreenCapture = false) => {
    // Returning from Android's permission activity emits an AppState `active`
    // event before the in-flight authorization has necessarily settled.
    if (preflightFixingRef.current) return;
    const items = await runPreflight({
      screenCaptureCheck: freshScreenCapture ? 'freshHandle' : 'active',
    });
    setPreflight(items);
    if (items.every((i) => i.granted)) {
      setPreflightVisible(false);
    }
  }, []);

  const handlePreflightRecheck = useCallback(async () => {
    await refreshPreflight(false);
  }, [refreshPreflight]);

  // After tapping any item's authorize/settings button, re-run the checks
  // automatically. Settings-page items are covered by the foreground
  // re-check in PreflightCard; the immediate re-check covers in-app dialogs
  // (e.g. screen-capture consent).
  const handlePreflightFix = useCallback(
    async (item: PreflightItem) => {
      if (preflightFixingRef.current) return;
      preflightFixingRef.current = true;
      setPreflightFixingId(item.id);
      try {
        await item.fix();
      } catch (error) {
        if (Platform.OS === 'android') {
          const message = error instanceof Error ? error.message : '授权失败，请重试';
          ToastAndroid.show(message, ToastAndroid.SHORT);
        }
      } finally {
        preflightFixingRef.current = false;
        setPreflightFixingId(null);
      }
      // Fresh MediaProjection consent has already been handed to the native
      // foreground service. Verify its handle here; an immediate active frame
      // probe would race native first-frame priming and report a false failure.
      await refreshPreflight(item.id === 'screenCapture');
    },
    [refreshPreflight],
  );

  const handleSend = useCallback(() => {
    void submitInputText(inputText);
  }, [inputText, submitInputText]);

  const handleSuggestion = useCallback((text: string) => {
    // Fill the input box only — the user reviews and submits manually.
    setInputText(text);
  }, []);

  const handleResumeTask = useCallback(async () => {
    const t = resumableTask;
    setResumableTask(null);
    await clearResumableTask();
    if (!t) return;
    // Re-inject prior steps as read-only history messages.
    if (t.steps.length > 0) {
      addMessage('agent', 'screen', `继续执行："${t.task.slice(0, 60)}${t.task.length > 60 ? '…' : ''}"`);
      for (const step of t.steps) {
        addMessage('agent', 'action', step);
      }
    }
    await sendText(t.task);
  }, [resumableTask, sendText]);

  const handleDismissResume = useCallback(async () => {
    setResumableTask(null);
    await clearResumableTask();
  }, []);

  // Archive the finished task: the session is already persisted to history,
  // so this clears the current conversation (and any resumable state) and
  // returns to the fresh new-task page.
  const handleArchiveTask = useCallback(async () => {
    const hadMessages = messages.length > 0;
    setResumableTask(null);
    await clearResumableTask();
    clearMessages();
    if (Platform.OS === 'android') {
      ToastAndroid.show(
        hadMessages ? '已归档，可以开始新任务' : '当前已经是新会话',
        ToastAndroid.SHORT,
      );
    }
  }, [messages.length]);

  const handleToggleFavorite = useCallback((text: string) => {
    const { nowFavorite } = toggleFavorite(text);
    if (Platform.OS === 'android') {
      ToastAndroid.show(nowFavorite ? '已收藏指令' : '已取消收藏', ToastAndroid.SHORT);
    }
  }, []);

  const handleRemoveFavorite = useCallback((text: string) => {
    if (removeFavorite(text) && Platform.OS === 'android') {
      ToastAndroid.show('已取消收藏', ToastAndroid.SHORT);
    }
  }, []);

  const handleDismissRecommendedCommand = useCallback((text: string) => {
    const current = getSettings().dismissedRecommendedCommands;
    if (!current.includes(text)) {
      void saveSettings({ dismissedRecommendedCommands: [...current, text] });
    }
    removeFavorite(text);
    if (Platform.OS === 'android') {
      ToastAndroid.show('已取消推荐', ToastAndroid.SHORT);
    }
  }, []);

  const hasInlineAction = preflightVisible
    || !!pendingConfirm
    || !!pendingClarification
    || !!agentState.completionPending;

  return (
    // Navigation no longer occupies the bottom edge, so retain the bottom
    // safe area for the composer on gesture-navigation devices.
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <Header
        onToggleFavorites={() => setFavoritesOpen((open) => !open)}
        favoritesOpen={favoritesOpen}
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
      />
      {favoritesOpen && (
        <FavoritesDropdown
          favorites={favorites}
          recommendedCommandsEnabled={recommendedCommandsEnabled}
          dismissedRecommendedCommands={dismissedRecommendedCommands}
          top={headerHeight + 4}
          onPick={(text) => {
            setInputText(text);
            setFavoritesOpen(false);
          }}
          onUnfavorite={handleRemoveFavorite}
          onDismissRecommended={handleDismissRecommendedCommand}
          onClose={() => setFavoritesOpen(false)}
        />
      )}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScreenPreview refreshIntervalMs={3000} />
        {!agentState.isRunning && resumableTask && (
          <ResumeBanner
            task={resumableTask.task}
            onResume={handleResumeTask}
            onDismiss={handleDismissResume}
          />
        )}
        {messages.length === 0 && !hasInlineAction ? (
          <>
            <EmptyState
              onSuggestion={handleSuggestion}
              recentCommands={recentCommands}
              onToggleFavorite={handleToggleFavorite}
            />
            <ArchiveTaskBar onArchive={handleArchiveTask} />
          </>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item, index }) => {
              const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user');
              const showPanel = index === lastUserIndex && (
                executionSteps.length > 0 || !!executionThinking.trim() || !!executionStatus.trim()
              );
              // Per-task token stats: shown under the latest user message
              // once the task has consumed anything, kept after it ends.
              const showStats = index === lastUserIndex && taskTokens.total > 0;
              const isUserCommand = item.role === 'user';
              const fav = isUserCommand ? isFavorite(item.text) : false;
              const bubble = (swipeActionOpen = false) => (
                <MessageBubble
                  message={item}
                  isFavorite={fav}
                  swipeActionOpen={swipeActionOpen}
                />
              );
              return (
                <>
                  {isUserCommand ? (
                    <SwipeableCommandRow
                      onAction={() => handleToggleFavorite(item.text)}
                      actionLabel={fav ? '取消收藏' : '收藏'}
                      actionActive={fav}
                    >
                      {(open) => bubble(open)}
                    </SwipeableCommandRow>
                  ) : (
                    bubble()
                  )}
                  {showStats && <TokenStatsRow tokens={taskTokens} />}
                  {showPanel && (
                    <ExecutionPanel
                      steps={executionSteps}
                      running={executionRunning}
                      thinking={executionThinking}
                      status={executionStatus}
                    />
                  )}
                </>
              );
            }}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={
              <>
                {preflightVisible ? (
                  <PreflightCard
                    items={preflight ?? []}
                    onRecheck={handlePreflightRecheck}
                    onFix={handlePreflightFix}
                    fixingId={preflightFixingId}
                    onClose={() => setPreflightVisible(false)}
                  />
                ) : null}
                <ConfirmCard pending={pendingConfirm} />
                <ClarificationCard pending={pendingClarification} />
                <CompletionDecisionCard
                  pending={agentState.completionPending}
                  task={agentState.currentTask}
                />
                <ArchiveTaskBar
                  onArchive={handleArchiveTask}
                />
              </>
            }
          />
        )}
        {agentState.isRunning && (
          <AgentStatusBar
            step={agentState.currentStep}
            maxSteps={agentState.maxSteps}
            actionCount={agentState.actionCount}
            elapsedSecs={elapsedSecs}
            onStop={stopAgent}
          />
        )}
        {agentState.isRunning && recentCommands.length > 0 && (
          <RecentCommandChips
            commands={recentCommands.slice(0, 5)}
            onPick={setInputText}
            onToggleFavorite={handleToggleFavorite}
            disabled={agentState.isRunning}
          />
        )}
        <InputBar
          inputRef={inputRef}
          value={inputText}
          onChangeText={(text) => {
            setInputText(text);
            setInputError(null);
          }}
          onSend={handleSend}
          error={inputError}
        />

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PreflightCard({
  items,
  onRecheck,
  onFix,
  fixingId,
  onClose,
}: {
  items: PreflightItem[];
  onRecheck: () => void;
  onFix: (item: PreflightItem) => void;
  fixingId: PreflightItem['id'] | null;
  onClose: () => void;
}) {
  const missing = items.filter((i) => !i.granted);
  // Auto re-check when the app returns to the foreground, so grants made in
  // the system settings page are picked up without a manual tap.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') onRecheck();
    });
    return () => sub.remove();
  }, [onRecheck]);

  return (
    <View style={[styles.inlineActionCard, styles.preflightCard]}>
          <Text style={styles.preflightTitle}>启动前检查</Text>
          <Text style={styles.preflightSubtitle}>
            以下项目未授权，任务暂不启动：
          </Text>
          <View style={styles.preflightList}>
            {missing.map((item) => (
              <View key={item.id} style={styles.preflightRow}>
                <View style={styles.preflightRowText}>
                  <Text style={styles.preflightLabel}>{item.label}</Text>
                  <Text style={styles.preflightDesc}>{item.description}</Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.preflightFixBtn,
                    fixingId !== null && styles.preflightButtonDisabled,
                  ]}
                  onPress={() => onFix(item)}
                  activeOpacity={0.7}
                  disabled={fixingId !== null}
                >
                  <Text style={styles.preflightFixText}>
                    {fixingId === item.id
                      ? '授权中…'
                      : item.id === 'screenCapture'
                        ? '去授权'
                        : '去设置'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={styles.preflightRecheck}
            onPress={onRecheck}
            activeOpacity={0.7}
            disabled={fixingId !== null}
          >
            <Text style={styles.preflightRecheckText}>重新检查</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.preflightCancel}>取消</Text>
          </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// High-risk action confirmation card
// ---------------------------------------------------------------------------

function ConfirmCard({ pending }: { pending: PendingConfirm | null }) {
  if (!pending) return null;
  const high = pending.risk === 'high';
  const riskColor = high ? '#EF4444' : '#10B981';
  const riskLabel = high ? '高风险' : '低风险';
  return (
    <View style={[styles.inlineActionCard, styles.confirmCard]}>
          <View style={styles.confirmHeader}>
            <Text style={styles.confirmTitle}>需要你的确认</Text>
            <View style={[styles.riskBadge, { borderColor: riskColor, backgroundColor: `${riskColor}1A` }]}>
              <Text style={[styles.riskBadgeText, { color: riskColor }]}>{riskLabel}</Text>
            </View>
          </View>
          <Text style={styles.confirmAction}>{pending.action}</Text>
          {pending.reason ? (
            <Text style={styles.confirmReason}>风险说明：{pending.reason}</Text>
          ) : null}
          <View style={[styles.confirmButtons, styles.riskConfirmButtons]}>
            <TouchableOpacity
              style={styles.confirmRejectBtn}
              onPress={() => resolveUserConfirm('reject')}
              activeOpacity={0.8}
            >
              <Text style={styles.confirmRejectText}>拒绝</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmExecuteBtn}
              onPress={() => resolveUserConfirm('execute')}
              activeOpacity={0.8}
            >
              <Text style={styles.confirmExecuteText}>执行</Text>
            </TouchableOpacity>
          </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Model-requested clarification card
// ---------------------------------------------------------------------------

function ClarificationCard({ pending }: { pending: PendingClarification | null }) {
  if (!pending) return null;

  return (
    <View style={[styles.inlineActionCard, styles.confirmCard]}>
          <View style={styles.confirmHeader}>
            <Text style={styles.confirmTitle}>需要你补充信息</Text>
          </View>
          <Text style={styles.confirmAction}>{pending.question}</Text>
          <Text style={styles.confirmHint}>请在下方对话输入框中补充，发送后任务将继续。</Text>
          <View style={styles.confirmButtons}>
            <TouchableOpacity
              style={styles.confirmRejectBtn}
              onPress={stopAgent}
              activeOpacity={0.8}
              accessibilityLabel="停止当前任务"
            >
              <Text style={styles.confirmRejectText}>停止任务</Text>
            </TouchableOpacity>
          </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Adaptive completion card. When the host is visible it owns both explicit
// decisions; the floating overlay is reserved for background operation.
// ---------------------------------------------------------------------------

function CompletionDecisionCard({
  pending,
  task,
}: {
  pending: AgentState['completionPending'];
  task: string | null;
}) {
  if (!pending) return null;

  return (
    <View style={[styles.inlineActionCard, styles.confirmCard]}>
          {task ? <Text style={styles.confirmAction}>{task}</Text> : null}
          <Text style={styles.confirmReason}>{pending.result}</Text>
          <View style={[styles.confirmButtons, styles.completionButtons]}>
            <TouchableOpacity
              style={[styles.completionSecondaryBtn, styles.completionCompactBtn]}
              onPress={() => rejectCompletion(pending.result)}
              activeOpacity={0.8}
              accessibilityLabel="任务尚未完成，继续执行"
            >
              <Text style={[styles.completionSecondaryText, styles.completionCompactText]}>未完成</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmExecuteBtn, styles.completionCompactBtn]}
              onPress={() => resolveCompletionDecision('complete')}
              activeOpacity={0.8}
              accessibilityLabel="确认任务完成"
            >
              <Text style={[styles.confirmExecuteText, styles.completionCompactText]}>完成</Text>
            </TouchableOpacity>
          </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({
  onToggleFavorites,
  favoritesOpen,
  onLayout,
}: {
  onToggleFavorites: () => void;
  favoritesOpen: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  return (
    <View style={styles.header} onLayout={onLayout}>
      <Text style={styles.headerTitle}>豆泡</Text>
      <TouchableOpacity
        onPress={onToggleFavorites}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.7}
        style={styles.favEntryBtn}
        accessibilityLabel={favoritesOpen ? '关闭收藏指令' : '打开收藏指令'}
      >
        <Ionicons
          name={favoritesOpen ? 'star' : 'star-outline'}
          size={22}
          color={favoritesOpen ? '#059669' : '#4B5563'}
        />
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Agent status bar (shown while agent is running)
// ---------------------------------------------------------------------------

function AgentStatusBar({
  step,
  maxSteps,
  actionCount,
  elapsedSecs,
  onStop,
}: {
  step: number;
  maxSteps: number;
  actionCount: number;
  elapsedSecs: number;
  onStop: () => void;
}) {
  const stepLabel = step === 0 ? '思考中…' : `步骤 ${step}/${maxSteps}`;
  const actionLabel = actionCount > 0 ? ` · 已执行 ${actionCount} 步` : '';
  const timeLabel = elapsedSecs > 0 ? ` · ${elapsedSecs} 秒` : '';
  return (
    <View style={styles.agentStatusBar}>
      <View style={styles.agentStatusDot} />
      <Text style={styles.agentStatusText}>{stepLabel}{actionLabel}{timeLabel}</Text>
      <TouchableOpacity onPress={onStop} style={styles.stopButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.stopButtonText}>停止</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Resume banner (shown when an interrupted task is found on boot)
// ---------------------------------------------------------------------------

function ResumeBanner({
  task,
  onResume,
  onDismiss,
}: {
  task: string;
  onResume: () => void;
  onDismiss: () => void;
}) {
  const label = task.length > 60 ? task.slice(0, 60) + '…' : task;
  return (
    <View style={styles.resumeBanner}>
      <Text style={styles.resumeText} numberOfLines={2}>
        检测到未完成任务，继续？{'\n'}
        <Text style={styles.resumeTaskLabel}>"{label}"</Text>
      </Text>
      <View style={styles.resumeButtons}>
        <TouchableOpacity style={styles.resumeBtn} onPress={onResume} activeOpacity={0.75}>
          <Text style={styles.resumeBtnText}>继续</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dismissBtn} onPress={onDismiss} activeOpacity={0.75}>
          <Text style={styles.dismissBtnText}>忽略</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// New-conversation affordance (always available on the chat page)
// ---------------------------------------------------------------------------

function ArchiveTaskBar({
  onArchive,
}: {
  onArchive: () => void;
}) {
  return (
    <View style={styles.archiveWrap}>
      <TouchableOpacity
        style={styles.archiveBtn}
        onPress={onArchive}
        activeOpacity={0.8}
      >
        <View style={styles.archiveGuideLine} />
        <Text style={styles.archiveBtnText}>开启新会话</Text>
        <View style={styles.archiveGuideLine} />
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  onSuggestion,
  recentCommands,
  onToggleFavorite,
}: {
  onSuggestion: (text: string) => void;
  recentCommands: string[];
  onToggleFavorite: (text: string) => void;
}) {
  const chips = getCommandSuggestions(recentCommands);
  return (
    <View style={styles.empty}>
      <ScrollView
        contentContainerStyle={styles.emptyContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.emptyHeadline}>需要我做什么？</Text>
        {chips.length > 0 && (
          <View style={styles.suggestions}>
            {chips.map((text) => (
              <SuggestionChip
                key={text}
                text={text}
                onPress={onSuggestion}
                onLongPress={() => onToggleFavorite(text)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function SuggestionChip({
  text,
  onPress,
  onLongPress,
}: {
  text: string;
  onPress: (text: string) => void;
  onLongPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.chip}
      onPress={() => onPress(text)}
      onLongPress={onLongPress}
      delayLongPress={400}
      activeOpacity={0.7}
    >
      <Text style={styles.chipText}>{text}</Text>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Recent command chips (quick-fill row above the input bar)
// ---------------------------------------------------------------------------

function RecentCommandChips({
  commands,
  onPick,
  onToggleFavorite,
  disabled,
}: {
  commands: string[];
  onPick: (text: string) => void;
  onToggleFavorite: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.recentBar}
      contentContainerStyle={styles.recentBarContent}
    >
      {commands.map((text) => (
        <TouchableOpacity
          key={text}
          style={[styles.recentChip, disabled && styles.recentChipDisabled]}
          onPress={() => onPick(text)}
          onLongPress={() => onToggleFavorite(text)}
          delayLongPress={400}
          disabled={disabled}
          activeOpacity={0.7}
        >
          <Text style={styles.recentChipText} numberOfLines={1}>
            {text}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Swipeable command row (swipe left reveals a favorite action)
// ---------------------------------------------------------------------------

const SWIPE_ACTION_WIDTH = 88;

function SwipeableCommandRow({
  children,
  onAction,
  actionLabel,
  actionActive,
  actionVariant = 'icon',
}: {
  children: React.ReactNode | ((open: boolean) => React.ReactNode);
  onAction: () => void;
  actionLabel: string;
  actionActive: boolean;
  actionVariant?: 'icon' | 'button';
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const actionOpacity = translateX.interpolate({
    inputRange: [-SWIPE_ACTION_WIDTH, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const snap = useCallback(
    (toOpen: boolean) => {
      openRef.current = toOpen;
      setOpen(toOpen);
      Animated.spring(translateX, {
        toValue: toOpen ? -SWIPE_ACTION_WIDTH : 0,
        useNativeDriver: true,
        bounciness: 0,
        speed: 24,
      }).start();
    },
    [translateX],
  );

  const onGestureEvent = useCallback(
    (event: PanGestureHandlerGestureEvent) => {
      const base = openRef.current ? -SWIPE_ACTION_WIDTH : 0;
      const next = Math.max(
        -SWIPE_ACTION_WIDTH,
        Math.min(0, base + event.nativeEvent.translationX),
      );
      translateX.setValue(next);
    },
    [translateX],
  );

  const onHandlerStateChange = useCallback(
    (event: PanGestureHandlerStateChangeEvent) => {
      if (event.nativeEvent.oldState !== State.ACTIVE) return;
      const base = openRef.current ? -SWIPE_ACTION_WIDTH : 0;
      const projected = base + event.nativeEvent.translationX;
      snap(projected < -SWIPE_ACTION_WIDTH / 2);
    },
    [snap, translateX],
  );

  const handleAction = useCallback(() => {
    onAction();
    snap(false);
  }, [onAction, snap]);

  return (
    <View style={styles.swipeWrap}>
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[
          styles.swipeAction,
          actionVariant === 'icon' && styles.swipeActionIntegrated,
          actionVariant === 'icon' && { opacity: actionOpacity },
        ]}
      >
        {actionVariant === 'button' ? (
          <TouchableOpacity
            style={styles.swipeActionBtn}
            onPress={handleAction}
            activeOpacity={0.7}
          >
            <View style={styles.swipeActionButton}>
              <Text style={styles.swipeActionButtonText}>{actionLabel}</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.swipeActionBtn}
            onPress={handleAction}
            activeOpacity={0.7}
          >
            <Ionicons
              name={actionActive ? 'star' : 'star-outline'}
              size={19}
              color="#059669"
              style={styles.swipeActionIcon}
            />
            <Text style={styles.swipeActionText}>{actionLabel}</Text>
          </TouchableOpacity>
        )}
      </Animated.View>
      <PanGestureHandler
        activeOffsetX={[-12, 12]}
        failOffsetY={[-18, 18]}
        onGestureEvent={onGestureEvent}
        onHandlerStateChange={onHandlerStateChange}
      >
        <Animated.View style={{ transform: [{ translateX }] }}>
          {typeof children === 'function' ? children(open) : children}
        </Animated.View>
      </PanGestureHandler>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Favorites dropdown (star entry in the header)
// ---------------------------------------------------------------------------

function FavoritesDropdown({
  favorites,
  recommendedCommandsEnabled,
  dismissedRecommendedCommands,
  top,
  onPick,
  onUnfavorite,
  onDismissRecommended,
  onClose,
}: {
  favorites: string[];
  recommendedCommandsEnabled: boolean;
  dismissedRecommendedCommands: string[];
  top: number;
  onPick: (text: string) => void;
  onUnfavorite: (text: string) => void;
  onDismissRecommended: (text: string) => void;
  onClose: () => void;
}) {
  const commands = getFavoriteCommands(
    favorites,
    recommendedCommandsEnabled,
    dismissedRecommendedCommands,
  );
  const favoriteSet = new Set(favorites);
  const recommendedSet = new Set<string>(RECOMMENDED_COMMANDS);
  return (
    <View style={styles.favOverlay} pointerEvents="box-none">
      <Pressable style={styles.favBackdrop} onPress={onClose} />
      <View style={[styles.favDropdown, { top }]}>
        {commands.length === 0 ? (
          <Text style={styles.favEmpty}>
            暂无收藏指令{'\n'}长按或左滑指令即可收藏
          </Text>
        ) : (
          <ScrollView style={styles.favList} keyboardShouldPersistTaps="handled">
            {commands.map((cmd) => {
              const favorite = favoriteSet.has(cmd);
              const recommended = recommendedSet.has(cmd);
              return (
                <SwipeableCommandRow
                  key={cmd}
                  onAction={() => recommended
                    ? onDismissRecommended(cmd)
                    : onUnfavorite(cmd)}
                  actionLabel="取消"
                  actionActive={favorite || recommended}
                  actionVariant="button"
                >
                  <TouchableOpacity
                    style={styles.favItem}
                    onPress={() => onPick(cmd)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name={favorite ? 'star' : 'star-outline'} size={16} color="#059669" />
                    <Text style={styles.favItemText} numberOfLines={1}>{cmd}</Text>
                  </TouchableOpacity>
                </SwipeableCommandRow>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function copyMessageText(text: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
    void Clipboard.setStringAsync(text);
    ToastAndroid.show('已复制', ToastAndroid.SHORT);
  } catch { /* expo-clipboard not linked */ }
}

/**
 * Collapsible ReAct process panel shown under the user's latest command.
 * Collapsed by default (shows only the latest step); expand to see every
 * step's action, input, and output.
 */
function ProcessListIcon({ running }: { running: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!running) {
      opacity.stopAnimation();
      opacity.setValue(1);
      return undefined;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, running]);

  return (
    <Animated.View
      style={[styles.execProcessIcon, { opacity }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {[0, 1, 2].map((row) => (
        <View key={row} style={styles.execProcessIconRow}>
          <View style={styles.execProcessIconCheck}>
            <Text style={styles.execProcessIconCheckmark}>✓</Text>
          </View>
          <View style={styles.execProcessIconLine} />
        </View>
      ))}
    </Animated.View>
  );
}

function ExecutionPanel({
  steps,
  running,
  thinking,
  status,
}: {
  steps: ExecutionStep[];
  running: boolean;
  thinking: string;
  status: string;
}) {
  const [open, setOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [thinkingHistory, setThinkingHistory] = useState<string[]>([]);
  const latest = steps[steps.length - 1];
  // Step-exempt bookkeeping actions (todo_update / wait) don't count as
  // steps; the panel count matches the loop's real step budget.
  const stepCount = steps.filter((s) => s.step !== null).length;
  const stepLabel = (s: ExecutionStep) =>
    s.step !== null ? `${s.step}. ` : '· ';
  const toolLabel = (tool: string) =>
    tool === 'task_complete'
      ? '任务完成'
      : tool === 'context_compression'
        ? '会话压缩'
        : tool;
  const currentThinking = thinking.trim();
  const currentStatus = status.trim();

  useEffect(() => {
    if (!currentThinking) return;
    setThinkingHistory((current) =>
      current[current.length - 1] === currentThinking
        ? current
        : [...current, currentThinking],
    );
  }, [currentThinking]);

  const collapsedText = currentStatus
    ? currentStatus
    : latest?.pending
    ? `${stepLabel(latest)}${toolLabel(latest.tool)} · ${latest.argsText}`
    : currentThinking
      ? `思考 · ${currentThinking}`
      : latest
        ? `${stepLabel(latest)}${toolLabel(latest.tool)} · ${latest.argsText}`
        : '正在思考下一步…';

  return (
    <View style={styles.execPanel}>
      <TouchableOpacity
        style={styles.execHeader}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`处理过程，${stepCount} 步${running ? '，进行中' : ''}`}
        accessibilityState={{ expanded: open }}
      >
        <ProcessListIcon running={running} />
        <Text style={styles.execTitle}>处理过程</Text>
        <Text style={styles.execCount}>
          {stepCount} 步{running ? ' · 进行中' : ''}
        </Text>
        <Text style={styles.execChevron}>{open ? '▾' : '▸'}</Text>
      </TouchableOpacity>

      {!open ? (
        <Text style={styles.execLatest} numberOfLines={5} ellipsizeMode="tail">
          {collapsedText}
        </Text>
      ) : null}

      {open ? (
        <ScrollView
          style={styles.execList}
          contentContainerStyle={styles.execListContent}
          nestedScrollEnabled
        >
          {currentStatus ? (
            <Text style={styles.execStepResult}>{currentStatus}</Text>
          ) : null}
          {thinkingHistory.length > 0 ? (
            <View style={styles.execThinkingSection}>
              <TouchableOpacity
                style={styles.execThinkingHeader}
                onPress={() => setThinkingOpen((value) => !value)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`思考过程，${thinkingHistory.length} 条`}
                accessibilityState={{ expanded: thinkingOpen }}
              >
                <Text style={styles.execThinkingLabel}>思考过程</Text>
                <Text style={styles.execThinkingCount}>
                  {thinkingHistory.length} 条
                </Text>
                <Text style={styles.execThinkingChevron}>
                  {thinkingOpen ? '▾' : '▸'}
                </Text>
              </TouchableOpacity>
              {thinkingOpen
                ? thinkingHistory.map((text, index) => (
                    <View key={`${index}-${text}`}>
                      {index > 0 ? <View style={styles.execThinkingDivider} /> : null}
                      <Text style={styles.execThinkingText}>{text}</Text>
                    </View>
                  ))
                : null}
            </View>
          ) : null}
          {steps.length > 0 ? (
            <View style={styles.execExecutionSection}>
              <Text style={styles.execExecutionLabel}>执行过程</Text>
              {steps.map((s) => (
                <View key={s.index} style={styles.execStep}>
                  <Text style={styles.execStepTitle}>
                    {stepLabel(s)}{toolLabel(s.tool)} · {s.argsText}
                  </Text>
                  {s.skill ? (
                    <Text style={styles.execSkillTag}>召回经验：{s.skill}</Text>
                  ) : null}
                  {s.argsJson ? (
                    <ExecutionIoBlock label="入参" value={s.argsJson} />
                  ) : null}
                  {s.pending ? (
                    <Text style={styles.execStepResult}>执行中…</Text>
                  ) : s.resultJson ? (
                    <ExecutionIoBlock label="出参" value={s.resultJson} />
                  ) : s.resultText ? (
                    <Text style={styles.execStepResult}>{s.resultText}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

/** Raw tool input/output stays available without letting large JSON payloads
 * dominate the execution timeline. Each block starts as one compact row and
 * expands independently when the user asks for the full value. */
function ExecutionIoBlock({
  label,
  value,
}: {
  label: '入参' | '出参';
  value: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <TouchableOpacity
      style={styles.execIoBlock}
      onPress={() => setExpanded((current) => !current)}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={`${label}，${expanded ? '收起完整内容' : '展开完整内容'}`}
      accessibilityState={{ expanded }}
    >
      <View style={styles.execIoHeader}>
        <Text style={styles.execIoLabel}>{label}</Text>
        {!expanded ? (
          <Text style={styles.execIoPreview} numberOfLines={1} ellipsizeMode="tail">
            {value}
          </Text>
        ) : null}
        <Text style={styles.execIoChevron}>{expanded ? '▾' : '▸'}</Text>
      </View>
      {expanded ? (
        <Text style={styles.execIoValue} selectable>{value}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

function TokenStatsRow({ tokens }: { tokens: TokenUsage }) {
  const hitRate = (getPromptCacheHitRate(tokens) * 100).toFixed(1);
  return (
    <Text style={styles.tokenStatsRow}>
      累计 Token {tokens.total.toLocaleString('en-US')} · 缓存命中{' '}
      {tokens.cached.toLocaleString('en-US')} ({hitRate}%)
    </Text>
  );
}

function AgentMarkdown({ value }: { value: string }) {
  // The hook returns ordinary React Native nodes, avoiding a nested FlatList
  // inside the conversation FlatList while still supporting GFM tables.
  const elements = useMarkdown(value, {
    colorScheme: 'light',
    styles: agentMarkdownStyles,
  });
  return (
    <View style={styles.markdownContent}>
      {elements.map((element, index) => (
        <React.Fragment key={`markdown-${index}`}>{element}</React.Fragment>
      ))}
    </View>
  );
}

function MessageBubble({
  message,
  isFavorite,
  swipeActionOpen = false,
}: {
  message: ChatMessage;
  isFavorite?: boolean;
  swipeActionOpen?: boolean;
}) {
  const isUser = message.role === 'user';
  const isAction = message.kind === 'action';
  const isScreen = message.kind === 'screen';
  const timestamp = formatMessageTimestamp(message.timestamp);

  if (isScreen) {
    return (
      <View style={styles.screenRow}>
        <View style={styles.screenLinePre} />
        <Text style={styles.screenLabel}>{message.text}</Text>
        <View style={styles.screenLinePost} />
      </View>
    );
  }

  if (isAction) {
    return (
      <TouchableOpacity
        style={styles.actionRow}
        onLongPress={() => copyMessageText(message.text)}
        activeOpacity={1}
        delayLongPress={400}
      >
        <View style={styles.actionDot} />
        <Text style={styles.actionText} numberOfLines={2}>{message.text}</Text>
        {message.pending && <PendingDots />}
      </TouchableOpacity>
    );
  }

  if (isUser) {
    return (
      <View style={[styles.bubbleRow, styles.bubbleRowUser]}>
        <TouchableOpacity
          style={[
            styles.bubble,
            styles.bubbleUser,
            isFavorite && styles.bubbleUserFav,
            swipeActionOpen && styles.bubbleUserSwipeOpen,
          ]}
          onLongPress={() => copyMessageText(message.text)}
          activeOpacity={1}
          delayLongPress={400}
        >
          <View style={styles.bubbleUserContent}>
            {isFavorite && <Ionicons name="star" size={14} color="#FFFFFF" />}
            <Text style={[styles.bubbleText, styles.bubbleTextUser, styles.bubbleUserText]}>
              {message.text}
            </Text>
          </View>
          {message.pending && <PendingDots />}
          <Text style={[styles.messageTimestamp, styles.messageTimestampUser]}>
            {timestamp}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.bubbleRow, styles.bubbleRowAgent]}
      onLongPress={() => copyMessageText(message.text)}
      activeOpacity={1}
      delayLongPress={400}
    >
      <View style={[styles.bubble, styles.bubbleAgent]}>
        <AgentMarkdown value={message.text} />
        {message.pending && <PendingDots />}
        <Text style={[styles.messageTimestamp, styles.messageTimestampAgent]}>
          {timestamp}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Pending animation (three dots)
// ---------------------------------------------------------------------------

function PendingDots() {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0.3, duration: 300, useNativeDriver: true }),
        ]),
      );
    const a1 = pulse(dot1, 0);
    const a2 = pulse(dot2, 150);
    const a3 = pulse(dot3, 300);
    a1.start();
    a2.start();
    a3.start();
    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [dot1, dot2, dot3]);

  return (
    <View style={styles.dots}>
      {[dot1, dot2, dot3].map((d, i) => (
        <Animated.View key={i} style={[styles.dot, { opacity: d }]} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Input bar
// ---------------------------------------------------------------------------

interface InputBarProps {
  inputRef?: React.RefObject<TextInput | null>;
  value: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  error?: string | null;
}

function InputBar({
  inputRef, value, onChangeText, onSend, error,
}: InputBarProps) {
  const maxLength = 500;
  const canSend = value.trim().length > 0
    && value.trim().length <= maxLength;

  return (
    <View style={styles.inputBar}>
      {/* Text input + character counter */}
      <View style={styles.textInputWrapper}>
        <TextInput
          ref={inputRef}
          style={styles.textInput}
          value={value}
          onChangeText={onChangeText}
          placeholder="告诉豆泡你想做什么"
          placeholderTextColor="#555"
          onSubmitEditing={onSend}
          returnKeyType="send"
          multiline
          maxLength={maxLength + 1}
          blurOnSubmit={false}
          accessibilityLabel="任务输入"
        />
        {/* Show the counter only when approaching the limit, so it does not
            add visual noise to ordinary short messages. */}
        {error || value.length >= 350 ? (
          <View style={styles.inputMetaRow}>
            <Text style={styles.inputValidationError}>{error ?? ''}</Text>
            <Text style={[styles.charCounter, value.length > maxLength && styles.charCounterWarn]}>
              {value.length}/{maxLength}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Send button */}
      <TouchableOpacity
        style={[styles.sendButton, canSend && styles.sendButtonActive]}
        onPress={onSend}
        disabled={!canSend}
        activeOpacity={0.75}
      >
        <Text style={[styles.sendIcon, canSend && styles.sendIconActive]}>↑</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F6F7F9',
  },
  flex: {
    flex: 1,
    backgroundColor: '#F6F7F9',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 64,
    paddingRight: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#059669',
    letterSpacing: -0.3,
  },
  favEntryBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Favorites dropdown overlay
  favOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    elevation: 60,
  },
  favBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  favDropdown: {
    position: 'absolute',
    right: 12,
    width: 300,
    maxHeight: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  favEmpty: {
    padding: 18,
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 13,
    lineHeight: 20,
  },
  favList: {
    maxHeight: 320,
  },
  favItem: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  favItemText: {
    flex: 1,
    fontSize: 14,
    color: '#1F2937',
  },

  // Swipeable row
  swipeWrap: {
    position: 'relative',
    overflow: 'hidden',
  },
  swipeAction: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: SWIPE_ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: 4,
  },
  swipeActionIntegrated: {
    paddingRight: 0,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: '#A7F3D0',
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
  },
  swipeActionBtn: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeActionIcon: {
    marginBottom: 1,
  },
  swipeActionText: {
    fontSize: 11,
    lineHeight: 14,
    color: '#047857',
    marginTop: 0,
  },
  swipeActionButton: {
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 64,
    alignItems: 'center',
  },
  swipeActionButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#DC2626',
  },
  bubbleUserFav: {
    borderColor: '#A7F3D0',
  },
  bubbleUserContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  bubbleUserText: {
    flexShrink: 1,
  },
  bubbleUserSwipeOpen: {
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },

  // Message list
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 8,
  },

  // Archive affordance
  archiveWrap: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 8,
    gap: 8,
  },
  archiveBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 6,
  },
  archiveGuideLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#D1D5DB',
  },
  archiveBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
  },
  // Per-task token stats row under the latest user message.
  tokenStatsRow: {
    fontSize: 12,
    lineHeight: 16,
    color: '#9CA3AF',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 2,
  },

  // Empty state
  empty: {
    flex: 1,
    overflow: 'hidden',
  },
  emptyContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyHeadline: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1F2329',
    letterSpacing: -0.3,
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  chip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  chipText: {
    fontSize: 13,
    color: '#3C4048',
  },

  // Recent command chips (above the input bar)
  recentBar: {
    flexGrow: 0,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#F6F7F9',
  },
  recentBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  recentChip: {
    maxWidth: 240,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  recentChipDisabled: {
    opacity: 0.5,
  },
  recentChipText: {
    fontSize: 12,
    color: '#3C4048',
  },

  // Bubbles
  bubbleRow: {
    flexDirection: 'row',
  },
  bubbleRowUser: {
    justifyContent: 'flex-end',
  },
  bubbleRowAgent: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bubbleUser: {
    backgroundColor: '#10B981',
    borderBottomRightRadius: 4,
  },
  bubbleAgent: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 21,
  },
  bubbleTextUser: {
    color: '#FFFFFF',
  },
  bubbleTextAgent: {
    color: '#3C4048',
  },
  messageTimestamp: {
    alignSelf: 'flex-end',
    marginTop: 4,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  messageTimestampUser: {
    color: 'rgba(255, 255, 255, 0.72)',
  },
  messageTimestampAgent: {
    color: '#9CA3AF',
  },
  markdownContent: {
    flexShrink: 1,
    minWidth: 0,
  },
  // Action rows (agent step indicators)
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  actionDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
    flexShrink: 0,
  },
  actionText: {
    fontSize: 13,
    color: '#6B7280',
    flex: 1,
  },

  // Screen label (divider between screen states)
  screenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 6,
    paddingHorizontal: 4,
  },
  screenLinePre: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  screenLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  screenLinePost: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },

  // Execution process panel
  execPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginVertical: 8,
    overflow: 'hidden',
  },
  execHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  execProcessIcon: {
    width: 16,
    gap: 2,
  },
  execProcessIconRow: {
    height: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  execProcessIconCheck: {
    width: 5,
    height: 5,
    borderRadius: 1.5,
    backgroundColor: '#4F6B5A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  execProcessIconCheckmark: {
    color: '#FFFFFF',
    fontSize: 4,
    lineHeight: 5,
    fontWeight: '800',
  },
  execProcessIconLine: {
    flex: 1,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: '#9CA3AF',
  },
  execTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F2329',
  },
  execCount: {
    flex: 1,
    fontSize: 12,
    color: '#6B7280',
  },
  execChevron: {
    fontSize: 12,
    color: '#6B7280',
  },
  execLatest: {
    fontSize: 12,
    color: '#3C4048',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  execList: {
    maxHeight: 260,
    borderTopWidth: 1,
    borderTopColor: '#F1F3F5',
  },
  execListContent: {
    padding: 10,
    gap: 10,
  },
  execThinkingSection: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    overflow: 'hidden',
  },
  execThinkingHeader: {
    minHeight: 38,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  execThinkingLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4B5563',
  },
  execThinkingCount: {
    flex: 1,
    fontSize: 10,
    color: '#9CA3AF',
  },
  execThinkingChevron: {
    fontSize: 12,
    color: '#6B7280',
  },
  execThinkingText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#6B7280',
    paddingHorizontal: 11,
    paddingBottom: 9,
  },
  execThinkingDivider: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    marginHorizontal: 11,
    marginBottom: 9,
  },
  execExecutionSection: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    overflow: 'hidden',
  },
  execExecutionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#374151',
    paddingHorizontal: 11,
    paddingTop: 10,
    paddingBottom: 3,
  },
  execStep: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E1E4E8',
  },
  execStepTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1F2329',
  },
  execSkillTag: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669',
    marginTop: 3,
  },
  execStepResult: {
    fontSize: 11,
    color: '#6B7280',
    lineHeight: 16,
    marginTop: 3,
  },
  execIoBlock: {
    marginTop: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  execIoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  execIoLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
  },
  execIoPreview: {
    flex: 1,
    minWidth: 0,
    fontSize: 10.5,
    color: '#4B5563',
    lineHeight: 15,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  execIoChevron: {
    fontSize: 10,
    color: '#9CA3AF',
  },
  execIoValue: {
    fontSize: 10.5,
    color: '#4B5563',
    lineHeight: 15,
    marginTop: 4,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },

  // Pending dots
  dots: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    gap: 8,
  },
  textInputWrapper: {
    flex: 1,
    gap: 2,
  },
  textInput: {
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1.2,
    borderColor: '#C7D2CC',
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1F2329',
    lineHeight: 20,
    shadowColor: '#047857',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 4,
  },
  charCounter: {
    fontSize: 11,
    color: '#6B7280',
    textAlign: 'right',
    paddingRight: 8,
  },
  charCounterWarn: {
    color: '#ef4444',
  },
  inputMetaRow: {
    minHeight: 16,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inputValidationError: {
    flex: 1,
    fontSize: 11,
    color: '#DC2626',
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1F3F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonActive: {
    backgroundColor: '#10B981',
  },
  sendIcon: {
    fontSize: 18,
    fontWeight: '700',
    color: '#6B7280',
  },
  sendIconActive: {
    color: '#FFFFFF',
  },

  // Agent status bar
  agentStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#E7F8EF',
    borderTopWidth: 1,
    borderTopColor: '#A7F3D0',
    gap: 8,
  },
  agentStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  agentStatusText: {
    flex: 1,
    fontSize: 13,
    color: '#059669',
    fontWeight: '500',
  },
  stopButton: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#E7F8EF',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  stopButtonText: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '600',
  },

  // Resume banner
  resumeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#E8F1FA',
    borderBottomWidth: 1,
    borderBottomColor: '#BFDBFE',
    gap: 12,
  },
  resumeText: {
    flex: 1,
    fontSize: 13,
    color: '#1D4ED8',
    lineHeight: 18,
  },
  resumeTaskLabel: {
    color: '#1F2329',
    fontWeight: '600',
  },
  resumeButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  resumeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#1d4ed8',
  },
  resumeBtnText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
  dismissBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  dismissBtnText: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '500',
  },

  // Inline user-decision cards
  inlineActionCard: {
    alignSelf: 'stretch',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  preflightCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
  },
  preflightTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1F2329',
    marginBottom: 6,
  },
  preflightSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 12,
  },
  preflightList: {
    width: '100%',
  },
  preflightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F5',
  },
  preflightRowText: {
    flex: 1,
  },
  preflightLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2329',
  },
  preflightDesc: {
    fontSize: 11,
    color: '#6B7280',
    lineHeight: 16,
    marginTop: 2,
  },
  preflightFixBtn: {
    backgroundColor: '#E7F8EF',
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  preflightFixText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#059669',
  },
  preflightButtonDisabled: {
    opacity: 0.55,
  },
  preflightRecheck: {
    marginTop: 14,
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  preflightRecheckText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  preflightCancel: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 12,
    paddingVertical: 6,
  },

  // Confirmation / clarification card body
  confirmCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    gap: 12,
  },
  confirmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  confirmTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1F2329',
  },
  riskBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  riskBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  confirmAction: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2329',
    lineHeight: 24,
  },
  confirmReason: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 20,
  },
  confirmHint: {
    fontSize: 12,
    color: '#9CA3AF',
    lineHeight: 18,
    marginTop: 8,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  riskConfirmButtons: {
    gap: 20,
  },
  completionSecondaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
  },
  completionSecondaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
  },
  completionButtons: {
    justifyContent: 'flex-end',
    gap: 8,
  },
  completionCompactBtn: {
    flex: 0,
    minWidth: 76,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  completionCompactText: {
    fontSize: 14,
  },
  confirmRejectBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#EF4444',
    alignItems: 'center',
  },
  confirmRejectText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  confirmExecuteBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#22C55E',
    alignItems: 'center',
  },
  confirmExecuteText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

/** Markdown styles are intentionally scoped to normal agent replies. Tool
 * actions and screen-state rows keep their compact plain-text presentation,
 * while user commands remain literal so Markdown punctuation in an operation
 * instruction is never reinterpreted. */
const agentMarkdownStyles: MarkedStyles = StyleSheet.create<MarkedStyles>({
  text: {
    color: '#3C4048',
    fontSize: 15,
    lineHeight: 21,
  },
  paragraph: {
    paddingVertical: 3,
  },
  h1: {
    color: '#1F2937',
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 8,
  },
  h2: {
    color: '#1F2937',
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 7,
  },
  h3: {
    color: '#1F2937',
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
    marginTop: 7,
    marginBottom: 6,
  },
  h4: {
    color: '#1F2937',
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
    marginTop: 6,
    marginBottom: 5,
  },
  h5: {
    color: '#374151',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    marginTop: 5,
    marginBottom: 4,
  },
  h6: {
    color: '#4B5563',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 4,
  },
  strong: {
    color: '#1F2937',
    fontWeight: '700',
  },
  em: {
    fontStyle: 'italic',
  },
  link: {
    color: '#047857',
    textDecorationLine: 'underline',
  },
  blockquote: {
    backgroundColor: '#F3F4F6',
    borderLeftColor: '#10B981',
    borderLeftWidth: 3,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginVertical: 6,
  },
  list: {
    marginVertical: 4,
  },
  li: {
    color: '#3C4048',
    fontSize: 15,
    lineHeight: 21,
    marginVertical: 2,
  },
  codespan: {
    color: '#B42318',
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  code: {
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginVertical: 6,
  },
  hr: {
    backgroundColor: '#D1D5DB',
    height: 1,
    marginVertical: 10,
  },
  table: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    marginVertical: 8,
  },
  tableRow: {
    backgroundColor: '#F3F4F6',
    borderColor: '#D1D5DB',
  },
  tableCell: {
    borderColor: '#D1D5DB',
    padding: 6,
  },
  image: {
    borderRadius: 8,
  },
});
