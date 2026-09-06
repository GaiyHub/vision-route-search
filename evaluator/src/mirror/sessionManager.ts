import { randomUUID } from 'node:crypto';
import { MediaStream, MediaStreamTrack, RTCPeerConnection, RtpPacket, useH264 } from 'werift';
import type { CreateMirrorPeerConnectionRequest, MirrorPeerConnection, MirrorSession } from './schema.js';
import type { ScrcpyCapture, ScrcpyCaptureProvider } from './scrcpyCapture.js';
import type { RtpBridge, RtpBridgeFactory } from './rtpBridge.js';

export class MirrorSessionError extends Error {
  constructor(
    readonly code: 'SESSION_NOT_FOUND' | 'SUBSCRIPTION_NOT_FOUND' | 'NEGOTIATION_FAILED' | 'CAPTURE_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'MirrorSessionError';
  }
}

export interface MirrorSessionService {
  create(deviceSerial: string, clientId?: string): Promise<MirrorSession>;
  createPeerConnection(sessionId: string, input: CreateMirrorPeerConnectionRequest): Promise<MirrorPeerConnection>;
  release(sessionId: string, subscriptionId: string): Promise<void>;
  close(): Promise<void>;
}

interface Peer {
  connection: RTCPeerConnection;
  track: MediaStreamTrack;
  ready: boolean;
}

interface ActiveSession {
  sessionId: string;
  deviceSerial: string;
  createdAt: string;
  capture: ScrcpyCapture;
  bridge: RtpBridge;
  subscriptions: Set<string>;
  clientSubscriptions: Map<string, string>;
  peers: Map<string, Peer>;
  removePacketListener: () => void;
  startupPackets: Buffer[];
  startupBytes: number;
  idleTimer?: ReturnType<typeof setTimeout>;
}

export class SharedMirrorSessionManager implements MirrorSessionService {
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly sessionsByDevice = new Map<string, string>();
  private readonly startsByDevice = new Map<string, Promise<ActiveSession>>();

  constructor(
    private readonly captures: ScrcpyCaptureProvider,
    private readonly bridges: RtpBridgeFactory,
    private readonly idleTimeoutMs = 5_000,
  ) {}

  async create(deviceSerial: string, clientId?: string): Promise<MirrorSession> {
    const session = await this.getOrStart(deviceSerial);
    if (session.idleTimer) clearTimeout(session.idleTimer);
    delete session.idleTimer;
    const existingSubscription = clientId ? session.clientSubscriptions.get(clientId) : undefined;
    const subscriptionId = existingSubscription ?? `subscription-${randomUUID()}`;
    session.subscriptions.add(subscriptionId);
    if (clientId) session.clientSubscriptions.set(clientId, subscriptionId);
    return this.snapshot(session, subscriptionId);
  }

