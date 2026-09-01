/**
 * AgentOverlay
 *
 * A headless component (renders null) that drives the native floating
 * agent-status indicator on Android.
 *
 * Lifecycle:
 *   - Agent starts → showOverlay with "Working..." and step 0
 *   - Each action message → updateOverlay with action text + step count
 *   - Agent completes/errors → hideOverlay
 *   - User taps Stop → stopAgent() + hideOverlay
 *
 * The overlay appears on top of ALL other apps via SYSTEM_ALERT_WINDOW.
 * The host must hold that permission (granted during onboarding).
 */

import { useEffect, useRef } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';
import type { ChatMessage } from '../store/chatStore';
import { subscribe } from '../store/chatStore';
import { getExecutionState, subscribeExecution } from '../store/executionStore';
import { getAgentState, subscribeAgentState } from '../store/agentStore';
import { freezeSafeDelay, stopAgent } from '../agent/agentBridge';

// Lazy-import the a11y controller so the app doesn't crash if the native
// module isn't linked (simulator / web).
function getA11yController() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-accessibility-controller') as {
      showOverlay: (config: object) => Promise<void>;
      updateOverlay: (config: { action: string; stepCount: number }) => Promise<void>;
      hideOverlay: () => Promise<void>;
      onOverlayStop: (cb: () => void) => { remove: () => void };
      // Completion-gate mode: swaps Stop for 完成 / 未完成 / 补充信息. All
      // choices stay in the current app; supplement opens the focusable editor.
      showConfirmOverlay: (result: string) => Promise<void>;
      cancelConfirmOverlay: () => Promise<void>;
    };
  } catch {
    return null;
  }
}

export function AgentOverlay() {
  // Nothing to render on iOS — overlay is Android-only
  if (Platform.OS !== 'android') return null;

  return <AgentOverlayAndroid />;
}

