/**
 * Agent bridge.
 *
 * Receives a text command from the chat UI and drives the agent loop:
 *   1. Start an ephemeral execution/thinking state
 *   2. Build a provider (CloudProvider when fallback is enabled, stub otherwise)
 *   3. Run AgentLoop from the vendored device-agent core, streaming execution state
 *   4. Append the final summary to chat when the run actually finishes
 *
 * Falls back to a canned stub response when the vendored device-agent core or
 * react-native-accessibility-controller are not linked (simulator, tests).
 */

import {
  AppState,
  DeviceEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Vibration,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  addMessage,
  getMessages,
} from '../store/chatStore';
import { buildConversationMessages } from './conversationContext';
import type { ConversationMessage, ToolRiskGateRequest } from '../device-agent/types';
import { sanitizeRiskReason } from '../device-agent/tools/ToolRiskInterceptor';
import {
  cancelPendingNotification,
  cancelRiskConfirmNotification,
  completeForegroundService,
  showRiskConfirmNotification,
  startForegroundService,
  startHeartbeat,
  stopForegroundService,
  stopHeartbeat,
  updateForegroundService,
} from './foregroundService';
import { getSettings } from '../store/settingsStore';
import { resolveModelContextWindow } from '../modelCatalog/modelContextWindow';
import { getActiveSkills, getSkillBody } from '../store/skillStore';
import { addSession, type SessionOutcome } from '../store/historyStore';
import { agentActioned, agentCompletionDecisionRestored, agentCompletionPending, agentCompletionResolved, agentCompletionSupplementStarted, agentMaxStepsRaised, agentStarted, agentStepped, agentStopped, getAgentState } from '../store/agentStore';
import {
  beginExecution,
  endExecution,
  addActionStep,
  addContextCompressionSummary,
  updateExecutionThinking,
  updateExecutionStatus,
  updateLastStepResult,
} from '../store/executionStore';
import {
  beginTaskLog,
  appendTaskLog,
} from '../store/taskLogger';
import {
  addTokens,
  getTaskTokens,
  resetTaskTokens,
} from '../store/tokenStats';
import { getGenerateFn, getGenerateWithImageFn } from './llmBridge';
import { setAgentBusy } from './watchdogBridge';
import {
  beginTrace,
  endTrace,
  startSpan,
  endSpan,
  logEvent,
  recordCompletedSpan,
} from './otelLogger';
import { TodoList } from '../device-agent/agent/TodoList';
import { STEP_EXEMPT_TOOLS } from '../device-agent/agent/AgentLoop';
import {
  TODO_CREATE_TOOL,
  TODO_CREATE_TOOL_NAME,
  TODO_UPDATE_TOOL,
  TODO_UPDATE_TOOL_NAME,
  createTodoCreateHandler,
  createTodoUpdateHandler,
} from '../device-agent/tools/TodoTool';
import { READ_SKILL_TOOL_NAME } from '../device-agent/tools/SkillTool';
import { beginTodoFile, finalizeTodoFile, saveTodos } from './todoFileStore';
import {
  requestUserConfirm,
  resolveUserConfirm,
  type RiskLevel,
} from '../store/confirmStore';
import {
  CLARIFICATION_MAX_LENGTH,
  cancelUserClarification,
  requestUserClarification,
  submitUserClarification,
} from '../store/clarificationStore';
import {
  cancelManualUserAction,
  completeManualUserAction,
  requestManualUserAction,
} from '../store/userActionStore';
import { browserSession, createBrowserToolRegistrations } from '../browser';
import { createWebSearchToolRegistration } from '../web-search';
import {
  SHELL_EXECUTE_TOOL,
  createShellExecuteHandler,
} from '../shell';
import {
  ASK_USER_DEFAULT_DESCRIPTION,
  CONFIRM_ACTION_DEFAULT_DESCRIPTION,
  REQUEST_USER_ACTION_DEFAULT_DESCRIPTION,
} from '../device-agent/tools/ToolCircuitBreakerPolicy';
import {
  INITIAL_TASK_INTERACTION_KIND,
  nextInteractionKind,
  shouldReturnToExternalApp,
  type TaskInteractionKind,
} from './completionReturnPolicy';
import {
  COMPLETION_SUPPLEMENT_MAX_LENGTH,
  buildCompletionContinuation,
  buildSupplementContinuation,
  validateCompletionSupplement,
} from './completionDecision';
import { isExternalOperationToolCall } from './completionGatePolicy';
import { AGENT_SYSTEM_PROMPT } from './prompts/agentSystemPrompt';
import { buildEnvironmentContext } from './environmentContext';
import { speakText } from '../voice/voiceBridge';
import { markAutomatedHostForeground } from '../voice/hostEntrySpeechPolicy';

export { COMPLETION_SUPPLEMENT_MAX_LENGTH } from './completionDecision';
export { AGENT_SYSTEM_PROMPT };

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

let _stopped = false;
let _activePlanner: { abort: () => void } | null = null;
let _activeLoop: { abort: () => void } | null = null;
let _pendingUserMessages: string[] = [];
// Instructions submitted after Stop but before the old run has completed its
// teardown belong to the next run. The stopped loop cannot consume them at a
// later decision boundary.
let _commandsQueuedAfterStop: string[] = [];
// All heartbeat intervals created by any task run. A Set (not a single
// variable) so an overlapping or leaked timer from an earlier run can never
// survive teardown: the finally block clears every handle in it.
let _heartbeatTimers = new Set<ReturnType<typeof setInterval>>();

// ---------------------------------------------------------------------------
// Completion confirmation (user gate on the model's completion verdict)
// ---------------------------------------------------------------------------
// The model's task_complete / plain-text reply is treated as a *verdict* that
// must be confirmed by the user. requestCompletionDecision publishes one
// shared pending state: the visible host uses an inline card, while background
// operation uses the floating overlay. It defaults to 'complete' after 60s so
// a task can never hang. Overlay-side 补充信息 pulls the host forward for text
// entry; an already-visible host stays in place.
let _completionGateResolver:
  | ((decision: 'complete' | { continue: string }) => void)
  | null = null;
let _completionGateTimer: ReturnType<typeof setTimeout> | null = null;
let _completionGateGeneration = 0;
let _restartCompletionTimeout: (() => void) | null = null;
let _completionGateTargetPackage = '';
// True once text-entry supplement mode is opened for a completion gate that
// originated in an external app. This is deliberately independent of whether
// this function itself foregrounded the host: the user can open DouPao first
// and submit through the always-available main input box.
let _completionGateExternalSupplementOpen = false;
let _overlayTextInputSequence = 0;
type OverlayTextInputGate = {
  requestId: string;
  onSubmit: (text: string) => void;
  onFallback: () => void;
};
let _activeOverlayTextInputGate: OverlayTextInputGate | null = null;
const COMPLETION_GATE_TIMEOUT_MS = 60_000;
const HOST_PACKAGE = 'com.watchdog.agent';
let _taskInteractionKind: TaskInteractionKind = INITIAL_TASK_INTERACTION_KIND;
let _taskHadExternalOperation = false;

function overlayInputController(): {
  showTextInputOverlay?: (config: {
    requestId: string;
    prompt: string;
    placeholder?: string;
    maxLength: number;
    fallbackLabel: string;
  }) => Promise<void>;
  cancelTextInputOverlay?: () => Promise<void>;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-accessibility-controller');
  } catch {
    return null;
  }
}

async function showOverlayTextInput(args: {
  kind: 'completion' | 'ask_user';
  prompt: string;
  placeholder?: string;
  maxLength: number;
  fallbackLabel: string;
  onSubmit: (text: string) => void;
  onFallback: () => void;
}): Promise<boolean> {
  const ctrl = overlayInputController();
  if (!ctrl?.showTextInputOverlay) return false;
  const requestId = `${args.kind}-${Date.now().toString(36)}-${(++_overlayTextInputSequence).toString(36)}`;
  const gate: OverlayTextInputGate = {
    requestId,
    onSubmit: args.onSubmit,
    onFallback: args.onFallback,
  };
  _activeOverlayTextInputGate = gate;
  try {
    await ctrl.showTextInputOverlay({
      requestId,
      prompt: args.prompt,
      placeholder: args.placeholder,
      maxLength: args.maxLength,
      fallbackLabel: args.fallbackLabel,
    });
    return _activeOverlayTextInputGate === gate;
  } catch {
    if (_activeOverlayTextInputGate === gate) _activeOverlayTextInputGate = null;
    return false;
  }
}

function dismissOverlayTextInput(): void {
  _activeOverlayTextInputGate = null;
  overlayInputController()?.cancelTextInputOverlay?.().catch(() => {});
}

/** Reset at task boundaries; exported for host-level behavioral tests. */
export function resetTaskInteractionKind(): void {
  _taskInteractionKind = INITIAL_TASK_INTERACTION_KIND;
  _taskHadExternalOperation = false;
  _completionGateTargetPackage = '';
  _completionGateExternalSupplementOpen = false;
  dismissOverlayTextInput();
}

/** Record a dispatched tool before inspecting its result. */
export function recordTaskToolDispatch(
  toolName: string,
  args: Record<string, unknown> = {},
): void {
  _taskInteractionKind = nextInteractionKind(_taskInteractionKind, toolName);
  if (isExternalOperationToolCall(toolName, args)) _taskHadExternalOperation = true;
}

function validExternalPackage(packageName: string | undefined): string {
  const value = packageName?.trim() ?? '';
  return value && value !== HOST_PACKAGE ? value : '';
}

/**
 * The package of the app the agent is operating right now. Queried at
 * gate-open time — the external app is still focused at that instant, so
 * this is the exact app to hand back to after the user decides.
 */
async function captureGateTargetPackage(): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ctrl = require('react-native-accessibility-controller') as {
      getCurrentForegroundApp?: () => Promise<{
        packageName: string;
        className: string;
      }>;
      getLastForegroundApp?: () => Promise<{
        packageName: string;
        className: string;
      }>;
    };
    const current = await ctrl.getCurrentForegroundApp?.().catch(() => null);
    let pkg = validExternalPackage(current?.packageName);
    if (!pkg) {
      const last = await ctrl.getLastForegroundApp?.().catch(() => null);
      pkg = validExternalPackage(last?.packageName);
    }
    // eslint-disable-next-line no-console
    console.log(`[GATE] external target ${pkg ? 'resolved' : 'unavailable'}`);
    return pkg;
  } catch (error) {
    // Do not include task, screen or user content in diagnostics.
    // eslint-disable-next-line no-console
    console.warn(`[GATE] external target lookup failed: ${error instanceof Error ? error.name : 'unknown'}`);
    return '';
  }
}

/** Pull the host app forward so its inline confirmation card is visible.
 *  Fire-and-forget: the overlay + notification remain as fallback surfaces
 *  when MIUI blocks the background start. */
function bringHostForward(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ctrl = require('react-native-accessibility-controller') as {
      bringHostAppToForeground?: () => Promise<boolean>;
    };
    ctrl.bringHostAppToForeground?.().catch(() => {});
  } catch {
    // Module not linked (simulator / tests).
  }
}

/** Hand the user back to the app the agent was operating. The caller may wait
 *  for native foreground verification before allowing the AgentLoop to resume. */
async function handBackToGateTarget(pkg: string): Promise<boolean> {
  if (!pkg) {
    // eslint-disable-next-line no-console
    console.warn('[GATE] external return skipped: no valid target');
    return false;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ctrl = require('react-native-accessibility-controller') as {
      returnToPreviousApp?: (packageName: string) => Promise<boolean>;
    };
    if (!ctrl.returnToPreviousApp) {
      // eslint-disable-next-line no-console
      console.warn('[GATE] external return unavailable');
      return false;
    }
    const ok = await ctrl.returnToPreviousApp(pkg).catch(() => false);
    if (!ok) console.warn('[GATE] external return reported failure');
    return ok;
  } catch {
    // eslint-disable-next-line no-console
    console.warn('[GATE] external return module unavailable');
    return false;
  }
}

/** Native return normally verifies within ~2 seconds. Bound the wait so a
 * broken OEM task switch can never leave the completion gate hanging. */
async function handBackBeforeResume(pkg: string): Promise<void> {
  const returned = handBackToGateTarget(pkg);
  await Promise.race([
    returned.then(() => undefined),
    freezeSafeDelay(4_000),
  ]);
}

/** Visible, host-owned recovery for an expired MediaProjection grant. The
 * AgentLoop is blocked while this runs; no model inference or tool dispatch
 * can continue until consent resolves and the previous app is restored. */
