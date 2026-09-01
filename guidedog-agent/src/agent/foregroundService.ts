/**
 * Thin wrapper around DeftAgentModule (the Android foreground service native module).
 *
 * - startForegroundService: call when agent begins; shows the persistent notification
 *   so Android won't kill the JS thread when the app is backgrounded.
 * - updateForegroundService: call on each step to keep step count current in the notification.
 * - stopForegroundService: call when the agent finishes or is aborted; dismisses the notification.
 *
 * All methods are no-ops on iOS and when the native module isn't linked (simulator / tests).
 */

import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

interface DeftAgentModuleType {
  startService(taskDescription: string): void;
  updateNotification(taskDescription: string, stepCount: number): void;
  stopService(): void;
  completeTask(result: string, success: boolean): void;
  showCompletionNotification(result: string): void;
  cancelPendingNotification(): void;
  showRiskConfirmNotification(action: string, risk: string): void;
  cancelRiskConfirmNotification(): void;
  stopProjectionService(): void;
  startHeartbeat(): void;
  stopHeartbeat(): void;
}

const module: DeftAgentModuleType | undefined =
  Platform.OS === 'android' ? NativeModules.DeftAgentModule : undefined;

let _activeTask = '';
let _serviceRunning = false;
let _notificationPermissionRequested = false;

/**
 * Request POST_NOTIFICATIONS permission on Android 13+ (API 33).
 * Safe to call multiple times — skips if already requested this session.
 */
export function requestNotificationPermission(): void {
  if (Platform.OS !== 'android' || _notificationPermissionRequested) return;
  if ((Platform.Version as number) < 33) return;
  _notificationPermissionRequested = true;
  void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
}

export function startForegroundService(taskDescription: string): void {
  if (!module || _serviceRunning) return;
  requestNotificationPermission();
  _activeTask = taskDescription;
  _serviceRunning = true;
  module.startService(taskDescription);
}

export function updateForegroundService(stepCount: number): void {
  if (!module || !_serviceRunning) return;
  module.updateNotification(_activeTask, stepCount);
}

export function stopForegroundService(): void {
  if (!module || !_serviceRunning) return;
  _serviceRunning = false;
  _activeTask = '';
  module.stopService();
}

/**
 * Stop the projection foreground service (DeftProjectionService). Called when
 * a task finishes so the screen-recording session does not outlive the task.
 * No-op on iOS and when the native module isn't linked.
 */
export function stopProjectionService(): void {
  if (!module) return;
  try {
    module.stopProjectionService();
  } catch {
    // Optional — never block task teardown.
  }
}

/**
 * Start the keep-alive alarm heartbeat. Each native broadcast delivery thaws
 * the process when MIUI/HyperOS freezes it in the background, letting pending
 * JS timers fire so the agent loop keeps advancing.
 */
export function startHeartbeat(): void {
  if (!module) return;
  try {
    module.startHeartbeat();
  } catch {
    // Optional.
  }
}

/** Cancel the keep-alive alarm heartbeat. */
export function stopHeartbeat(): void {
  if (!module) return;
  try {
    module.stopHeartbeat();
  } catch {
    // Optional.
  }
}

/**
 * Stop the foreground service and post a dismissable result notification.
 * Only has effect on Android when the service is running; no-op otherwise.
 */
export function completeForegroundService(result: string, success: boolean): void {
  if (!module || !_serviceRunning) return;
  _serviceRunning = false;
  _activeTask = '';
  module.completeTask(result, success);
}

/**
 * Show the completion-confirmation notification (确认完成 / 未完成 buttons).
 * System-level confirmation surface: works even while the app is backgrounded
 * and the floating overlay is the primary in-app surface.
 */
export function showCompletionNotification(result: string): void {
  if (!module) return;
  try {
    module.showCompletionNotification(result);
  } catch {
    // Best-effort — the floating overlay confirmation remains the fallback.
  }
}

/**
 * Dismiss the completion-confirmation notification once the user answered
 * (or the 60s gate timeout defaulted to complete).
 */
export function cancelPendingNotification(): void {
  if (!module) return;
  try {
    module.cancelPendingNotification();
  } catch {
    // Best-effort.
  }
}

/**
 * Show the risk-confirmation notification (拒绝 / 执行 buttons). Fallback
 * surface when the floating overlay is unavailable — the system-level pair of
 * the overlay risk-confirm mode.
 */
export function showRiskConfirmNotification(action: string, risk: string): void {
  if (!module) return;
  try {
    module.showRiskConfirmNotification(action, risk);
  } catch {
    // Best-effort — the in-app modal remains the fallback.
  }
}

/**
 * Dismiss the risk-confirmation notification once the user answered
 * (or the task stopped).
 */
export function cancelRiskConfirmNotification(): void {
  if (!module) return;
  try {
    module.cancelRiskConfirmNotification();
  } catch {
    // Best-effort.
  }
}