  async createPeerConnection(sessionId: string, input: CreateMirrorPeerConnectionRequest): Promise<MirrorPeerConnection> {
    const session = this.requireSession(sessionId);
    if (!session.subscriptions.has(input.subscriptionId)) {
      throw new MirrorSessionError('SUBSCRIPTION_NOT_FOUND', '镜像订阅不存在或已释放');
    }
    const existing = session.peers.get(input.subscriptionId);
    if (existing) await existing.connection.close();

    const connection = new RTCPeerConnection({
      codecs: {
        audio: [],
        video: [useH264({
          parameters: 'profile-level-id=64001f;packetization-mode=1;level-asymmetry-allowed=1',
        })],
      },
      iceUseIpv6: false,
    });
    const track = new MediaStreamTrack({ kind: 'video' });

    try {
      await connection.setRemoteDescription(input.offer);
      connection.addTrack(track, new MediaStream([track]));
      const peer: Peer = { connection, track, ready: false };
      session.peers.set(input.subscriptionId, peer);
      connection.connectionStateChange.subscribe((state) => {
        if (state === 'connected' && !peer.ready) {
          peer.ready = true;
          for (const packet of session.startupPackets) peer.track.writeRtp(packet);
          session.startupPackets = [];
          session.startupBytes = 0;
        }
        if (state === 'failed' || state === 'closed') session.peers.delete(input.subscriptionId);
      });
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      if (connection.iceGatheringState !== 'complete') {
        await connection.iceGatheringStateChange.watch((state) => state === 'complete', 5_000);
      }
      const local = connection.localDescription;
      if (!local) throw new Error('WebRTC 未生成 Answer');
      return {
        schemaVersion: 1,
        peerConnectionId: `peer-${randomUUID()}`,
        answer: { type: 'answer', sdp: local.sdp },
      };
    } catch (error) {
      session.peers.delete(input.subscriptionId);
      await connection.close();
      throw new MirrorSessionError('NEGOTIATION_FAILED', `WebRTC 协商失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async release(sessionId: string, subscriptionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.subscriptions.delete(subscriptionId);
    for (const [clientId, mappedSubscription] of session.clientSubscriptions) {
      if (mappedSubscription === subscriptionId) session.clientSubscriptions.delete(clientId);
    }
    const peer = session.peers.get(subscriptionId);
    session.peers.delete(subscriptionId);
    if (peer) await peer.connection.close();
    if (session.subscriptions.size === 0) {
      session.idleTimer = setTimeout(() => void this.stopSession(session), this.idleTimeoutMs);
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => this.stopSession(session)));
  }

  private async getOrStart(deviceSerial: string): Promise<ActiveSession> {
    const existingId = this.sessionsByDevice.get(deviceSerial);
    const existing = existingId ? this.sessions.get(existingId) : undefined;
    if (existing) return existing;
    const pending = this.startsByDevice.get(deviceSerial);
    if (pending) return pending;
    const started = this.startSession(deviceSerial);
    this.startsByDevice.set(deviceSerial, started);
    try { return await started; }
    finally { this.startsByDevice.delete(deviceSerial); }
  }

  private async startSession(deviceSerial: string): Promise<ActiveSession> {
    let capture: ScrcpyCapture | undefined;
    try {
      capture = await this.captures.start(deviceSerial);
      const bridge = await this.bridges.start(capture.stream);
      const session: ActiveSession = {
        sessionId: `mirror-${randomUUID()}`,
        deviceSerial,
        createdAt: new Date().toISOString(),
        capture,
        bridge,
        subscriptions: new Set(),
        clientSubscriptions: new Map(),
        peers: new Map(),
        removePacketListener: () => undefined,
        startupPackets: [],
        startupBytes: 0,
      };
      session.removePacketListener = bridge.onPacket((packet) => {
        try { RtpPacket.deSerialize(packet); } catch { return; }
        const readyPeers = [...session.peers.values()].filter((peer) => peer.ready);
        if (readyPeers.length === 0 && session.startupBytes < 8 * 1024 * 1024) {
          const copy = Buffer.from(packet);
          session.startupPackets.push(copy);
          session.startupBytes += copy.length;
        }
        for (const peer of readyPeers) peer.track.writeRtp(packet);
      });
      this.sessions.set(session.sessionId, session);
      this.sessionsByDevice.set(deviceSerial, session.sessionId);
      return session;
    } catch (error) {
      if (capture) await capture.stop();
      throw new MirrorSessionError('CAPTURE_FAILED', error instanceof Error ? error.message : String(error));
    }
  }

  private requireSession(sessionId: string): ActiveSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new MirrorSessionError('SESSION_NOT_FOUND', '镜像会话不存在或已结束');
    return session;
  }

  private snapshot(session: ActiveSession, subscriptionId: string): MirrorSession {
    return {
      schemaVersion: 1,
      sessionId: session.sessionId,
      subscriptionId,
      deviceSerial: session.deviceSerial,
      state: 'STREAMING',
      transport: 'WEBRTC',
      createdAt: session.createdAt,
      subscriberCount: session.subscriptions.size,
    };
  }

  private async stopSession(session: ActiveSession): Promise<void> {
    if (!this.sessions.has(session.sessionId)) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    this.sessions.delete(session.sessionId);
    this.sessionsByDevice.delete(session.deviceSerial);
    session.removePacketListener();
    await Promise.all([...session.peers.values()].map((peer) => peer.connection.close()));
    session.peers.clear();
    await session.bridge.stop();
    await session.capture.stop();
  }
}