async function requestScreenCapturePermission(): Promise<'granted' | 'denied'> {
  const targetPackage = await captureGateTargetPackage();
  updateExecutionStatus('需要屏幕录制授权，请在系统弹窗中选择“共享屏幕”');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ctrl = require('react-native-accessibility-controller') as {
      bringHostAppToForeground?: () => Promise<boolean>;
      requestMediaProjection?: () => Promise<boolean>;
      probeProjectionReady?: () => Promise<boolean>;
      isMediaProjectionReady?: () => Promise<boolean>;
    };
    if (!ctrl.bringHostAppToForeground || !ctrl.requestMediaProjection) {
      addMessage('agent', 'text', '屏幕录制授权能力当前不可用，任务已暂停。');
      return 'denied';
    }

    const foregrounded = await Promise.race([
      ctrl.bringHostAppToForeground().catch(() => false),
      freezeSafeDelay(4_000).then(() => false),
    ]);
    if (!foregrounded) {
      addMessage('agent', 'text', '无法打开屏幕录制授权页面，任务已暂停。');
      return 'denied';
    }
    await freezeSafeDelay(400);

    const granted = await ctrl.requestMediaProjection().catch(() => false);
    if (!granted) {
      addMessage('agent', 'text', '未获得屏幕录制权限，截图操作已暂停。');
      return 'denied';
    }
    const ready = ctrl.probeProjectionReady
      ? await ctrl.probeProjectionReady().catch(() => false)
      : await ctrl.isMediaProjectionReady?.().catch(() => false) ?? false;
    if (!ready) {
      addMessage('agent', 'text', '屏幕录制授权尚未生效，截图操作已暂停。');
      return 'denied';
    }

    updateExecutionStatus('授权成功，正在返回之前的应用');
    const returned = targetPackage
      ? await Promise.race([
          handBackToGateTarget(targetPackage),
          freezeSafeDelay(6_000).then(() => false),
        ])
      : false;
    if (!returned) {
      addMessage('agent', 'text', '屏幕录制已授权，但未能返回之前的应用，任务已暂停。');
      return 'denied';
    }
    await freezeSafeDelay(500);
    return 'granted';
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[SHOT] permission gate failed: ${error instanceof Error ? error.name : 'unknown'}`);
    addMessage('agent', 'text', '屏幕录制授权失败，截图操作已暂停。');
    return 'denied';
  } finally {
    updateExecutionStatus('');
  }
}

/** On-demand location authorization for android-location. Location is not a
 * startup prerequisite: the host app is surfaced only when a command actually
 * needs it, then the exact frozen shell command is retried once. */
async function requestLocationPermission(): Promise<'granted' | 'denied'> {
  if (Platform.OS !== 'android') return 'denied';
  const targetPackage = await captureGateTargetPackage();
  updateExecutionStatus('需要位置权限，请在系统弹窗中授权');
  try {
    const coarse = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
    const fine = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    if (
      await PermissionsAndroid.check(coarse).catch(() => false) ||
      await PermissionsAndroid.check(fine).catch(() => false)
    ) {
      return 'granted';
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ctrl = require('react-native-accessibility-controller') as {
      bringHostAppToForeground?: () => Promise<boolean>;
    };
    if (!ctrl.bringHostAppToForeground) {
      addMessage('agent', 'text', '位置授权能力当前不可用，任务已暂停。');
      return 'denied';
    }
    const foregrounded = await Promise.race([
      ctrl.bringHostAppToForeground().catch(() => false),
      freezeSafeDelay(4_000).then(() => false),
    ]);
    if (!foregrounded) {
      addMessage('agent', 'text', '无法打开位置授权页面，任务已暂停。');
      return 'denied';
    }
    await freezeSafeDelay(400);

    const decisions = await PermissionsAndroid.requestMultiple([coarse, fine]);
    const granted = decisions[coarse] === PermissionsAndroid.RESULTS.GRANTED ||
      decisions[fine] === PermissionsAndroid.RESULTS.GRANTED;
    if (!granted) {
      addMessage('agent', 'text', '未获得位置权限，定位操作已暂停。');
      return 'denied';
    }

    if (targetPackage) {
      updateExecutionStatus('授权成功，正在返回之前的应用');
      const returned = await Promise.race([
        handBackToGateTarget(targetPackage),
        freezeSafeDelay(6_000).then(() => false),
      ]);
      if (!returned) {
        addMessage('agent', 'text', '位置权限已授权，但未能返回之前的应用，任务已暂停。');
        return 'denied';
      }
      await freezeSafeDelay(300);
    }
    return 'granted';
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[LOCATION] permission gate failed: ${error instanceof Error ? error.name : 'unknown'}`);
    addMessage('agent', 'text', '位置授权失败，定位操作已暂停。');
    return 'denied';
  } finally {
    updateExecutionStatus('');
  }
}

function invalidateCompletionTimeout(): void {
  _completionGateGeneration++;
  if (_completionGateTimer) clearTimeout(_completionGateTimer);
  _completionGateTimer = null;
}

/**
 * Await the user's verdict on the model's completion claim. Publishes shared
 * pending state for either the host card or floating overlay and races the
 * user's answer against a 60s timeout that defaults to 'complete'.
 */
