import type { ScreenshotImage } from '../types';
import {
  getController,
  readAccessibilitySnapshotWithoutOverlay,
  readAccessibilityTreeWithoutOverlay,
} from './AgentToolkit';
import { ScreenSerializer } from './ScreenSerializer';

/**
 * Phone UI perception adapter used by the explicit inspect_ui and screenshot
 * tools. AgentLoop only receives their normal tool results; it does not poll
 * or inject phone state at decision boundaries.
 */
export class PhoneObservation {
  constructor(private readonly options: {
    suppressHostScreen: boolean;
    delay: (ms: number) => Promise<void>;
  }) {}

  async inspectUi(): Promise<string> {
    const ctrl = getController();
    if (await this.shouldSuppressHostScreen()) {
      return '=== 屏幕元素 === (豆泡宿主界面已忽略)';
    }
    try {
      if (typeof ctrl.getAccessibilitySnapshot === 'function') {
        const snapshot = await readAccessibilitySnapshotWithoutOverlay();
        const serialized = ScreenSerializer.serialize(snapshot.nodes);
        if (!snapshot.truncated) return serialized;
        return `${serialized}\n=== 采集状态 === 部分结果 reason=${snapshot.reason ?? 'unknown'} ` +
          `visited=${snapshot.visitedNodes} returned=${snapshot.returnedNodes} ` +
          `durationMs=${Math.round(snapshot.durationMs)}`;
      }

      const tree = await readAccessibilityTreeWithoutOverlay();
      return ScreenSerializer.serialize(tree);
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
      if (code === 'TREE_CAPTURE_BUSY') {
        return '=== 屏幕元素 === (已有采集正在进行，本次未重复排队)';
      }
      const message = error instanceof Error ? error.message : String(error);
      return `=== 屏幕元素 === (读取失败：${message})`;
    }
  }

  async cancelInspectUi(): Promise<boolean> {
    const ctrl = getController();
    if (typeof ctrl.cancelAccessibilityCapture !== 'function') return false;
    try {
      return await ctrl.cancelAccessibilityCapture();
    } catch {
      return false;
    }
  }

  async screenshot(): Promise<ScreenshotImage | undefined> {
    const ctrl = getController();
    if (await this.shouldSuppressHostScreen()) {
      // eslint-disable-next-line no-console
      console.log('[SHOT] skipped: host app foreground');
      throw Object.assign(
        new Error('豆泡主 App 当前在前台，已主动跳过宿主界面截图'),
        { code: 'HOST_APP_FOREGROUND' },
      );
    }

    const failures: string[] = [];
    if (typeof ctrl.takeScreenshot === 'function') {
      try {
        const raw = await this.withTimeout(ctrl.takeScreenshot(), 6000, null);
        if (raw) {
          // eslint-disable-next-line no-console
          console.log('[SHOT] source=accessibility ok');
          return raw;
        }
        failures.push('accessibility: 截屏失败或超时（6 秒）');
      } catch (error) {
        failures.push(`accessibility: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      failures.push('accessibility: 通道不可用');
    }

    // Prefer the active liveness probe: MIUI may retain a non-null projection
    // handle after Android has revoked the actual capture session.
    const projectionReady = typeof ctrl.probeProjectionReady === 'function'
      ? await this.withTimeout(ctrl.probeProjectionReady(), 1500, false)
      : typeof ctrl.isMediaProjectionReady === 'function' &&
        (await this.withTimeout(ctrl.isMediaProjectionReady(), 1000, false));
    if (projectionReady) {
      try {
        const raw = await this.withTimeout(ctrl.captureWithMediaProjection(), 4000, null);
        if (raw) {
          // eslint-disable-next-line no-console
          console.log('[SHOT] source=mediaProjection ok');
          return raw;
        }
        failures.push('mediaProjection: 无帧或超时（4 秒）');
      } catch (error) {
        failures.push(`mediaProjection: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      failures.push('mediaProjection: 未就绪');
    }

    // Permission UI belongs to the host execution boundary. Do not request it
    // here: an AgentLoop timeout does not cancel a native Promise, so an
    // in-tool reauthorization could otherwise switch apps after the tool had
    // already reported failure.
    // eslint-disable-next-line no-console
    console.log(`[SHOT] permission required: ${failures.join(' | ')}`);
    throw Object.assign(
      new Error('屏幕截图通道不可用，需要重新授予屏幕录制权限'),
      {
        code: 'SCREEN_CAPTURE_PERMISSION_REQUIRED',
        details: { failures },
      },
    );
  }

  private async shouldSuppressHostScreen(): Promise<boolean> {
    if (!this.options.suppressHostScreen) return false;
    const ctrl = getController();
    if (typeof ctrl.getCurrentForegroundApp !== 'function') return false;
    try {
      const foreground = await this.withTimeout(ctrl.getCurrentForegroundApp(), 500, null);
      return foreground !== null && !foreground.packageName;
    } catch {
      return false;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return await Promise.race([
      promise,
      this.options.delay(ms).then(() => fallback),
    ]);
  }
}
