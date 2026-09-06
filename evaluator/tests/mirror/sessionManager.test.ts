import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { RtpBridgeFactory } from '../../src/mirror/rtpBridge.js';
import type { ScrcpyCaptureProvider } from '../../src/mirror/scrcpyCapture.js';
import { SharedMirrorSessionManager } from '../../src/mirror/sessionManager.js';

describe('共享镜像会话', () => {
  it('同一设备复用采集并为页面创建独立订阅', async () => {
    const captureStop = vi.fn(async () => undefined);
    const bridgeStop = vi.fn(async () => undefined);
    const captures: ScrcpyCaptureProvider = {
      start: vi.fn(async () => ({ stream: new PassThrough() as never, stop: captureStop })),
    };
    const bridges: RtpBridgeFactory = {
      start: vi.fn(async () => ({ onPacket: () => () => undefined, stop: bridgeStop })),
    };
    const manager = new SharedMirrorSessionManager(captures, bridges, 0);

    const first = await manager.create('device-1');
    const second = await manager.create('device-1');
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.subscriptionId).not.toBe(first.subscriptionId);
    expect(second.subscriberCount).toBe(2);
    expect(captures.start).toHaveBeenCalledTimes(1);

    await manager.release(first.sessionId, first.subscriptionId);
    expect(captureStop).not.toHaveBeenCalled();
    await manager.release(second.sessionId, second.subscriptionId);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(bridgeStop).toHaveBeenCalledTimes(1);
    expect(captureStop).toHaveBeenCalledTimes(1);
  });

  it('并发创建时只启动一次底层采集', async () => {
    const stream = new PassThrough();
    const captures: ScrcpyCaptureProvider = {
      start: vi.fn(async () => ({ stream: stream as never, stop: async () => undefined })),
    };
    const bridges: RtpBridgeFactory = {
      start: vi.fn(async () => ({ onPacket: () => () => undefined, stop: async () => undefined })),
    };
    const manager = new SharedMirrorSessionManager(captures, bridges, 0);
    const [first, second] = await Promise.all([manager.create('device-1'), manager.create('device-1')]);
    expect(first.sessionId).toBe(second.sessionId);
    expect(captures.start).toHaveBeenCalledTimes(1);
    await manager.close();
  });

  it('相同客户端重复请求时幂等复用订阅', async () => {
    const captures: ScrcpyCaptureProvider = {
      start: vi.fn(async () => ({ stream: new PassThrough() as never, stop: async () => undefined })),
    };
    const bridges: RtpBridgeFactory = {
      start: vi.fn(async () => ({ onPacket: () => () => undefined, stop: async () => undefined })),
    };
    const manager = new SharedMirrorSessionManager(captures, bridges, 0);
    const first = await manager.create('device-1', 'mirror-client-11111111-1111-4111-8111-111111111111');
    const second = await manager.create('device-1', 'mirror-client-11111111-1111-4111-8111-111111111111');
    expect(second.subscriptionId).toBe(first.subscriptionId);
    expect(second.subscriberCount).toBe(1);
    await manager.close();
  });
});