export async function requestCompletionDecision(
  result: string,
): Promise<'complete' | { continue: string }> {
  try {
    // eslint-disable-next-line no-console
    console.log('[GATE] entered');
    // AgentLoop deliberately routes both task_complete and terminal prose
    // through this host gate. The host decides whether a real confirmation is
    // warranted from the task's actual dispatch history. With no external
    // operation there is nothing for the user to verify, so accept completion
    // before publishing pending state, notifications or foreground changes.
    if (!_taskHadExternalOperation) {
      // eslint-disable-next-line no-console
      console.log('[GATE] skipped: no external operation');
      return 'complete';
    }
    // Only operation tasks need a return target. Capture it before the host
    // comes forward and recapture independently for every confirmation round.
    _completionGateTargetPackage = shouldReturnToExternalApp(_taskInteractionKind)
      ? await captureGateTargetPackage()
      : '';
    _completionGateExternalSupplementOpen = false;
    agentCompletionPending(result);
    // eslint-disable-next-line no-console
    console.log('[GATE] pending set');
    // UI routing is adaptive: ChatScreen owns the decision while the host is
    // visible; AgentOverlay owns it while the user remains in another app.
    // Do not foreground the host merely because the gate opened.
    // eslint-disable-next-line no-console
    console.log('[GATE] overlay decision pending');
    return new Promise<'complete' | { continue: string }>((resolve) => {
      let settled = false;
      const settle = (decision: 'complete' | { continue: string }, source: string) => {
        if (settled) return;
        settled = true;
        // eslint-disable-next-line no-console
        console.log(`[GATE] settle source=${source} elapsed=${Date.now() - startedAt}ms`);
        invalidateCompletionTimeout();
        _completionGateResolver = null;
        _restartCompletionTimeout = null;
        // Cancel any stale notification left by an older installed build.
        cancelPendingNotification();
        agentCompletionResolved();
        // An explicit user acceptance ends the interactive browser surface as
        // well as the task. Keep tabs/page state intact so a later browser
        // request can resume them; timeout-based acceptance must not silently
        // dismiss a window the user did not choose to close.
        if (decision === 'complete' && source === 'resolver') {
          browserSession.dismiss();
        }
        // Text submitted through the host must resume against the external
        // app captured when this gate opened. Whether beginCompletionSupplement
        // actively foregrounded the host is not a reliable proxy: the user may
        // already have opened DouPao before typing in the main input box.
        // 完成 / 未完成 on the floating overlay still settle in place.
        const returnTarget = _completionGateExternalSupplementOpen
          ? _completionGateTargetPackage
          : '';
        _completionGateExternalSupplementOpen = false;
        _completionGateTargetPackage = '';
        // Do not resume the loop while DouPao is still foreground: its next UI
        // observation would describe the host instead of the operated app.
        if (returnTarget) {
          void handBackBeforeResume(returnTarget).then(() => resolve(decision));
        } else {
          resolve(decision);
        }
      };
      const startedAt = Date.now();
      // eslint-disable-next-line no-console
      console.log('[GATE] pending created');
      const resolver = (decision: 'complete' | { continue: string }) => settle(decision, 'resolver');
      _completionGateResolver = resolver;
      const scheduleTimeout = () => {
        invalidateCompletionTimeout();
        const generation = _completionGateGeneration;
        const settleIfCurrent = (source: string) => {
          if (
            generation !== _completionGateGeneration ||
            getAgentState().completionPending?.phase !== 'decision'
          ) return;
          settle('complete', source);
        };
        _completionGateTimer = setTimeout(
          () => settleIfCurrent('js-timer'),
          COMPLETION_GATE_TIMEOUT_MS,
        );
        void freezeSafeDelay(COMPLETION_GATE_TIMEOUT_MS).then(
          () => settleIfCurrent('freeze-safe'),
        );
      };
      _restartCompletionTimeout = scheduleTimeout;
      scheduleTimeout();
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[GATE] EXCEPTION ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

/** Resolve a pending completion gate from either confirmation surface. */
export function resolveCompletionDecision(
  decision: 'complete' | { continue: string },
): void {
  // eslint-disable-next-line no-console
  console.log(`[GATE] resolveCompletionDecision called ${JSON.stringify(decision)}`);
  _completionGateResolver?.(decision);
}

/** Enter supplemental-input mode without settling the completion gate.
 *  Overlay callers foreground the host for text entry; an already-visible
 *  host card can opt out so completion does not unexpectedly return to the
 *  previously operated app after the user submits. */
export function beginCompletionSupplement(
  options: {
    foregroundHost?: boolean;
    returnToExternalAfterSubmit?: boolean;
  } = {},
): void {
  if (!_completionGateResolver || !getAgentState().completionPending) return;
  invalidateCompletionTimeout();
  // Binary fallback surfaces cannot collect text. Remove them while the user
  // is composing so neither can bypass the required supplement submission.
  cancelPendingNotification();
  agentCompletionSupplementStarted();
  const foregroundHost = options.foregroundHost !== false;
  // Main-input submission uses foregroundHost=false because DouPao is already
  // visible. It still needs a hand-back when the gate captured an external
  // target, so track the external origin rather than who performed the switch.
  const returnToExternalAfterSubmit = options.returnToExternalAfterSubmit !== false;
  _completionGateExternalSupplementOpen = _completionGateExternalSupplementOpen || (
    returnToExternalAfterSubmit && Boolean(_completionGateTargetPackage)
  );
  if (foregroundHost) bringHostForward();
}

/** Return to the decision phase and grant a fresh full timeout window. */
export function returnToCompletionDecision(): void {
  if (!_completionGateResolver || getAgentState().completionPending?.phase !== 'supplement') return;
  agentCompletionDecisionRestored();
  if (_completionGateExternalSupplementOpen) {
    void handBackToGateTarget(_completionGateTargetPackage);
    _completionGateExternalSupplementOpen = false;
  }
  _restartCompletionTimeout?.();
}

export type SupplementSubmissionResult =
  | { ok: true }
  | { ok: false; error: 'empty' | 'too_long' | 'not_pending' };

/** Validate and inject user context without logging or persisting the draft. */
export function submitCompletionSupplement(rawText: string): SupplementSubmissionResult {
  if (!_completionGateResolver || getAgentState().completionPending?.phase !== 'supplement') {
    return { ok: false, error: 'not_pending' };
  }
  const validation = validateCompletionSupplement(rawText);
  if (!validation.ok) return validation;
  const continuation = buildSupplementContinuation(validation.text);
  // The UI writes the accepted user message synchronously after this returns.
  // Resume on the next microtask so even an immediate model response cannot
  // appear before that message.
  void Promise.resolve().then(() => resolveCompletionDecision({ continue: continuation }));
  return { ok: true };
}

/** Reject the model's completion verdict: inject the fixed continuation prompt
 *  (the original goal stays on top; the verdict context is preserved) and keep
 *  the loop running. */
export function rejectCompletion(result: string): void {
  resolveCompletionDecision({
    continue: buildCompletionContinuation(result),
  });
}

function beginCompletionOverlaySupplement(): void {
  const pending = getAgentState().completionPending;
  if (!pending) return;
  beginCompletionSupplement({
    foregroundHost: false,
    returnToExternalAfterSubmit: false,
  });
  void showOverlayTextInput({
    kind: 'completion',
    prompt: '请补充需要豆泡继续处理的信息',
    placeholder: '输入补充信息',
    maxLength: COMPLETION_SUPPLEMENT_MAX_LENGTH,
    fallbackLabel: '返回',
    onSubmit: (text) => {
      dismissOverlayTextInput();
      const result = submitCompletionSupplement(text);
      if (result.ok) addMessage('user', 'text', text.trim());
    },
    onFallback: () => {
      dismissOverlayTextInput();
      returnToCompletionDecision();
    },
  }).then((shown) => {
    if (shown || getAgentState().completionPending?.phase !== 'supplement') return;
    // Overlay/IME unavailable: retain the existing host editor as a safe
    // fallback and remember that submission must hand back to the target app.
    beginCompletionSupplement({
      foregroundHost: true,
      returnToExternalAfterSubmit: true,
    });
  });
}

// Floating-overlay completion choices arrive here through the host receiver.
// 完成 / 未完成 settle in place; 补充信息 switches to the host text-entry phase.
DeviceEventEmitter.addListener(
  'completion-decision',
  (payload: { decision?: string }) => {
    // eslint-disable-next-line no-console
    console.log(`[GATE] completion-decision event ${JSON.stringify(payload)}`);
    // Once 补充信息 is selected, only submitting that dialog (or returning
    // to the decision phase) may settle the gate. Ignore stale overlay or
    // notification actions that were queued before those surfaces vanished.
    if (getAgentState().completionPending?.phase === 'supplement') return;
    if (payload?.decision === 'complete') {
      resolveCompletionDecision('complete');
      return;
    }
    if (payload?.decision === 'supplement') {
      beginCompletionOverlaySupplement();
      return;
    }
    // 'reject' (or any unknown value) → continue the task; the verdict result
    // is read from the agent store, which the gate published on entry.
    const pending = getAgentState().completionPending;
    rejectCompletion(pending?.result ?? '任务尚未完成');
  },
);

DeviceEventEmitter.addListener(
  'overlay-text-input',
  (payload: { requestId?: string; action?: string; text?: string }) => {
    const gate = _activeOverlayTextInputGate;
    if (!gate || payload?.requestId !== gate.requestId) return;
    // Clear before invoking application code so duplicate taps/broadcasts are
    // idempotent even if native teardown is still in flight.
    _activeOverlayTextInputGate = null;
    if (payload.action === 'submit') {
      gate.onSubmit(payload.text ?? '');
    } else if (payload.action === 'fallback') {
      gate.onFallback();
    }
  },
);

// Risk-confirmation decisions (confirm_action gate): the floating overlay is
// the primary surface and the fallback notification uses the broadcast path.
// Both share the confirmStore resolver — resolving twice is harmless (the
// second call sees no pending request).
DeviceEventEmitter.addListener(
  'onOverlayRiskDecision',
  (payload: { decision?: string }) => {
    // eslint-disable-next-line no-console
    console.log(`[RISK-GATE] overlay decision ${JSON.stringify(payload)}`);
    if (payload?.decision === 'execute' || payload?.decision === 'reject') {
      resolveUserConfirm(payload.decision);
    }
  },
);
DeviceEventEmitter.addListener(
  'risk-confirm-decision',
  (payload: { decision?: string }) => {
    // eslint-disable-next-line no-console
    console.log(`[RISK-GATE] broadcast decision ${JSON.stringify(payload)}`);
    if (payload?.decision === 'execute' || payload?.decision === 'reject') {
      resolveUserConfirm(payload.decision);
    }
  },
);

// The direct overlay event is fast while JS is awake; the host broadcast
// emits user-action-complete as a freeze-safe duplicate. Resolving twice is safe.
DeviceEventEmitter.addListener('onOverlayUserActionComplete', () => {
  completeManualUserAction();
});
DeviceEventEmitter.addListener('user-action-complete', () => {
  completeManualUserAction();
});

// ---------------------------------------------------------------------------
// Native heartbeat events (freeze diagnosis)
// ---------------------------------------------------------------------------
// HeartbeatReceiver fires an alarm every 3s while a task runs; each delivery
// also pushes a "deftHeartbeat" event into the JS queue from native. JS timers
// die when MIUI freezes the app behind another app, but native messages wake
// the JS thread's epoll — so receiving these events proves the channel works.
let _nativeBeatCount = 0;
DeviceEventEmitter.addListener('deftHeartbeat', (payload: { ts?: number }) => {
  _nativeBeatCount++;
  // eslint-disable-next-line no-console
  console.log(
    `[NATIVE-HB] js received #${_nativeBeatCount} ts=${payload?.ts ?? '?'} now=${Date.now()}`,
  );
});

// Per-request result-level todo list, persisted to tasklogs/todo-<traceId>.json.
let _todoList: TodoList | null = null;

/**
 * Builds todo_create/todo_update entries bound to the current request's list.
 */
function buildTodoTools():
  | Array<{
      tool: unknown;
      handler: (args: Record<string, unknown>) => Promise<unknown>;
    }>
  | undefined {
  const todoList = _todoList;
  if (!todoList) return undefined;
  const persist = (eventName: 'todo.create' | 'todo.update') => (items: ReturnType<TodoList['getItems']>) => {
    saveTodos(items);
    logEvent(eventName, {
      count: items.length,
      completed: items.filter((item) => item.status === 'completed').length,
      inProgress: items.filter((item) => item.status === 'in_progress').length,
    });
  };
  return [
    {
      tool: TODO_CREATE_TOOL,
      handler: createTodoCreateHandler(todoList, persist('todo.create')),
    },
    {
      tool: TODO_UPDATE_TOOL,
      handler: createTodoUpdateHandler(todoList, persist('todo.update')),
    },
  ];
}

/**
 * Recent risk-gate decisions, keyed by `risk|normalized-action`. Guards
 * against a model looping back and re-confirming the same action — repeats
 * short-circuit with the previous verdict instead of re-prompting the user.
 */
const confirmDecisionCache = new Map<string, 'execute' | 'deny'>();
const CONFIRM_DECISION_CACHE_MAX = 64;

function rememberConfirmDecision(key: string, decision: 'execute' | 'deny'): void {
  confirmDecisionCache.set(key, decision);
  if (confirmDecisionCache.size > CONFIRM_DECISION_CACHE_MAX) {
    confirmDecisionCache.clear();
  }
}

/** Speak a newly displayed user gate once when speech output is enabled. */
function speakUserGate(text: string): void {
  const settings = getSettings();
  if (!settings.ttsEnabled && !settings.voiceMode) return;
  void speakText(text);
}

/**
 * User-confirmation gate for high-risk actions. The model must call this tool
 * before executing anything it judges high-risk (payment, delete, reset,
 * send message, …). The handler blocks the agent loop until the user taps
 * 执行/拒绝 in the floating overlay.
 */
const CONFIRM_ACTION_TOOL = {
  name: 'confirm_action',
  description: CONFIRM_ACTION_DEFAULT_DESCRIPTION,
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: '即将执行的具体动作，例如：点击「确认支付」按钮' },
      risk: {
        type: 'string',
        enum: ['low', 'high'],
        description: '风险评估等级',
      },
      reason: { type: 'string', description: '为什么判定为高风险，例如：涉及真实资金支付' },
    },
    required: ['action', 'risk'],
  },
};

export function buildConfirmTool(): {
  tool: unknown;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
} {
  return {
    tool: CONFIRM_ACTION_TOOL,
    handler: async (args: Record<string, unknown>) => {
      const risk = ['low', 'high'].includes(String(args.risk))
        ? (String(args.risk) as RiskLevel)
        : 'high';
      const action = String(args.action ?? '未知操作');
      const reason = sanitizeRiskReason(args.reason);

      // Idempotent short-circuit: a model can loop back and re-confirm the
      // same action (observed in the wild — three consecutive confirm_action
      // calls for one tap). Re-asking the user turns that into a modal loop,
      // so repeats get the previous verdict back without a new prompt. Keys
      // are whitespace-normalized because the model reformats the action
      // text between calls.
      const explicitFingerprint = typeof args._fingerprint === 'string'
        ? args._fingerprint.trim()
        : '';
      const cacheKey = explicitFingerprint || `${risk}|${action.replace(/\s+/g, '')}`;
      const useDecisionCache = args._skipCache !== true;
      const cached = useDecisionCache ? confirmDecisionCache.get(cacheKey) : undefined;
      if (cached !== undefined) {
        return cached === 'execute'
          ? {
              ok: true,
              confirmed: true,
              denied: false,
              message: '该动作此前已确认，请立即执行，不要重复确认',
            }
          : {
              ok: false,
              confirmed: false,
              denied: true,
              message: '该动作此前已被拒绝，任务已暂停',
            };
      }

      // Publish the pending resolver before exposing any button, so even an
      // immediate overlay tap cannot be lost. Keep the operated app in the
      // foreground; a system notification is used only when the overlay is
      // unavailable.
      const choicePromise = requestUserConfirm({
        action,
        risk,
        reason,
      });
      const riskLabel = risk === 'high' ? '高风险' : '低风险';
      speakUserGate(
        `需要你的确认。${riskLabel}操作：${action}${reason ? `。风险说明：${reason}` : ''}`,
      );
      let overlayShown = false;
      // The inline card is the only confirmation surface while DouPao is in
      // front. A system overlay/notification is reserved for background use.
      if (AppState.currentState !== 'active') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const ctrl = require('react-native-accessibility-controller') as {
            showRiskConfirmOverlay?: (
              action: string,
              risk: string,
              reason?: string,
            ) => Promise<void>;
          };
          if (!ctrl.showRiskConfirmOverlay) throw new Error('risk overlay unavailable');
          await ctrl.showRiskConfirmOverlay(action, risk, reason);
          overlayShown = true;
        } catch {
          showRiskConfirmNotification(action, risk);
        }
      }

      const choice = await choicePromise;

      // Restore the compact running overlay after either decision or timeout.
      // Cleanup is best-effort and never changes the foreground app.
      if (overlayShown) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const ctrl = require('react-native-accessibility-controller') as {
            cancelRiskConfirmOverlay?: () => Promise<void>;
          };
          await ctrl.cancelRiskConfirmOverlay?.().catch(() => {});
        } catch {
          // Module not linked (simulator / tests).
        }
      }
      cancelRiskConfirmNotification();

      if (choice === 'execute') {
        if (useDecisionCache) rememberConfirmDecision(cacheKey, 'execute');
        return {
          ok: true,
          confirmed: true,
          denied: false,
          message: '用户已确认，可以执行该操作',
        };
      }
      // Legacy confirm_action stops immediately. Unified pre-dispatch gating
      // returns a denial tool result so the loop can explain or safely choose
      // a path that does not depend on the rejected action.
      if (args._continueOnDeny !== true) stopAgent();
      if (useDecisionCache) rememberConfirmDecision(cacheKey, 'deny');
      return {
        ok: false,
        confirmed: false,
        denied: true,
        message: '用户拒绝了该操作，任务已暂停',
      };
    },
  };
}

/** Host gate used by the unified pre-dispatch risk interceptor. */
async function requestToolRiskDecision(
  request: ToolRiskGateRequest,
): Promise<'execute' | 'deny'> {
  const result = await buildConfirmTool().handler({
    action: request.summary,
    risk: request.risk,
    reason: request.reason,
    _fingerprint: request.fingerprint,
    _continueOnDeny: true,
    // Authorization belongs to this single dispatch. A later identical call
    // is a new external effect and must pass through the gate again.
    _skipCache: true,
  }) as { confirmed?: boolean };
  return result.confirmed === true ? 'execute' : 'deny';
}

/**
 * Clarification gate modelled after Claude Code's ask-user interaction: ask
 * only for information required to continue, block, then return the answer as
 * the tool result so it remains in the same agent conversation.
 */
export const ASK_USER_TOOL = {
  name: 'ask_user',
  description: ASK_USER_DEFAULT_DESCRIPTION,
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: '需要用户回答的单个、具体问题',
      },
      placeholder: {
        type: 'string',
        description: '可选的输入提示示例，不要暗示用户必须采用某个答案',
      },
    },
    required: ['question'],
  },
};

export function buildAskUserTool(): {
  tool: unknown;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
} {
  return {
    tool: ASK_USER_TOOL,
    handler: async (args: Record<string, unknown>) => {
      const question = typeof args.question === 'string' ? args.question.trim() : '';
      if (!question) {
        return { ok: false, error: 'question 不能为空' };
      }
      const placeholder = typeof args.placeholder === 'string' && args.placeholder.trim()
        ? args.placeholder.trim()
        : undefined;

      // Snapshot the external target before opening either input surface.
      // Overlay input leaves that app in place; the package is only needed by
      // the host-editor fallback.
      const hostWasForegroundAtAsk = AppState.currentState === 'active';
      let gateTargetPackage = '';
      if (!hostWasForegroundAtAsk) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const ctrl = require('react-native-accessibility-controller') as {
            getCurrentForegroundApp?: () => Promise<{ packageName: string; className: string }>;
          };
          const current = await ctrl.getCurrentForegroundApp?.().catch(() => null);
          gateTargetPackage = current?.packageName ?? '';
        } catch {
          // Module not linked in tests/simulator; host UI remains the fallback.
        }
      }

      const resultPromise = requestUserClarification({ question, placeholder });
      let overlayInputUsed = false;
      const bringHostFallback = () => {
        overlayInputUsed = false;
        dismissOverlayTextInput();
        markAutomatedHostForeground();
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const ctrl = require('react-native-accessibility-controller') as {
            bringHostAppToForeground?: () => Promise<boolean>;
          };
          ctrl.bringHostAppToForeground?.().catch(() => {});
        } catch {
          // The inline card still works when the host is already visible.
        }
      };
      if (!hostWasForegroundAtAsk) {
        overlayInputUsed = await showOverlayTextInput({
          kind: 'ask_user',
          prompt: question,
          placeholder,
          maxLength: CLARIFICATION_MAX_LENGTH,
          fallbackLabel: '转到豆泡',
          onSubmit: (text) => {
            dismissOverlayTextInput();
            const submitted = submitUserClarification(text);
            if (submitted.ok) addMessage('user', 'text', text.trim());
          },
          onFallback: bringHostFallback,
        });
        if (!overlayInputUsed) bringHostFallback();
      }
      speakUserGate(`需要你补充信息。${question}`);
      const result = await resultPromise;
      if (overlayInputUsed) dismissOverlayTextInput();
      if (!result.answered) {
        return {
          ok: false,
          cancelled: true,
          message: '用户澄清已取消，停止当前任务',
        };
      }

      if (!hostWasForegroundAtAsk && !overlayInputUsed) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const ctrl = require('react-native-accessibility-controller') as {
            getLastForegroundApp?: () => Promise<{ packageName: string; className: string }>;
            returnToPreviousApp?: (packageName: string) => Promise<boolean>;
          };
          let target = gateTargetPackage;
          if (!target && typeof ctrl.getLastForegroundApp === 'function') {
            const last = await ctrl.getLastForegroundApp();
            target = last?.packageName ?? '';
          }
          if (target && typeof ctrl.returnToPreviousApp === 'function') {
            await ctrl.returnToPreviousApp(target).catch(() => false);
          }
        } catch {
          // Best-effort; the answer must still resume the loop.
        }
      }

      return {
        ok: true,
        answered: true,
        answer: result.answer,
        message: '用户已补充信息，请据此继续当前任务',
      };
    },
  };
}