function AgentOverlayAndroid() {
  const overlayVisible = useRef(false);
  const stopSubRef     = useRef<{ remove: () => void } | null>(null);
  const stopPollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef     = useRef(false);
  const sessionRef     = useRef(0);
  // True while the overlay shows the completion-confirmation state (the
  // completion gate is awaiting the user's verdict on the floating window).
  const confirmRef     = useRef(false);
  const hostForegroundRef = useRef(AppState.currentState === 'active');

  useEffect(() => {
    const ctrl = getA11yController();
    if (!ctrl) return;

    const log = (phase: string, detail: string) => {
      // eslint-disable-next-line no-console
      console.log(`[OVERLAY] ${phase} ${detail} visible=${overlayVisible.current} session=${sessionRef.current}`);
    };

    // Switches the floating overlay into confirmation mode. Called from both
    // the agentStore subscription and the showOverlay success path (the
    // overlay may appear after the pending state was set).
    const enterConfirmMode = (result: string) => {
      // The visible chat owns completion decisions while the host app is in
      // front. The overlay remains a background fallback, never a competing
      // set of buttons on top of DouPao itself.
      if (hostForegroundRef.current) return;
      confirmRef.current = true;
      log('confirm', `pending result="${result.slice(0, 24)}"`);
      // The JS bridge may not expose the confirmation surface on older
      // installed builds — degrade gracefully instead of breaking the gate.
      if (typeof ctrl.showConfirmOverlay !== 'function') return;
      ctrl.showConfirmOverlay(result).catch(() => {
        // Overlay not shown (e.g. race before showOverlay landed) — the
        // showOverlay success path retries.
        confirmRef.current = false;
      });
    };

    const leaveConfirmMode = () => {
      if (!confirmRef.current) return;
      confirmRef.current = false;
      ctrl.cancelConfirmOverlay?.().catch(() => {});
    };

    const syncCompletionSurface = () => {
      const pending = getAgentState().completionPending;
      if (!pending || hostForegroundRef.current) {
        leaveConfirmMode();
        return;
      }
      // Native keeps the same modal window mounted while it swaps the choice
      // row for a focusable editor. Do not cancel that window mid-transition.
      if (pending.phase === 'supplement') return;
      if (!confirmRef.current) enterConfirmMode(pending.result);
    };

    const hideOverlayForHost = () => {
      leaveConfirmMode();
      if (overlayVisible.current) {
        overlayVisible.current = false;
        sessionRef.current += 1;
        log('hide', 'host app foreground');
      }
      // Also clears a risk surface created directly by agentBridge, or a
      // native overlay left behind while the JS process was restarting.
      ctrl.hideOverlay().catch(() => {});
    };

    const showRunningOverlay = () => {
      if (
        hostForegroundRef.current
        || overlayVisible.current
        || !getAgentState().isRunning
      ) return;

      const execState = getExecutionState();
      const latest = execState.steps[execState.steps.length - 1];
      const action = execState.status || latest?.argsText || '工作中…';
      overlayVisible.current = true;
      sessionRef.current += 1;
      const session = sessionRef.current;
      log('show', `background action="${action}"`);
      ctrl
        .showOverlay({
          gravity: 'bottom-center',
          action,
          stepCount: getAgentState().currentStep,
        })
        .then(() => {
          // The app may have returned to the foreground while native creation
          // was in flight. Never allow that stale request to resurrect it.
          if (sessionRef.current !== session || hostForegroundRef.current) {
            ctrl.hideOverlay().catch(() => {});
            return;
          }
          syncCompletionSurface();
        })
        .catch(() => {
          if (sessionRef.current === session) overlayVisible.current = false;
        });
    };

    // AppState may already be active before the listener is attached.
    if (hostForegroundRef.current) hideOverlayForHost();

    const appStateSub = AppState.addEventListener('change', (state) => {
      hostForegroundRef.current = state === 'active';
      if (hostForegroundRef.current) {
        hideOverlayForHost();
      } else {
        showRunningOverlay();
        syncCompletionSurface();
      }
    });

    const performStop = () => {
      if (stoppedRef.current) {
        // Already stopping; native-side hides are idempotent.
        ctrl.hideOverlay().catch(() => {});
        return;
      }
      stoppedRef.current = true;
      try {
        stopAgent();
      } catch {
        // Aborting must never prevent the overlay from being hidden.
      }
      ctrl.hideOverlay().catch(() => {});
      overlayVisible.current = false;
      // Re-arm the native stop waiter for the next overlay session.
      stoppedRef.current = false;
      void armStopWaiter();
    };

    // Reliable path: native promise resolution (same channel as waitFor —
    // delivered even while the app is frozen in the background). The overlay
    // Stop tap resolves this promise from native; device events have proven
    // unreliable here.
    const armStopWaiter = async () => {
      try {
        const deft = NativeModules.DeftAgentModule as {
          waitForOverlayStop?: () => Promise<unknown>;
        } | undefined;
        if (typeof deft?.waitForOverlayStop !== 'function') return;
        await deft.waitForOverlayStop();
        performStop();
      } catch {
        // Waiter registration failed; the polling fallback below still works.
      }
    };

    // Fallback: poll the native stop counter. The heartbeat alarm chain wakes
    // the JS thread every ~3-5s while a task runs, so this fires even when the
    // app is backgrounded.
    stopPollRef.current = setInterval(async () => {
      try {
        const deft = NativeModules.DeftAgentModule as {
          takeOverlayStopRequests?: () => Promise<number>;
        } | undefined;
        const count = (await deft?.takeOverlayStopRequests?.()) ?? 0;
        if (count > 0) performStop();
      } catch {
        // Polling must never throw into the JS loop.
      }
    }, 3000);

    // Fast path: RN device event (works when the app is in the foreground).
    stopSubRef.current = ctrl.onOverlayStop(performStop);

    void armStopWaiter();

    // Subscribe to chat store and manage overlay lifecycle
    const unsub = subscribe((messages: ChatMessage[]) => {
      const hasPending = messages.some((m) => m.pending);

      if (hasPending && !overlayVisible.current) {
        showRunningOverlay();
      } else if (
        !hasPending
        && overlayVisible.current
        && !confirmRef.current
        && !getAgentState().completionPending
      ) {
        // Agent finished — briefly show the outcome on the floating window
        // before hiding it (freeze-safe delay hides it even when backgrounded).
        // Skipped while the completion gate awaits the user's verdict: the
        // confirmation surface must not be replaced by the outcome banner.
        overlayVisible.current = false;
        sessionRef.current += 1;
        const session = sessionRef.current;
        const lastAgentText = [...messages]
          .reverse()
          .find((m) => m.role === 'agent' && m.kind === 'text' && !m.pending)?.text ?? '';
        const firstLine = lastAgentText.split('\n')[0] || '已完成';
        const short = firstLine.length > 18 ? `${firstLine.slice(0, 17)}…` : firstLine;
        log('complete', `show "${short}" then hide`);
        ctrl
          .updateOverlay({ action: short, stepCount: 0 })
          .catch(() => ctrl.hideOverlay().catch(() => {}));
        void freezeSafeDelay(2500).then(() => {
          // Token guard: never remove a NEWER overlay session with a stale
          // completion timer from a previous task.
          if (sessionRef.current === session) {
            log('hide', 'completion timeout');
            ctrl.hideOverlay().catch(() => {});
          } else {
            log('hide-skip', 'stale completion timer (new session started)');
          }
        });
      }
    });

    // Real-time action text: every executed step lands in the execution
    // store (tool + human-readable args), so refresh the overlay per step.
    // stepCount mirrors the in-app status bar (agent loop step number, not
    // the tool-call count).
    const unsubExec = subscribeExecution(() => {
      const execState = getExecutionState();
      if (!overlayVisible.current || !execState.running) return;
      const latest = execState.steps[execState.steps.length - 1];
      const action = execState.status || latest?.argsText;
      if (!action) return;
      log('update', action);
      ctrl
        .updateOverlay({ action, stepCount: getAgentState().currentStep })
        .catch(() => {});
    });

    // Completion gate: when the model finishes a task it enters the pending
    // state — flip the floating overlay into confirmation mode (result summary
    // + 完成 / 未完成 / 补充信息 buttons). Native broadcasts settle the first two
    // in place; supplement switches the same overlay into text-entry mode.
    const unsubAgent = subscribeAgentState((state) => {
      if (state.isRunning && !hostForegroundRef.current && !overlayVisible.current) {
        showRunningOverlay();
      }
      if (state.completionPending) {
        syncCompletionSurface();
      } else if (confirmRef.current) {
        leaveConfirmMode();
        log('confirm', 'resolved, restore running state');
      }
      // Keep the floating step counter in lockstep with the in-app status
      // bar: both show the agent loop step number. Loops that produce no
      // tool call (fragment retry, clarification) still advance the step,
      // so refresh on agent state changes, not only on tool execution.
      if (overlayVisible.current && state.isRunning && !state.completionPending) {
        const execState = getExecutionState();
        const latest = execState.steps[execState.steps.length - 1];
        if (!latest) return;
        log('step', `sync step=${state.currentStep}`);
        ctrl
          .updateOverlay({ action: latest.argsText, stepCount: state.currentStep })
          .catch(() => {});
      }
    });

    return () => {
      unsub();
      unsubExec();
      unsubAgent();
      appStateSub.remove();
      stopSubRef.current?.remove();
      if (stopPollRef.current) {
        clearInterval(stopPollRef.current);
        stopPollRef.current = null;
      }
      if (overlayVisible.current) {
        ctrl.hideOverlay().catch(() => {});
        overlayVisible.current = false;
      }
    };
  }, []);

  // Headless — no React Native UI rendered
  return null;
}
