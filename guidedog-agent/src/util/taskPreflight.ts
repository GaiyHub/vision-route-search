/**
 * Task preflight: check every permission required before starting an agent
 * task. Any unauthorized item blocks task start; each item can jump to the
 * relevant system settings page (or request the media-projection consent).
 */

import { PermissionsAndroid, Platform } from 'react-native';

export type PreflightId =
  | 'accessibility'
  | 'screenCapture'
  | 'overlay'
  | 'notification'
  | 'battery';

export interface PreflightItem {
  id: PreflightId;
  label: string;
  description: string;
  granted: boolean;
  check: () => Promise<boolean>;
  fix: () => Promise<void>;
}

function getController(): {
  isServiceEnabled?: () => Promise<boolean>;
  isMediaProjectionReady?: () => Promise<boolean>;
  probeProjectionReady?: () => Promise<boolean>;
  requestMediaProjection?: () => Promise<unknown>;
  releaseMediaProjection?: () => Promise<void>;
  invalidateMediaProjection?: () => Promise<void>;
  canDrawOverlays?: () => Promise<boolean>;
  isIgnoringBatteryOptimizations?: () => Promise<boolean>;
  openSettingsPage?: (type: string) => Promise<unknown>;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-accessibility-controller');
  } catch {
    return null;
  }
}

async function probeScreenCapture(): Promise<boolean> {
  const controller = getController();
  if (!controller) return false;

  // A non-null MediaProjection handle is not sufficient on MIUI/HyperOS:
  // the system can revoke it without delivering onStop. Prefer the native
  // liveness probe and retain the passive check only for older module builds.
  if (controller.probeProjectionReady) {
    return controller.probeProjectionReady();
  }
  return (await controller.isMediaProjectionReady?.()) ?? false;
}

async function checkFreshScreenCaptureHandle(): Promise<boolean> {
  return (await getController()?.isMediaProjectionReady?.()) ?? false;
}

async function requestAndVerifyScreenCapture(): Promise<void> {
  const controller = getController();
  if (!controller?.requestMediaProjection) {
    throw new Error('屏幕录制模块不可用');
  }

  if (await probeScreenCapture()) return;

  // Drop a stale native handle before requesting consent. Otherwise the
  // request method's reuse fast-path can return true without showing Android's
  // MediaProjection consent dialog.
  if (controller.invalidateMediaProjection) {
    await controller.invalidateMediaProjection();
  } else {
    await controller.releaseMediaProjection?.().catch(() => undefined);
  }
  const granted = await controller.requestMediaProjection();
  if (granted === false) {
    throw new Error('用户未授予屏幕录制权限');
  }

  // requestMediaProjection resolves only after the foreground service has
  // delivered a new native handle. Do not immediately run the active probe:
  // it rebuilds the capture surface and races with native first-frame priming,
  // producing a false negative on slower devices. Normal preflight checks and
  // the screenshot path still perform active liveness validation afterwards.
  const ready = controller.isMediaProjectionReady
    ? await controller.isMediaProjectionReady()
    : granted !== false;
  if (!ready) {
    await controller.releaseMediaProjection?.().catch(() => undefined);
    throw new Error('屏幕录制授权未生效');
  }
}

export const PREFLIGHT_ITEMS: PreflightItem[] = [
  {
    id: 'accessibility',
    label: '无障碍服务',
    description: '豆泡需要无障碍服务来读取屏幕并执行点击、输入等操作',
    granted: false,
    check: async () => (await getController()?.isServiceEnabled?.()) ?? false,
    fix: async () => {
      await getController()?.openSettingsPage?.('accessibility');
    },
  },
  {
    id: 'screenCapture',
    label: '屏幕录制授权',
    description: '用于截屏感知界面（MediaProjection），不依赖无障碍服务',
    granted: false,
    check: probeScreenCapture,
    fix: requestAndVerifyScreenCapture,
  },
  {
    id: 'overlay',
    label: '悬浮窗权限',
    description: '用于执行时显示悬浮状态球与停止按钮',
    granted: false,
    check: async () => (await getController()?.canDrawOverlays?.()) ?? false,
    fix: async () => {
      await getController()?.openSettingsPage?.('overlay');
    },
  },
  {
    id: 'notification',
    label: '通知权限',
    description: '前台服务需要常驻通知，避免任务被系统回收',
    granted: false,
    check: async () => {
      if (Platform.OS !== 'android' || (Platform.Version as number) < 33) return true;
      return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    },
    fix: async () => {
      await getController()?.openSettingsPage?.('notification');
    },
  },
  {
    id: 'battery',
    label: '电池优化豁免',
    description: 'MIUI 等系统会冻结后台进程，豁免后任务才能在后台持续运行',
    granted: false,
    check: async () => (await getController()?.isIgnoringBatteryOptimizations?.()) ?? false,
    fix: async () => {
      await getController()?.openSettingsPage?.('battery');
    },
  },
];

export interface RunPreflightOptions {
  /** Avoid racing native first-frame priming immediately after fresh consent. */
  screenCaptureCheck?: 'active' | 'freshHandle';
}

/** Re-evaluate every item and return fresh granted states. */
export async function runPreflight(
  options: RunPreflightOptions = {},
): Promise<PreflightItem[]> {
  return Promise.all(
    PREFLIGHT_ITEMS.map(async (item) => ({
      ...item,
      granted: await (
        item.id === 'screenCapture' && options.screenCaptureCheck === 'freshHandle'
          ? checkFreshScreenCaptureHandle()
          : item.check()
      ).catch(() => false),
    })),
  );
}