export const REQUEST_USER_ACTION_TOOL = {
  name: 'request_user_action',
  description: REQUEST_USER_ACTION_DEFAULT_DESCRIPTION,
  parameters: {
    type: 'object',
    properties: {
      instruction: {
        type: 'string',
        description: '用户需要在当前界面手动完成的单个、明确步骤',
      },
    },
    required: ['instruction'],
  },
};

export function buildRequestUserActionTool(): {
  tool: unknown;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
} {
  return {
    tool: REQUEST_USER_ACTION_TOOL,
    handler: async (args: Record<string, unknown>) => {
      const instruction = typeof args.instruction === 'string'
        ? args.instruction.trim()
        : '';
      if (!instruction) {
        return { ok: false, code: 'INVALID_INSTRUCTION', error: 'instruction 不能为空' };
      }
      if (AppState.currentState === 'active') {
        return {
          ok: false,
          code: 'FLOATING_OVERLAY_UNAVAILABLE',
          error: '豆泡主应用在前台，无法显示用户辅助悬浮窗',
        };
      }

      const resultPromise = requestManualUserAction(instruction);
      let overlayShown = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ctrl = require('react-native-accessibility-controller') as {
          showUserActionOverlay?: (value: string) => Promise<void>;
          cancelUserActionOverlay?: () => Promise<void>;
        };
        if (!ctrl.showUserActionOverlay) throw new Error('user action overlay unavailable');
        await ctrl.showUserActionOverlay(instruction);
        overlayShown = true;
        const result = await resultPromise;
        if (!result.completed) {
          return {
            ok: false,
            cancelled: true,
            code: 'USER_ACTION_CANCELLED',
            message: '用户辅助操作已取消',
          };
        }
        return {
          ok: true,
          completed: true,
          message: '用户已确认完成该界面步骤，请重新观察当前界面后继续',
        };
      } catch (error) {
        cancelManualUserAction();
        return {
          ok: false,
          code: 'FLOATING_OVERLAY_UNAVAILABLE',
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        if (overlayShown) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const ctrl = require('react-native-accessibility-controller') as {
              cancelUserActionOverlay?: () => Promise<void>;
            };
            await ctrl.cancelUserActionOverlay?.().catch(() => {});
          } catch {
            // Optional native module.
          }
        }
      }
    },
  };
}

/** Host tools available to the main agent; per-tool settings may disable them. */
function buildAgentExtraTools(): Array<{
  tool: unknown;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  enabledByDefault?: boolean;
  placement?: 'front' | 'back';
}> {
  const tools: Array<{
    tool: unknown;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
    enabledByDefault?: boolean;
    placement?: 'front' | 'back';
  }> = [
    createWebSearchToolRegistration({
      getApiKey: () => getSettings().tavilyApiKey,
    }),
    ...(buildTodoTools() ?? []),
    buildAskUserTool(),
    buildRequestUserActionTool(),
  ];
  tools.push(...createBrowserToolRegistrations().map((registration) => ({
    ...registration,
    enabledByDefault: true,
  })));
  tools.push({
    tool: SHELL_EXECUTE_TOOL,
    enabledByDefault: true,
    placement: 'front',
    handler: createShellExecuteHandler({
      execute: async (command, timeoutMs, privilege, confirmed) => {
      const native = NativeModules.DeftAgentModule as {
        executeShell?: (
          command: string,
          timeoutMs: number,
          privilege: string,
          confirmed: boolean,
        ) => Promise<unknown>;
      } | undefined;
      if (!native?.executeShell) {
        return { ok: false, error: '当前构建未包含 Shell 原生运行时', code: 'SHELL_RUNTIME_UNAVAILABLE' };
      }
        return native.executeShell(command, timeoutMs, privilege, confirmed) as Promise<{
          ok: boolean;
          error?: string;
          code?: string;
        }>;
      },
    }),
  });
  return tools;
}

// ---------------------------------------------------------------------------
// Freeze-safe delay (native alarm-driven wait primitive)
// ---------------------------------------------------------------------------
const _deftNative = NativeModules.DeftAgentModule as
  | { waitFor?: (ms: number) => Promise<boolean> }
  | undefined;

/**
 * Freeze-safe delay backed by a native one-shot RTC_WAKEUP alarm. The alarm
 * broadcast thaws the process when MIUI/HyperOS freezes it behind another app,
 * and the promise resolve is delivered as a native message into the JS queue —
 * so the wait completes even though JS setTimeout timers are dead while
 * frozen. Falls back to setTimeout where the native module is unavailable
 * (simulator, tests). Injected into AgentLoop/TaskPlanner as delayFn.
 */
