import { describe, expect, it } from 'vitest';
import {
  createMirrorPeerConnectionRequestSchema,
  createMirrorSessionRequestSchema,
  mirrorSessionSchema,
} from '../../src/mirror/schema.js';

describe('镜像接口契约', () => {
  it('严格校验设备和 WebRTC Offer', () => {
    expect(createMirrorSessionRequestSchema.parse({ schemaVersion: 1, deviceSerial: 'emulator-5554' })).toMatchObject({ deviceSerial: 'emulator-5554' });
    expect(() => createMirrorSessionRequestSchema.parse({ schemaVersion: 1, deviceSerial: 'serial;rm' })).toThrow();
    expect(createMirrorPeerConnectionRequestSchema.parse({
      schemaVersion: 1,
      subscriptionId: 'subscription-11111111-1111-4111-8111-111111111111',
      offer: { type: 'offer', sdp: 'v=0\r\n' },
    })).toMatchObject({ offer: { type: 'offer' } });
  });

  it('输出版本化 Session 状态', () => {
    expect(mirrorSessionSchema.parse({
      schemaVersion: 1,
      sessionId: 'mirror-11111111-1111-4111-8111-111111111111',
      subscriptionId: 'subscription-22222222-2222-4222-8222-222222222222',
      deviceSerial: 'serial-1',
      state: 'STREAMING',
      transport: 'WEBRTC',
      createdAt: '2026-09-04T00:00:00.000Z',
      subscriberCount: 1,
    })).toMatchObject({ state: 'STREAMING', transport: 'WEBRTC' });
  });
});