export function freezeSafeDelay(ms: number): Promise<void> {
  if (_deftNative?.waitFor) {
    return _deftNative.waitFor(ms).then(() => undefined);
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let _pendingInferenceUsage: {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
} | null = null;

/** Persist loop latency using spans for operations and events for checkpoints. */
function recordTimingDiagnostic(event: Record<string, unknown>): void {
  if (event.stage === 'inference_attempt' && typeof event.durationMs === 'number') {
    const settings = getSettings();
    const remote = _pendingInferenceUsage !== null || settings.providerMode === 'cloud';
    const model = remote ? settings.cloudModel : settings.model;
    const provider = remote
      ? settings.cloudProvider !== 'auto'
        ? settings.cloudProvider
        : settings.cloudBaseUrl.trim()
          ? 'openai_compatible'
          : settings.cloudModel.toLowerCase().startsWith('claude') ? 'anthropic' : 'openai'
      : 'doupao.local';
    recordCompletedSpan(
      'model.chat',
      event.durationMs,
      event.status === 'error' ? 'error' : 'ok',
      {
        model,
        provider,
        remote,
        attempt: event.attempt,
        round: event.round,
        step: event.step,
        vision: event.vision,
      },
      _pendingInferenceUsage ?? {},
    );
    _pendingInferenceUsage = null;
    return;
  }
  appendTaskLog('timing', event);
}

function toolSpanOutcome(result: unknown): {
  status: 'ok' | 'error';
  errorType?: string;
} {
  if (!result || typeof result !== 'object') return { status: 'ok' };
  const value = result as { ok?: unknown; success?: unknown; code?: unknown };
  const failed = value.ok === false || value.success === false;
  return {
    status: failed ? 'error' : 'ok',
    ...(failed && typeof value.code === 'string' ? { errorType: value.code } : {}),
  };
}
// OTel spans for the in-flight action node of the current request.
let _otelActionSpanId: string | null = null;
let _otelStep = 0;

// ---------------------------------------------------------------------------
// Unified user input router
// ---------------------------------------------------------------------------

const STOP_PATTERNS = ['停止', '停', '停下', '别动', '取消', 'stop', 'abort'];

function _takeUserMessages(): string[] {
  const pending = _pendingUserMessages;
  _pendingUserMessages = [];
  return pending;
}

/**
 * Unified entry for user instructions. When idle it starts a new task; while a
 * task is running, stop words trigger an emergency stop and everything else
 * becomes a normal user turn at the next decision boundary.
 */
export function handleUserTextInput(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  // The store is the user-visible lifecycle authority. Requiring both state
  // and a live handle prevents an orphaned handle from trapping later input.
  const running = getAgentState().isRunning
    && (_activeLoop !== null || _activePlanner !== null);
  if (!running) {
    void processCommand(trimmed);
    return;
  }

  const lower = trimmed.toLowerCase();
  if (STOP_PATTERNS.some((p) => lower === p || lower.startsWith(p))) {
    appendTaskLog('interrupt', { text: trimmed, kind: 'stop' });
    addMessage('agent', 'text', '已收到停止指令，正在停止当前任务…');
    stopAgent();
    return;
  }

  if (_stopped) {
    _commandsQueuedAfterStop.push(trimmed);
    appendTaskLog('interrupt', { text: trimmed, kind: 'next_task_after_stop' });
    addMessage('agent', 'text', '已收到，当前任务停止后将继续处理。');
    return;
  }

  _pendingUserMessages.push(trimmed);
  appendTaskLog('interrupt', { text: trimmed, kind: 'user_message' });
  addMessage(
    'agent',
    'text',
    '已收到，将在下一步结合当前对话继续处理。',
  );
}

// ---------------------------------------------------------------------------
// Resumable task persistence
// ---------------------------------------------------------------------------

const RESUMABLE_KEY = 'deft:resumableTask';
const RESUMABLE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface ResumableTask {
  task: string;
  steps: string[];
  startedAt: number;
}

// Tracks the active task so action handlers can append steps.
let _resumableTask: ResumableTask | null = null;

function _getAsyncStorage(): {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-async-storage/async-storage').default;
  } catch {
    return null;
  }
}

export async function loadResumableTask(): Promise<ResumableTask | null> {
  try {
    const storage = _getAsyncStorage();
    if (!storage) return null;
    const raw = await storage.getItem(RESUMABLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResumableTask;
    if (Date.now() - parsed.startedAt > RESUMABLE_TTL_MS) {
      void storage.removeItem(RESUMABLE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function clearResumableTask(): Promise<void> {
  try {
    await _getAsyncStorage()?.removeItem(RESUMABLE_KEY);
  } catch { /* ignore */ }
}

function _saveResumableTask(t: ResumableTask): void {
  try {
    void _getAsyncStorage()?.setItem(RESUMABLE_KEY, JSON.stringify(t));
  } catch { /* ignore */ }
}

function _recordStep(actionText: string): void {
  if (_resumableTask) {
    _resumableTask.steps.push(actionText);
    _saveResumableTask(_resumableTask);
  }
}

/**
 * Signal the agent to stop after its current step.
 * Also aborts the active AgentLoop or TaskPlanner immediately.
 */
export function stopAgent(): void {
  _stopped = true;
  _activeLoop?.abort();
  _activePlanner?.abort();
  try {
    (NativeModules.DeftAgentModule as { cancelShell?: () => void } | undefined)?.cancelShell?.();
  } catch { /* optional native runtime */ }
  // Release any pending completion gate so a stopped loop exits promptly
  // instead of waiting out the 60s confirmation timeout.
  if (_completionGateResolver) {
    _completionGateResolver('complete');
    _completionGateResolver = null;
  }
  // Same for a pending risk confirmation (confirm_action): reject is the
  // safe default, and the handler's stopAgent() re-entry is a no-op here.
  resolveUserConfirm('reject');
  // A clarification has no safe default answer. Cancel it so the modal closes
  // and the abort waiter can finish without injecting fabricated information.
  dismissOverlayTextInput();
  cancelUserClarification();
  cancelManualUserAction();
}

/**
 * Ask the system to exempt WatchDog from battery optimization (MIUI freezes
 * background apps otherwise, stalling the agent loop's JS timers).
 */
export function requestBatteryExemption(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ctrl = require('react-native-accessibility-controller') as {
      requestIgnoreBatteryOptimizations?: () => Promise<unknown>;
    };
    ctrl.requestIgnoreBatteryOptimizations?.().catch(() => {});
  } catch {
    // Optional — never block startup.
  }
}

async function waitForAccessibilityService(timeoutMs = 10000): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ctrl = require('react-native-accessibility-controller') as {
      isServiceEnabled?: () => Promise<boolean>;
    };
    if (!ctrl.isServiceEnabled) return true;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        if (await ctrl.isServiceEnabled()) return true;
      } catch {
        // Service reconnecting — keep waiting.
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Request MediaProjection consent so the agent can capture screenshots
 * independently of the accessibility service (MobileAgent design).
 *
 * MobileAgent model: ONE consent for the whole app session. The native side
 * keeps the first grant's projection session alive across tasks — later
 * tasks hit requestMediaProjection()'s fast path and reuse the live session
 * without any dialog. The dialog only reappears when the system revoked the
 * session (or the process restarted — Android 14 grants are single-use and
 * cannot survive that). If the user is away from the phone, the 15s consent
 * window lets the task proceed on the accessibility screenshot channel
 * instead of hanging forever.
 *
 * Best-effort: falls back to accessibility screenshots when unavailable.
 */
async function ensureMediaProjection(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ctrl = require('react-native-accessibility-controller') as {
      isMediaProjectionReady?: () => Promise<boolean>;
      requestMediaProjection?: () => Promise<unknown>;
    };
    if (!ctrl.requestMediaProjection) return;
    // eslint-disable-next-line no-console
    console.log('[MP] requesting fresh consent…');
    const consentWindow = new Promise<'timeout'>((resolve) => {
      setTimeout(resolve, 15000, 'timeout');
    });
    await Promise.race([
      ctrl.requestMediaProjection().catch((e) => {
        // eslint-disable-next-line no-console
        console.log('[MP] request error:', e);
      }),
      consentWindow,
    ]);
    try {
      const ready =
        typeof ctrl.isMediaProjectionReady === 'function'
          ? await ctrl.isMediaProjectionReady()
          : false;
      // eslint-disable-next-line no-console
      console.log(`[MP] after request ready=${ready}`);
      if (!ready) {
        addMessage(
          'agent',
          'text',
          '屏幕录制未授权：截图会受限（支付宝等页面可能拿不到），且在小米等机型上任务可能被系统冻结。请重新下发任务并在弹窗中允许，或到 设置 → 屏幕录制授权豆泡。',
        );
      }
    } catch {
      /* ignore */
    }
  } catch {
    // Optional — never block task startup.
  }
}

// Guard: when the app returns to foreground while the agent has already finished,
// ensure the foreground service notification is cleaned up if still lingering.
AppState.addEventListener('change', (nextState) => {
  if (nextState === 'active' && _stopped) {
    stopForegroundService();
  }
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function processCommand(command: string): Promise<void> {
  // Reject overlapping runs: starting a new task while one is still active
  // would clobber module-level state (heartbeat timers, active loop) and
  // leave the previous run's timers and UI state (step progress, elapsed
  // time) running after it finished.
  if (getAgentState().isRunning) {
    addMessage('agent', 'text', '当前已有任务在运行，请先等待完成或停止后再继续。');
    return;
  }
  // The UI conversation, not an individual agent run, defines continuity.
  // The current command is already visible in chat and is excluded by the
  // builder; prior user/assistant turns are carried into the new loop.
  const conversationHistory = buildConversationMessages(
    getMessages(),
    command,
    getSettings().maxConversationHistoryTurns,
  );
  _stopped = false;
  _pendingUserMessages = [];
  _pendingInferenceUsage = null;
  resetTaskInteractionKind();
  // A fresh task starts with a clean risk-gate history: a decision made in
  // task A (especially a rejection) must never short-circuit task B.
  confirmDecisionCache.clear();
  setAgentBusy(true);
  // Open a new OTel trace for this request: every node below (prepare steps,
  // per-step thinking / action / observation, finish) carries the same traceId.
  const traceId = beginTrace({ command });
  // Todo list for this request: goal + tasks persisted to
  // tasklogs/todo-<traceId>.json (adb-pullable), updated via todo_update.
  _todoList = new TodoList();
  beginTodoFile(traceId, command);
  _otelActionSpanId = null;
  _otelStep = 0;

  const a11ySpan = startSpan('prepare.a11y');
  await waitForAccessibilityService();
  endSpan(a11ySpan);

  const fgSpan = startSpan('prepare.foreground');
  // Start the foreground service BEFORE requesting MediaProjection consent —
  // HyperOS/MIUI rejects getMediaProjection() while no FGS is running.
  startForegroundService(command);
  endSpan(fgSpan);

  const projSpan = startSpan('prepare.projection');
  await ensureMediaProjection();
  // Keep the MediaProjection and its single VirtualDisplay alive across
  // tasks. Android 14+ permits only one createVirtualDisplay() call per
  // MediaProjection instance; tearing the surface down here would force a
  // fresh system consent dialog for the next task.
  endSpan(projSpan);

  const batterySpan = startSpan('prepare.battery');
  // MIUI freezes background apps' JS timers without this exemption; keep the
  // agent loop ticking while the app stays behind the overlay.
  requestBatteryExemption();
  endSpan(batterySpan);

  const hbSpan = startSpan('prepare.heartbeat');
  // Native alarm heartbeat: each broadcast delivery thaws the process when
  // MIUI freezes it (network/broadcast/alarm thaw it), letting pending JS
  // timers fire so the loop advances even while another app is on top.
  startHeartbeat();
  endSpan(hbSpan);
  agentStarted(command, getSettings().maxSteps);
  beginExecution();
  beginTaskLog(command);
  resetTaskTokens();
  // eslint-disable-next-line no-console
  console.log(
    '[HEARTBEAT] task started — if JS stops ticking in the background, the OEM is freezing the process',
  );
  _heartbeatTimers.add(
    setInterval(() => {
      // eslint-disable-next-line no-console
      console.log('[HEARTBEAT] js alive');
    }, 5000),
  );
  const startedAt = Date.now();

  _resumableTask = { task: command, steps: [], startedAt };
  _saveResumableTask(_resumableTask);

  let outcome: SessionOutcome = 'complete';
  let actions: string[] = [];
  let summary = '';

  try {
    const result = await runAgentLoop(command, conversationHistory);
    actions = result.actions;
    outcome = result.outcome;
    summary = result.summary;
  } catch (err) {
    if (_stopped || isSummaryAbortError(err)) {
      outcome = 'stopped';
      summary = '已终止。';
    } else {
      outcome = 'error';
      summary = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  } finally {
    if (_stopped) {
      stopForegroundService();
    } else {
      completeForegroundService(summary, outcome === 'complete');
    }
    stopHeartbeat();
    // Keep both the projection session and its one permitted VirtualDisplay
    // alive across tasks. They are released only when Android stops the
    // projection, capture proves it dead, or the user explicitly reauthorizes.
    // A task stopped while the risk gate was pending must not leave the
    // overlay stuck in risk-confirm mode or the fallback notification up.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ctrl = require('react-native-accessibility-controller') as {
        cancelRiskConfirmOverlay?: () => Promise<unknown>;
        cancelUserActionOverlay?: () => Promise<unknown>;
      };
      ctrl.cancelRiskConfirmOverlay?.().catch(() => {
        /* ignore */
      });
      ctrl.cancelUserActionOverlay?.().catch(() => {
        /* ignore */
      });
    } catch {
      /* ignore */
    }
    cancelRiskConfirmNotification();
    try {
      agentStopped();
    } catch {
      // A store subscriber must never abort the task teardown: the heartbeat
      // cleanup below keeps running even if a subscriber callback throws.
    }
    setAgentBusy(false);
    _resumableTask = null;
    void clearResumableTask();
    endExecution();
    // Close the request trace (root span status reflects the outcome).
    if (_otelActionSpanId) {
      endSpan(_otelActionSpanId, outcome === 'error' ? 'error' : 'ok');
      _otelActionSpanId = null;
    }
    finalizeTodoFile(outcome === 'error' ? 'error' : outcome);
    _todoList = null;
    endTrace(outcome === 'error' ? 'error' : 'ok', {
      outcome,
      actions: actions.length,
      summary: typeof summary === 'string' && summary.length > 200
        ? `${summary.slice(0, 197)}…`
        : summary,
    });
    for (const timer of _heartbeatTimers) {
      clearInterval(timer);
    }
    _heartbeatTimers.clear();
    resetTaskInteractionKind();
    // Defense in depth: concrete runners release the handles they own, and
    // this outer boundary guarantees no unexpected exception can leave the
    // input router believing a finished task is still active.
    _activeLoop = null;
    _activePlanner = null;
  }

  // A completed response is a new chronological chat event. It must not
  // reuse a task-start placeholder because the user may have added follow-up
  // messages while this run was still active.
  addMessage('agent', 'text', summary || '完成。');
  const taskTokens = getTaskTokens();
  addSession(command, actions, outcome, summary, Date.now() - startedAt, taskTokens);

  // Inputs arriving while Stop was unwinding start only after the old task's
  // final response and session record are complete, preserving chronology.
  if (_commandsQueuedAfterStop.length > 0) {
    const queued = _commandsQueuedAfterStop.splice(0);
    void processCommand(queued.join('\n'));
  }
}

function isSummaryAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { code?: unknown }).code === 'SUMMARY_ABORTED';
}


// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

interface LoopResult {
  actions: string[];
  outcome: SessionOutcome;
  summary: string;
}

async function runAgentLoop(
  command: string,
  conversationHistory: ConversationMessage[] = [],
): Promise<LoopResult> {
  const settings = getSettings();

  // Try the real AgentLoop (or TaskPlanner in plan mode) first. Runtime and
  // configuration errors must remain visible; otherwise a failed real task
  // is easily mistaken for the canned demo agent completing successfully.
  try {
    if (settings.planMode) {
      return await runRealPlannerLoop(command, settings, conversationHistory);
    }
    return await runRealAgentLoop(command, settings, conversationHistory);
  } catch (err) {
    if (isAgentCoreUnavailableError(err)) {
      return runStubAgentLoop(command, settings.maxSteps);
    }
    throw err;
  }
}

function isAgentCoreUnavailableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /(?:cannot find|requiring unknown) module/i.test(message)
    && /device-agent/i.test(message);
}

function getConfiguredContextWindowTokens(settings: ReturnType<typeof getSettings>): number {
  if (settings.providerMode === 'local') return resolveModelContextWindow(settings.model);
  return settings.cloudModelProfiles.find(
    (profile) => profile.id === settings.activeCloudModelProfileId,
  )?.contextWindowTokens ?? resolveModelContextWindow(settings.cloudModel);
}

// ---------------------------------------------------------------------------
// Real agent loop (vendored device-agent core)
// ---------------------------------------------------------------------------

async function runRealAgentLoop(
  command: string,
  settings: ReturnType<typeof getSettings>,
  conversationHistory: ConversationMessage[] = [],
): Promise<LoopResult> {
  // Lazy-require so the app compiles without the package linked.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const deviceAgent = require('../device-agent') as {
    AgentLoop: new (options: {
      provider: unknown;
      maxSteps: number;
      settleMs: number;
      useVision?: boolean;
      retryOnError?: number;
      systemPrompt?: string;
      systemPromptSuffix?: string;
      timeoutMs?: number;
      contextCompressionEnabled?: boolean;
      contextCompressionThresholdPercent?: number;
      contextCompressionProtectedRecentRounds?: number;
      contextModelId?: string;
      contextWindowTokens?: number;
      maxScreenLength?: number;
      suppressHostScreen?: boolean;
      forceVisualMode?: boolean;
      screenshotNodeMarkersEnabled?: boolean;
      screenshotDownscalingEnabled?: boolean;
      ocrEnhancementEnabled?: boolean;
      nodeTargetGestureTapEnabled?: boolean;
      toolFilter?: string[];
      toolCircuitBreakerOverrides?: Record<string, { warningThreshold: number; blockThreshold: number }>;
      consecutiveCircuitBreakerLimit?: number;
      toolConfigurationOverrides?: Record<string, { enabled?: boolean; label?: string; description?: string; uiEffect?: 'change' | 'none' | 'adaptive' }>;
      onCircuitBreakerEvent?: (event: Record<string, unknown>) => void;
      onCacheDiagnostic?: (event: Record<string, unknown>) => void;
      onTimingDiagnostic?: (event: Record<string, unknown>) => void;
      onContextCompressionStateChange?: (state: 'compressing' | 'idle') => void;
      onContextCompressed?: (summary: string) => void;
      context?: Record<string, string>;
      conversationHistory?: ConversationMessage[];
      getUserMessages?: () => string[];
      hasPendingUserMessages?: () => boolean;
      delayFn?: (ms: number) => Promise<void>;
      completionGate?: (result: string) => Promise<'complete' | { continue: string }>;
      toolRiskGate?: (request: ToolRiskGateRequest) => Promise<'execute' | 'deny'>;
      screenCapturePermissionGate?: () => Promise<'granted' | 'denied'>;
      locationPermissionGate?: () => Promise<'granted' | 'denied'>;
      onMaxStepsRaised?: (maxSteps: number) => void;
      todoList?: unknown;
      skills?: {
        catalog: Array<{ name: string; description: string }>;
        load: (name: string) => Promise<string | null>;
      };
      extraTools?: Array<{
        tool: unknown;
        handler: (args: Record<string, unknown>) => Promise<unknown>;
        enabledByDefault?: boolean;
        placement?: 'front' | 'back';
      }>;
    }) => {
      run: (task: string) => AsyncGenerator<AgentEvent>;
      abort: () => void;
    };
    CloudProvider: new (options: {
      apiKey: string;
      model: string;
      baseUrl?: string;
      apiFormat?: 'openai' | 'anthropic' | 'openrouter';
      system?: string;
      enableThinking?: boolean;
      maxTokens?: number;
      debugLog?: boolean;
      onUsage?: (promptTokens: number, completionTokens: number, cachedTokens?: number) => void;
      onCacheDiagnostic?: (event: Record<string, unknown>) => void;
      onTimingDiagnostic?: (event: Record<string, unknown>) => void;
    }) => unknown;
    GemmaProvider: new (options: {
      generateFn?: (prompt: string) => Promise<string>;
      generateWithImageFn?: (prompt: string, imagePath: string) => Promise<string>;
    }) => unknown;
    FallbackProvider: new (options: {
      onDevice: unknown;
      cloud: unknown;
      debug?: boolean;
    }) => unknown;
    CloudFirstFallbackProvider: new (options: {
      cloud: unknown;
      local: unknown;
      debug?: boolean;
    }) => unknown;
  };

  const provider = buildProvider(deviceAgent, settings);
  const runtimeContext = buildRuntimeContext(settings.contextJson);
  appendTaskLog('environment_context', runtimeContext);
  const loop = new deviceAgent.AgentLoop({
    provider,
    maxSteps: settings.maxSteps,
    settleMs: settings.settleMs,
    // Enable image handling when supported; capture still happens only when
    // the model explicitly calls the screenshot tool.
    useVision: providerSupportsVision(provider),
    retryOnError: settings.retryOnError > 0 ? settings.retryOnError : undefined,
    systemPrompt: AGENT_SYSTEM_PROMPT,
    systemPromptSuffix: settings.customInstructions || undefined,
    timeoutMs: settings.timeoutSecs > 0 ? settings.timeoutSecs * 1000 : undefined,
    contextCompressionEnabled: settings.contextCompressionEnabled,
    contextCompressionThresholdPercent: settings.contextCompressionThresholdPercent,
    contextCompressionProtectedRecentRounds: settings.contextCompressionProtectedRecentRounds,
    contextModelId: settings.providerMode === 'local' ? settings.model : settings.cloudModel,
    contextWindowTokens: getConfiguredContextWindowTokens(settings),
    maxScreenLength: settings.maxScreenLength > 0 ? settings.maxScreenLength : 0,
    suppressHostScreen: true,
    forceVisualMode: settings.forceVisualMode,
    screenshotNodeMarkersEnabled: settings.screenshotNodeMarkersEnabled,
    screenshotDownscalingEnabled: settings.screenshotDownscalingEnabled,
    ocrEnhancementEnabled: settings.ocrEnhancementEnabled,
    nodeTargetGestureTapEnabled: settings.nodeTargetGestureTapEnabled,
    toolCircuitBreakerOverrides: settings.toolCircuitBreakerOverrides,
    consecutiveCircuitBreakerLimit: settings.consecutiveCircuitBreakerLimit,
    toolConfigurationOverrides: settings.toolConfigurationOverrides,
    onCircuitBreakerEvent: (event) => appendTaskLog('circuit_breaker', event),
    onCacheDiagnostic: (event) => appendTaskLog('cache_diagnostic', event),
    onTimingDiagnostic: recordTimingDiagnostic,
    onContextCompressionStateChange: (state) => {
      updateExecutionStatus(state === 'compressing' ? '正在压缩会话' : '');
    },
    onContextCompressed: addContextCompressionSummary,
    context: runtimeContext,
    conversationHistory,
    getUserMessages: _takeUserMessages,
    hasPendingUserMessages: () => _pendingUserMessages.length > 0,
    // The model's completion verdict must be confirmed by the user; the gate
    // shows the confirmation modal (60s default 'complete' timeout inside).
    completionGate: requestCompletionDecision,
    // Every model-planned state-changing call is assessed and intercepted at
    // the tool boundary; confirmed calls resume with their original arguments.
    toolRiskGate: requestToolRiskDecision,
    screenCapturePermissionGate: requestScreenCapturePermission,
    locationPermissionGate: requestLocationPermission,
    // A rejected verdict raises the loop's step ceiling (≥10 more steps);
    // mirror the new ceiling into the agent store so the progress UI
    // (step x / max) stays in sync with the loop's effective limit.
    onMaxStepsRaised: agentMaxStepsRaised,
    // All in-loop waits (settle, stabilization polling, retry backoff) go
    // through the native alarm-driven delay so they survive OEM freezing.
    delayFn: freezeSafeDelay,
    // Todo list: goal always stays on top of every prompt; the LLM updates
    // progress via the todo_update tool, which persists to the todo file.
    todoList: _todoList ?? undefined,
    // Experience library: catalog metadata goes into the system prompt, and
    // the LLM loads bodies on demand through read_skill. The catalog is a
    // snapshot taken at loop construction — edits during the task apply to
    // the next one.
    skills: {
      catalog: getActiveSkills().map(({ name, description }) => ({ name, description })),
      load: (name) => getSkillBody(name),
    },
    extraTools: buildAgentExtraTools(),
  });
  _activeLoop = loop;
  _activePlanner = null;

  const actions: string[] = [];
  let finalSummary: string | null = null;
  let outcome: SessionOutcome = 'complete';
  let lastActionEvent: { result?: unknown } | null = null;
  let lastActionTool: string | null = null;

  const backfillLastAction = () => {
    if (lastActionEvent && lastActionEvent.result !== undefined) {
      const resultText = formatExecutionResult(lastActionEvent.result);
      updateLastStepResult(resultText, false, toJson(lastActionEvent.result));
      if (lastActionTool) {
        appendTaskLog('result', { tool: lastActionTool, result: resultText });
      }
      // Close the OTel action span with its result.
      if (_otelActionSpanId) {
        const spanOutcome = toolSpanOutcome(lastActionEvent.result);
        endSpan(_otelActionSpanId, spanOutcome.status, {
          result: lastActionEvent.result,
          ...(spanOutcome.errorType ? { errorType: spanOutcome.errorType } : {}),
        });
        _otelActionSpanId = null;
      }
      lastActionEvent = null;
    }
  };

  try {
  for await (const event of loop.run(command)) {
    if (_stopped) {
      loop.abort();
      finalSummary = '已终止。';
      outcome = 'stopped';
      break;
    }

    if (event.type === 'action') {
      // Classification is based on dispatch, not success: failed/no-op phone
      // mutations still mean this task was operating an external app.
      recordTaskToolDispatch(event.tool, event.args);
      // Step-exempt bookkeeping tools (todo_update / wait): show in the
      // execution panel without a step number, skip haptics, the OTel action
      // span, the action counter and the resume-task record.
      if (STEP_EXEMPT_TOOLS.has(event.tool)) {
        backfillLastAction();
        const loggedArgs = redactToolArgsForLogs(event.tool, event.args);
        const text = formatExemptActionText(event.tool, event.args, event.result);
        addActionStep(event.tool, text, toJson(event.args), undefined, false);
        updateLastStepResult(text, false, toJson(event.result ?? null));
        appendTaskLog('action', { tool: event.tool, args: event.args, result: text });
        _otelActionSpanId = startSpan(`tool.${event.tool}`, {
          step: _otelStep,
          tool: event.tool,
          args: loggedArgs,
        });
        lastActionEvent = event as unknown as { result?: unknown };
        lastActionTool = event.tool;
        continue;
      }
      backfillLastAction();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Vibration.vibrate(50);
      const loggedArgs = redactToolArgsForLogs(event.tool, event.args);
      const text = formatAction(event.tool, loggedArgs);
      const skillName = skillOf(event.tool, event.args);
      addActionStep(event.tool, text, toJson(loggedArgs), skillName);
      _otelStep++;
      _otelActionSpanId = startSpan(`tool.${event.tool}`, {
        step: _otelStep,
        tool: event.tool,
        args: loggedArgs,
      });
      lastActionEvent = event as unknown as { result?: unknown };
      lastActionTool = event.tool;
      appendTaskLog('action', {
        tool: event.tool,
        args: loggedArgs,
        ...(skillName ? { skill: skillName } : {}),
      });
      actions.push(text);
      agentActioned();
      _recordStep(text);
    } else if (event.type === 'observation') {
      backfillLastAction();
      const snippet = (event.screenState || '').replace(/\s+/g, ' ').slice(0, 150);
      if (snippet) {
        const resultText =
          lastActionEvent?.result !== undefined
            ? formatExecutionResult(lastActionEvent.result) + '\n' + snippet
            : snippet;
        updateLastStepResult(
          resultText,
          false,
          lastActionEvent?.result !== undefined ? toJson(lastActionEvent.result) : undefined,
        );
        if (lastActionTool) {
          appendTaskLog('result', { tool: lastActionTool, result: resultText });
        }
        lastActionEvent = null;
      }
      appendTaskLog('observation', { step: event.step, screen: snippet });
      agentStepped(event.step, event.screenState);
      updateForegroundService(event.step);
    } else if (event.type === 'visual_memory' && event.content) {
      appendTaskLog('visual_memory', {
        observationId: event.observationId,
        content: event.content,
      });
    } else if (event.type === 'thinking' && event.content) {
      backfillLastAction();
      // Keep the complete thought in the ephemeral chat message. The UI
      // collapses it to one line by default and can reveal the full text.
      appendTaskLog('thinking', { content: event.content });
      updateExecutionThinking(event.content);
    } else if (event.type === 'response') {
      backfillLastAction();
      logEvent('finish', { outcome: 'response', content: event.content });
      finalSummary = event.content;
      outcome = 'complete';
    } else if (event.type === 'completion_pending') {
      // The model claims the task is done; the completion gate (wired into
      // AgentLoop options) already surfaced the confirmation UI. Just log it.
      backfillLastAction();
      appendTaskLog('completion_pending', { result: event.result });
    } else if (event.type === 'complete') {
      backfillLastAction();
      logEvent('finish', { outcome: 'complete' });
      finalSummary = event.result;
      outcome = 'complete';
    } else if (event.type === 'failed') {
      backfillLastAction();
      logEvent('finish', { outcome: 'failed', reason: event.reason });
      finalSummary = `无法完成：${event.reason}`;
      outcome = 'error';
    } else if (event.type === 'error') {
      backfillLastAction();
      logEvent('finish', { outcome: 'error', message: event.error.message });
      finalSummary = `Error: ${event.error.message}`;
      outcome = 'error';
      break;
    } else if (event.type === 'max_steps_reached') {
      backfillLastAction();
      logEvent('finish', { outcome: 'max_steps' });
      // The effective ceiling may exceed settings.maxSteps: the user can
      // reject completion verdicts, each raising the ceiling by ≥10 steps.
      finalSummary = `步数用尽（${getAgentState().maxSteps} 步），任务未完成。`;
      outcome = 'error';
    } else if (event.type === 'timeout') {
      backfillLastAction();
      logEvent('finish', { outcome: 'timeout' });
      finalSummary = 'Timed out.';
      outcome = 'error';
    }
  }

  // An abort can end the async generator without yielding another event (for
  // example while context compression is in flight). Preserve the stop outcome
  // even though the event loop had no final boundary at which to observe it.
  if (_stopped) {
    finalSummary = '已终止。';
    outcome = 'stopped';
  }

  // Any span left open when the loop ends (e.g. stopped mid-action).
  if (_otelActionSpanId) {
    endSpan(_otelActionSpanId, outcome === 'error' ? 'error' : 'ok');
    _otelActionSpanId = null;
  }

  const summary = finalSummary ?? '完成。';
  return { actions, outcome, summary };
  } finally {
    // Release exactly the handle installed by this invocation on every exit,
    // including errors thrown while building/compressing model context.
    if (_activeLoop === loop) _activeLoop = null;
  }
}

// ---------------------------------------------------------------------------
// Real planner loop (vendored device-agent TaskPlanner)
// ---------------------------------------------------------------------------

async function runRealPlannerLoop(
  command: string,
  settings: ReturnType<typeof getSettings>,
  conversationHistory: ConversationMessage[] = [],
): Promise<LoopResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const deviceAgent = require('../device-agent') as {
    TaskPlanner: new (options: {
      provider: unknown;
      maxSteps: number;
      settleMs: number;
      useVision?: boolean;
      retryOnError?: number;
      systemPrompt?: string;
      systemPromptSuffix?: string;
      timeoutMs?: number;
      contextCompressionEnabled?: boolean;
      contextCompressionThresholdPercent?: number;
      contextCompressionProtectedRecentRounds?: number;
      contextModelId?: string;
      contextWindowTokens?: number;
      maxScreenLength?: number;
      suppressHostScreen?: boolean;
      forceVisualMode?: boolean;
      screenshotNodeMarkersEnabled?: boolean;
      screenshotDownscalingEnabled?: boolean;
      ocrEnhancementEnabled?: boolean;
      nodeTargetGestureTapEnabled?: boolean;
      maxSubTasks?: number;
      toolFilter?: string[];
      toolCircuitBreakerOverrides?: Record<string, { warningThreshold: number; blockThreshold: number }>;
      consecutiveCircuitBreakerLimit?: number;
      toolConfigurationOverrides?: Record<string, { enabled?: boolean; label?: string; description?: string; uiEffect?: 'change' | 'none' | 'adaptive' }>;
      onCircuitBreakerEvent?: (event: Record<string, unknown>) => void;
      onCacheDiagnostic?: (event: Record<string, unknown>) => void;
      onTimingDiagnostic?: (event: Record<string, unknown>) => void;
      onContextCompressionStateChange?: (state: 'compressing' | 'idle') => void;
      onContextCompressed?: (summary: string) => void;
      context?: Record<string, string>;
      conversationHistory?: ConversationMessage[];
      getUserMessages?: () => string[];
      hasPendingUserMessages?: () => boolean;
      delayFn?: (ms: number) => Promise<void>;
      toolRiskGate?: (request: ToolRiskGateRequest) => Promise<'execute' | 'deny'>;
      screenCapturePermissionGate?: () => Promise<'granted' | 'denied'>;
      locationPermissionGate?: () => Promise<'granted' | 'denied'>;
      todoList?: unknown;
      extraTools?: Array<{
        tool: unknown;
        handler: (args: Record<string, unknown>) => Promise<unknown>;
        enabledByDefault?: boolean;
        placement?: 'front' | 'back';
      }>;
    }) => {
      run: (task: string) => AsyncGenerator<PlannerEvent>;
      abort: () => void;
    };
    CloudProvider: new (options: {
      apiKey: string;
      model: string;
      baseUrl?: string;
      apiFormat?: 'openai' | 'anthropic' | 'openrouter';
      system?: string;
      enableThinking?: boolean;
      maxTokens?: number;
      debugLog?: boolean;
      onUsage?: (promptTokens: number, completionTokens: number, cachedTokens?: number) => void;
      onCacheDiagnostic?: (event: Record<string, unknown>) => void;
      onTimingDiagnostic?: (event: Record<string, unknown>) => void;
    }) => unknown;
    GemmaProvider: new (options: {
      generateFn?: (prompt: string) => Promise<string>;
      generateWithImageFn?: (prompt: string, imagePath: string) => Promise<string>;
    }) => unknown;
    FallbackProvider: new (options: {
      onDevice: unknown;
      cloud: unknown;
      debug?: boolean;
    }) => unknown;
    CloudFirstFallbackProvider: new (options: {
      cloud: unknown;
      local: unknown;
      debug?: boolean;
    }) => unknown;
  };

  const provider = buildProvider(deviceAgent, settings);
  const runtimeContext = buildRuntimeContext(settings.contextJson);
  appendTaskLog('environment_context', runtimeContext);
  const planner = new deviceAgent.TaskPlanner({
    provider,
    maxSteps: settings.maxSteps,
    settleMs: settings.settleMs,
    useVision: providerSupportsVision(provider),
    retryOnError: settings.retryOnError > 0 ? settings.retryOnError : undefined,
    systemPrompt: AGENT_SYSTEM_PROMPT,
    systemPromptSuffix: settings.customInstructions || undefined,
    timeoutMs: settings.timeoutSecs > 0 ? settings.timeoutSecs * 1000 : undefined,
    contextCompressionEnabled: settings.contextCompressionEnabled,
    contextCompressionThresholdPercent: settings.contextCompressionThresholdPercent,
    contextCompressionProtectedRecentRounds: settings.contextCompressionProtectedRecentRounds,
    contextModelId: settings.providerMode === 'local' ? settings.model : settings.cloudModel,
    contextWindowTokens: getConfiguredContextWindowTokens(settings),
    maxScreenLength: settings.maxScreenLength > 0 ? settings.maxScreenLength : 0,
    suppressHostScreen: true,
    forceVisualMode: settings.forceVisualMode,
    screenshotNodeMarkersEnabled: settings.screenshotNodeMarkersEnabled,
    screenshotDownscalingEnabled: settings.screenshotDownscalingEnabled,
    ocrEnhancementEnabled: settings.ocrEnhancementEnabled,
    nodeTargetGestureTapEnabled: settings.nodeTargetGestureTapEnabled,
    maxSubTasks: settings.maxSubTasks > 0 ? settings.maxSubTasks : undefined,
    toolCircuitBreakerOverrides: settings.toolCircuitBreakerOverrides,
    consecutiveCircuitBreakerLimit: settings.consecutiveCircuitBreakerLimit,
    toolConfigurationOverrides: settings.toolConfigurationOverrides,
    onCircuitBreakerEvent: (event) => appendTaskLog('circuit_breaker', event),
    onCacheDiagnostic: (event) => appendTaskLog('cache_diagnostic', event),
    onTimingDiagnostic: recordTimingDiagnostic,
    onContextCompressionStateChange: (state) => {
      updateExecutionStatus(state === 'compressing' ? '正在压缩会话' : '');
    },
    onContextCompressed: addContextCompressionSummary,
    context: runtimeContext,
    conversationHistory,
    getUserMessages: _takeUserMessages,
    hasPendingUserMessages: () => _pendingUserMessages.length > 0,
    // Passed through to the per-subtask AgentLoop; keeps every wait
    // freeze-safe while the task runs behind another app.
    delayFn: freezeSafeDelay,
    // The decomposition seeds the shared todo list; subtask loops can then
    // track progress via todo_update (persisted to the todo file).
    todoList: _todoList ?? undefined,
    toolRiskGate: requestToolRiskDecision,
    screenCapturePermissionGate: requestScreenCapturePermission,
    locationPermissionGate: requestLocationPermission,
    extraTools: buildAgentExtraTools(),
  });
  _activePlanner = planner;
  _activeLoop = null;

  const actions: string[] = [];
  let finalSummary: string | null = null;
  let outcome: SessionOutcome = 'complete';
  let totalSubtasks = 0;
  let lastActionEvent: { result?: unknown } | null = null;
  let lastActionTool: string | null = null;

  const backfillLastAction = () => {
    if (lastActionEvent && lastActionEvent.result !== undefined) {
      const resultText = formatExecutionResult(lastActionEvent.result);
      updateLastStepResult(resultText, false, toJson(lastActionEvent.result));
      if (lastActionTool) {
        appendTaskLog('result', { tool: lastActionTool, result: resultText });
      }
      // Close the OTel action span with its result.
      if (_otelActionSpanId) {
        const spanOutcome = toolSpanOutcome(lastActionEvent.result);
        endSpan(_otelActionSpanId, spanOutcome.status, {
          result: lastActionEvent.result,
          ...(spanOutcome.errorType ? { errorType: spanOutcome.errorType } : {}),
        });
        _otelActionSpanId = null;
      }
      lastActionEvent = null;
    }
  };

  try {
  for await (const event of planner.run(command)) {
    if (_stopped) {
      planner.abort();
      finalSummary = '已终止。';
      outcome = 'stopped';
      break;
    }

    if (event.type === 'plan') {
      totalSubtasks = event.subtasks.length;
      const planText = event.subtasks
        .map((s) => `${s.index + 1}. ${s.description}`)
        .join('\n');
      logEvent('plan', { subtasks: planText });
      // The decomposition has just seeded the shared todo list — persist it
      // now so the plan is in the todo file even before the LLM updates it.
      if (_todoList && !_todoList.isEmpty()) {
        const seeded = _todoList.getItems();
        saveTodos(seeded);
        logEvent('todo.update', { count: seeded.length, source: 'planner' });
      }
      updateExecutionThinking(`Plan:\n${planText}`);
    } else if (event.type === 'subtask_start') {
      backfillLastAction();
    } else if (event.type === 'agent_event') {
      const inner = event.event;
      if (inner.type === 'action') {
        recordTaskToolDispatch(inner.tool, inner.args);
        // Step-exempt bookkeeping tools (todo_update / wait): show in the
        // execution panel without a step number, skip haptics, the OTel
        // action span, the action counter and the resume-task record.
        if (STEP_EXEMPT_TOOLS.has(inner.tool)) {
          backfillLastAction();
          const loggedArgs = redactToolArgsForLogs(inner.tool, inner.args);
          const text = formatExemptActionText(inner.tool, inner.args, inner.result);
          addActionStep(inner.tool, text, toJson(inner.args), undefined, false);
          updateLastStepResult(text, false, toJson(inner.result ?? null));
          appendTaskLog('action', { tool: inner.tool, args: inner.args, result: text });
          _otelActionSpanId = startSpan(`tool.${inner.tool}`, {
            step: _otelStep,
            tool: inner.tool,
            args: loggedArgs,
          });
          lastActionEvent = inner as unknown as { result?: unknown };
          lastActionTool = inner.tool;
        } else {
          backfillLastAction();
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          Vibration.vibrate(50);
          const loggedArgs = redactToolArgsForLogs(inner.tool, inner.args);
          const text = formatAction(inner.tool, loggedArgs);
          const skillName = skillOf(inner.tool, inner.args);
          addActionStep(inner.tool, text, toJson(loggedArgs), skillName);
          _otelStep++;
          _otelActionSpanId = startSpan(`tool.${inner.tool}`, {
            step: _otelStep,
            tool: inner.tool,
            args: loggedArgs,
          });
          lastActionEvent = inner as unknown as { result?: unknown };
          lastActionTool = inner.tool;
          appendTaskLog('action', {
            tool: inner.tool,
            args: loggedArgs,
            ...(skillName ? { skill: skillName } : {}),
          });
          actions.push(text);
          agentActioned();
          _recordStep(text);
        }
      } else if (inner.type === 'observation') {
        backfillLastAction();
        const snippet = (inner.screenState || '').replace(/\s+/g, ' ').slice(0, 150);
        if (snippet) {
          const resultText =
            lastActionEvent?.result !== undefined
              ? formatExecutionResult(lastActionEvent.result) + '\n' + snippet
              : snippet;
          updateLastStepResult(
            resultText,
            false,
            lastActionEvent?.result !== undefined ? toJson(lastActionEvent.result) : undefined,
          );
          if (lastActionTool) {
            appendTaskLog('result', { tool: lastActionTool, result: resultText });
          }
          lastActionEvent = null;
        }
        appendTaskLog('observation', { step: inner.step, screen: snippet });
        agentStepped(inner.step, inner.screenState);
        updateForegroundService(inner.step);
      } else if (inner.type === 'visual_memory' && inner.content) {
        appendTaskLog('visual_memory', {
          observationId: inner.observationId,
          content: inner.content,
        });
      } else if (inner.type === 'thinking' && inner.content) {
        backfillLastAction();
        appendTaskLog('thinking', { content: inner.content });
        updateExecutionThinking(inner.content);
      } else if (inner.type === 'response') {
        backfillLastAction();
        logEvent('finish', { outcome: 'response', content: inner.content });
        finalSummary = inner.content;
        outcome = 'complete';
        break;
      }
    } else if (event.type === 'subtask_complete') {
      backfillLastAction();
    } else if (event.type === 'subtask_error') {
      backfillLastAction();
    } else if (event.type === 'complete') {
      backfillLastAction();
      logEvent('finish', { outcome: 'complete' });
      finalSummary = event.result;
      outcome = 'complete';
    } else if (event.type === 'error') {
      backfillLastAction();
      logEvent('finish', { outcome: 'error', message: event.error.message });
      finalSummary = `Error: ${event.error.message}`;
      outcome = 'error';
      break;
    }
  }

  if (_stopped) {
    finalSummary = '已终止。';
    outcome = 'stopped';
  }

  // Any span left open when the planner ends (e.g. stopped mid-action).
  if (_otelActionSpanId) {
    endSpan(_otelActionSpanId, outcome === 'error' ? 'error' : 'ok');
    _otelActionSpanId = null;
  }

  const summary = finalSummary ?? '完成。';
  return { actions, outcome, summary };
  } finally {
    if (_activePlanner === planner) _activePlanner = null;
  }
}

// ---------------------------------------------------------------------------
// Context variable parsing
// ---------------------------------------------------------------------------

function parseContextJson(json: string): Record<string, string> | undefined {
  if (!json.trim()) return undefined;
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') result[k] = v;
      }
      return Object.keys(result).length > 0 ? result : undefined;
    }
  } catch { /* invalid JSON — silently ignore */ }
  return undefined;
}

function buildRuntimeContext(
  contextJson: string,
): Record<string, string> {
  const configured = parseContextJson(contextJson) ?? {};
  // Host-derived facts win over similarly named custom values. They are
  // captured once when the loop is created and stay byte-stable for all
  // rounds, preserving the task-level cache prefix.
  return { ...configured, ...buildEnvironmentContext() };
}

// ---------------------------------------------------------------------------
// Provider construction
// ---------------------------------------------------------------------------

function buildProvider(
  deviceAgent: {
    CloudProvider: new (options: {
      apiKey: string;
      model: string;
      baseUrl?: string;
      apiFormat?: 'openai' | 'anthropic' | 'openrouter';
      system?: string;
      enableThinking?: boolean;
      maxTokens?: number;
      debugLog?: boolean;
      onUsage?: (promptTokens: number, completionTokens: number, cachedTokens?: number) => void;
      onCacheDiagnostic?: (event: Record<string, unknown>) => void;
      onTimingDiagnostic?: (event: Record<string, unknown>) => void;
    }) => unknown;
    GemmaProvider: new (options: {
      generateFn?: (prompt: string) => Promise<string>;
      generateWithImageFn?: (prompt: string, imagePath: string) => Promise<string>;
    }) => unknown;
    FallbackProvider: new (options: {
      onDevice: unknown;
      cloud: unknown;
      debug?: boolean;
    }) => unknown;
    CloudFirstFallbackProvider: new (options: {
      cloud: unknown;
      local: unknown;
      debug?: boolean;
    }) => unknown;
  },
  settings: ReturnType<typeof getSettings>,
): unknown {
  const generateFn = getGenerateFn();
  // Cloud-first by default: the cloud API is the primary provider and the
  // local model is the secondary fallback. 'local' mode inverts the priority.
  const useCloud = settings.providerMode === 'cloud' && !!settings.cloudApiKey;
  const cloudConfigured = !!settings.cloudApiKey;

  const buildCloudProvider = () => {
    const provider = settings.cloudProvider;
    let baseUrl: string;
    let apiFormat: 'openai' | 'anthropic' | 'openrouter';
    if (provider === 'anthropic') {
      baseUrl = 'https://api.anthropic.com/v1';
      apiFormat = 'anthropic';
    } else if (provider === 'openrouter') {
      baseUrl = 'https://openrouter.ai/api/v1';
      apiFormat = 'openrouter';
    } else if (provider === 'openai') {
      baseUrl = 'https://api.openai.com/v1';
      apiFormat = 'openai';
    } else {
      // 'auto': detect by model name
      const isAnthropic = settings.cloudModel.startsWith('claude');
      baseUrl = isAnthropic ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1';
      apiFormat = isAnthropic ? 'anthropic' : 'openai';
    }
    // Custom base URL overrides the provider default (supports any
    // OpenAI-compatible endpoint such as 智谱 / 百炼 / 火山方舟).
    const customBaseUrl = settings.cloudBaseUrl.trim().replace(/\/+$/, '');
    if (customBaseUrl) {
      baseUrl = customBaseUrl;
      if (provider === 'auto' && !settings.cloudModel.toLowerCase().startsWith('claude')) {
        apiFormat = 'openai';
      }
    }
    // Diagnostics: the endpoint decides whether prefix caching is available
    // at all, so log exactly where requests go before blaming the prompt.
    console.log(
      `[PROVIDER] baseUrl=${baseUrl} model=${settings.cloudModel} apiFormat=${apiFormat}`,
    );
    return new deviceAgent.CloudProvider({
      apiKey: settings.cloudApiKey,
      model: settings.cloudModel,
      baseUrl,
      apiFormat,
      enableThinking: settings.enableThinking,
      // Thinking mode burns tokens on reasoning before the tool-call JSON;
      // give it headroom so the final call is never cut off mid-JSON.
      maxTokens: settings.enableThinking ? 8192 : 1024,
      debugLog: settings.llmDebugLog,
      onUsage: (promptTokens, completionTokens, cachedTokens) => {
        addTokens(promptTokens, completionTokens, cachedTokens);
        _pendingInferenceUsage = {
          inputTokens: promptTokens,
          outputTokens: completionTokens,
          cachedTokens: cachedTokens ?? 0,
        };
      },
      onCacheDiagnostic: (event) => appendTaskLog('cache_diagnostic', event),
      onTimingDiagnostic: recordTimingDiagnostic,
    });
  };

  const buildGemmaProvider = () =>
    new deviceAgent.GemmaProvider({
      generateFn: generateFn!,
      generateWithImageFn: getGenerateWithImageFn() ?? undefined,
    });

  // Cloud mode is cloud-only. Loading a multi-gigabyte local model must be an
  // explicit local-mode or download action, never a side effect of a cloud
  // task or a transient cloud request failure.
  if (useCloud) {
    return buildCloudProvider();
  }

  // Local-first mode: prefer the on-device model, fall back to cloud.
  if (settings.providerMode === 'local' && generateFn && cloudConfigured) {
    return new deviceAgent.FallbackProvider({
      onDevice: buildGemmaProvider(),
      cloud: buildCloudProvider(),
    });
  }

  // Only on-device Gemma available.
  if (generateFn) {
    return buildGemmaProvider();
  }

  // Nothing available — let the caller fall through to the stub.
  throw new Error(
    'No provider configured. Download the Gemma 4 model from Settings, or enable cloud fallback.',
  );
}

// ---------------------------------------------------------------------------
// Event type shapes (minimal, matches device-agent types)
// ---------------------------------------------------------------------------

type AgentEvent =
  | { type: 'visual_memory'; observationId: string; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'response'; content: string }
  | { type: 'completion_pending'; result: string }
  | { type: 'action'; tool: string; args: Record<string, unknown>; result?: unknown }
  | { type: 'observation'; screenState: string; step: number }
  | { type: 'complete'; result: string }
  | { type: 'failed'; reason: string }
  | { type: 'error'; error: Error }
  | { type: 'max_steps_reached' }
  | { type: 'timeout' };

interface SubTask { index: number; description: string }

/**
 * Extracts the recalled skill name for read_skill actions; undefined for any
 * other tool. The execution panel and the persistent task log both use this
 * to record per-step skill recall.
 */
function skillOf(tool: string, args: unknown): string | undefined {
  if (tool !== READ_SKILL_TOOL_NAME) return undefined;
  const name = (args as { name?: unknown } | undefined)?.name;
  return typeof name === 'string' && name ? name : undefined;
}

type PlannerEvent =
  | { type: 'plan'; subtasks: SubTask[] }
  | { type: 'subtask_start'; subtask: SubTask }
  | { type: 'subtask_complete'; subtask: SubTask; result: string }
  | { type: 'subtask_error'; subtask: SubTask; error: Error }
  | { type: 'agent_event'; subtask: SubTask; event: AgentEvent }
  | { type: 'complete'; result: string }
  | { type: 'error'; error: Error };

/**
 * Human-readable text for step-exempt bookkeeping actions: todo_update shows
 * the list summary (or rejection reason), everything else uses formatAction.
 */
function formatExemptActionText(
  tool: string,
  args: Record<string, unknown>,
  result: unknown,
): string {
  if (tool === TODO_CREATE_TOOL_NAME || tool === TODO_UPDATE_TOOL_NAME) {
    const res = result as { summary?: string; error?: string } | undefined;
    const verb = tool === TODO_CREATE_TOOL_NAME ? '创建' : '更新';
    return res?.error
      ? `任务清单${verb}失败：${res.error}`
      : `任务清单已${verb}（${res?.summary ?? '无变化'}）`;
  }
  return formatAction(tool, args);
}

function formatAction(tool: string, args: Record<string, unknown>): string {
  const str = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : '');
  const num = (key: string) => (typeof args[key] === 'number' ? (args[key] as number) : 0);

  switch (tool) {
    case 'ui_tap': {
      const mode = str('mode');
      if (mode === 'ref' && str('ref')) return `点击 ref ${str('ref')}`;
      if (mode === 'semantic') {
        const target = str('text') || str('contentDescription') || str('resourceId');
        return target ? `点击“${target}”` : '语义点击';
      }
      if (mode === 'coordinate') return `点击坐标 (${num('x')}, ${num('y')})`;
      // Target-only tap calls omit mode; legacy task records may still carry it.
      if (str('ref')) return `点击 ref ${str('ref')}`;
      const semanticTarget = str('text') || str('contentDescription') || str('resourceId');
      if (semanticTarget) return `点击“${semanticTarget}”`;
      if (str('nodeId')) return `点击节点 ${str('nodeId')}`;
      return typeof args.x === 'number' && typeof args.y === 'number'
        ? `点击坐标 (${num('x')}, ${num('y')})`
        : '点击';
    }
    case 'ui_fill':
      return `填写“${str('value')}”${args.submit === true ? '并提交' : ''}`;
    case 'ui_long_press':
      if (str('mode') === 'ref' && str('ref')) return `长按 ref ${str('ref')}`;
      if (str('ref')) return `长按 ref ${str('ref')}`;
      if (str('nodeId')) return `长按节点 ${str('nodeId')}`;
      return typeof args.x === 'number' && typeof args.y === 'number'
        ? `长按坐标 (${num('x')}, ${num('y')})`
        : '长按';
    case 'ui_clear_text':
      return str('nodeId') ? `清空 ${str('nodeId')} 的文本` : '清空聚焦的输入框';
    case 'ui_press_enter':
      return str('nodeId') ? `在 ${str('nodeId')} 上按回车` : '按回车';
    case 'ui_swipe':
      return `滑动 (${num('startX')}, ${num('startY')}) → (${num('endX')}, ${num('endY')})`;
    case 'ui_scroll':
      return str('nodeId')
        ? `在 ${str('nodeId')} 中向${str('direction')}滚动${str('distance') ? `（${str('distance')}）` : ''}`
        : `向${str('direction')}滚动${str('distance') ? `（${str('distance')}）` : ''}`;
    case 'ui_scroll_page':
      return str('nodeId')
        ? `在 ${str('nodeId')} 中向${str('direction')}分页滚动`
        : `向${str('direction')}分页滚动`;
    case 'open_app':
      return `打开应用 ${str('packageName')}`;
    case 'ui_global_action':
      return `按系统键 ${str('action')}`;
    case 'wait':
      return `等待 ${args.ms !== undefined ? `${num('ms')}ms` : '1s'}`;
    case 'ui_inspect':
      return '读取界面结构';
    case 'ui_screenshot':
      return '截取手机屏幕';
    case 'list_apps':
      return '列出已安装应用';
    case 'ui_find_node':
      return `查找节点 ${formatNodeQuery(args)}`;
    case 'ui_wait_for_node':
      return `等待节点出现 ${formatNodeQuery(args)}`;
    case 'ui_wait_for_change':
      return '等待屏幕变化';
    case 'ui_get_node':
      return `读取 ${str('ref')} 的节点属性`;
    case 'ui_set_checked':
      return `${args.checked ? '勾选' : '取消勾选'} ${str('nodeId')}`;
    case 'write_note':
      return `保存笔记 "${str('key')}" = "${str('value')}"`;
    case 'read_note':
      return `读取笔记 "${str('key')}"`;
    default: {
      const argStr = Object.entries(args)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(', ');
      return argStr ? `${tool}(${argStr})` : tool;
    }
  }
}

function formatNodeQuery(args: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof args.text === 'string') parts.push(`text="${args.text}"`);
  if (typeof args.contentDescription === 'string') parts.push(`desc="${args.contentDescription}"`);
  if (typeof args.className === 'string') parts.push(`class=${args.className}`);
  if (typeof args.isChecked === 'boolean') parts.push(`checked=${args.isChecked}`);
  if (typeof args.isEnabled === 'boolean') parts.push(`enabled=${args.isEnabled}`);
  return parts.length > 0 ? `[${parts.join(', ')}]` : '[]';
}

function redactToolArgsForLogs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  if (tool !== 'browser_manage' || args.operation !== 'set_cookies') return args;
  return { ...args, cookies: '[redacted]' };
}

function formatExecutionResult(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result.slice(0, 300);
  if (
    typeof result === 'object' &&
    (result as { code?: unknown }).code === 'STALE_TARGET_REF'
  ) {
    return 'ref 已失效';
  }
  try {
    return JSON.stringify(redactToolResultForLogs(result)).slice(0, 300);
  } catch {
    return String(result).slice(0, 300);
  }
}

/** Full, untruncated JSON serialization for the process panel's raw I/O view. */
function toJson(value: unknown): string | undefined {
  if (value == null) return undefined;
  try {
    return JSON.stringify(redactToolResultForLogs(value));
  } catch {
    return String(value);
  }
}

function redactToolResultForLogs(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const result = value as {
    ok?: unknown;
    data?: Record<string, unknown>;
    observationImage?: { path?: string; mimeType?: string };
    sensitive?: boolean;
  };
  const safe: Record<string, unknown> = { ...result };
  if (result.observationImage) {
    safe.observationImage = {
      path: result.observationImage.path,
      mimeType: result.observationImage.mimeType,
      base64: '[redacted]',
    };
  }
  if (result.sensitive) {
    const data = result.data ?? {};
    safe.data = {
      action: data.action,
      tab_id: data.tab_id,
      pageURL: data.pageURL,
      count: data.count,
      written: data.written,
      sensitive: '[redacted]',
    };
  }
  return safe;
}

function providerSupportsVision(provider: unknown): boolean {
  return (
    typeof (provider as { generateWithVision?: unknown } | null)?.generateWithVision ===
    'function'
  );
}

// ---------------------------------------------------------------------------
// Stub (dev / simulator fallback)
// ---------------------------------------------------------------------------

async function runStubAgentLoop(
  command: string,
  maxSteps: number,
): Promise<LoopResult> {
  const steps = await stubAgentSteps(command);

  let stepsTaken = 0;
  const actions: string[] = [];
  let finalResponse: string | null = null;
  let outcome: SessionOutcome = 'complete';

  for (const step of steps) {
    if (_stopped) {
      finalResponse = '已终止。';
      outcome = 'stopped';
      break;
    }
    if (stepsTaken >= maxSteps) {
      finalResponse = `步数用尽（${maxSteps} 步），任务未完成。`;
      outcome = 'error';
      break;
    }
    if (step.kind === 'response') {
      finalResponse = step.text;
    } else {
      addMessage('agent', step.kind, step.text);
      if (step.kind === 'action') {
        actions.push(step.text);
        stepsTaken++;
        agentStepped(stepsTaken);
        await delay(200);
      }
    }
  }

  const summary = finalResponse ?? '完成。';
  return { actions, outcome, summary };
}

interface StubStep {
  kind: 'action' | 'screen' | 'response';
  text: string;
}

async function stubAgentSteps(command: string): Promise<StubStep[]> {
  await delay(600);
  const lower = command.toLowerCase();

  if (lower.includes('settings') || lower.includes('wi-fi') || lower.includes('wifi')) {
    return [
      { kind: 'action', text: 'Opening Settings app' },
      { kind: 'screen', text: 'Screen: Settings – Home' },
      { kind: 'action', text: 'Scrolling to Network & Internet' },
      { kind: 'action', text: 'Tapped Wi-Fi' },
      { kind: 'screen', text: 'Screen: Settings – Wi-Fi' },
      { kind: 'action', text: 'Toggled Wi-Fi switch to ON' },
      { kind: 'response', text: 'Wi-Fi is now turned on.' },
    ];
  }

  if (lower.includes('chrome') || lower.includes('search') || lower.includes('google')) {
    return [
      { kind: 'action', text: 'Opening Chrome' },
      { kind: 'screen', text: 'Screen: Chrome – New Tab' },
      { kind: 'action', text: 'Tapped address bar' },
      { kind: 'action', text: `Typed "${command}"` },
      { kind: 'action', text: 'Pressed Search' },
      { kind: 'screen', text: 'Screen: Chrome – Search Results' },
      { kind: 'response', text: `Searched for "${command}" in Chrome.` },
    ];
  }

  if (lower.includes('message') || lower.includes('whatsapp') || lower.includes('text')) {
    return [
      { kind: 'action', text: 'Opening Messages' },
      { kind: 'screen', text: 'Screen: Messages – Inbox' },
      { kind: 'action', text: 'Tapped compose button' },
      { kind: 'action', text: 'Typed the message' },
      { kind: 'action', text: 'Tapped Send' },
      { kind: 'response', text: 'Message sent.' },
    ];
  }

  return [
    { kind: 'action', text: `Processing: "${command}"` },
    { kind: 'response', text: `I received your command: "${command}". Download the Gemma 4 model or enable cloud fallback in Settings to execute tasks on your phone.` },
  ];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
