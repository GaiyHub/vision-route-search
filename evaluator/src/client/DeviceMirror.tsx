import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ApiClient, MirrorDevice, MirrorPeerConnection, MirrorSession } from './types.js';

type MirrorStatus = 'CONNECTING' | 'PLAYING' | 'FALLBACK' | 'ERROR';

const statusLabel: Record<MirrorStatus, string> = {
  CONNECTING: '正在连接手机',
  PLAYING: '实时画面已连接',
  FALLBACK: '截图模式',
  ERROR: '画面暂不可用',
};

export function DeviceMirror({ api }: { api: ApiClient }) {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<MirrorDevice[]>([]);
  const [selectedSerial, setSelectedSerial] = useState('');
  const [status, setStatus] = useState<MirrorStatus>('CONNECTING');
  const [error, setError] = useState('');
  const [deviceError, setDeviceError] = useState('');
  const [frameSequence, setFrameSequence] = useState(0);
  const [fallback, setFallback] = useState(false);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [position, setPosition] = useState({ x: 240, y: 68 });
  const drag = useRef<{ offsetX: number; offsetY: number } | undefined>(undefined);
  const frameTimer = useRef<number | undefined>(undefined);
  const firstFrameTimer = useRef<number | undefined>(undefined);
  const video = useRef<HTMLVideoElement | null>(null);
  const clientId = useRef(`mirror-client-${crypto.randomUUID()}`);
  const selectedDevice = useMemo(
    () => devices.find((device) => device.serial === selectedSerial),
    [devices, selectedSerial],
  );

  const loadDevices = useCallback(async () => {
    try {
      const result = await api<{ devices: MirrorDevice[] }>('/api/android/devices');
      setDeviceError('');
      setDevices(result.devices);
      setSelectedSerial((current) => result.devices.some((device) => device.serial === current && device.canMirror)
        ? current
        : result.devices.find((device) => device.canMirror)?.serial ?? '');
    } catch (cause) {
      setDevices([]);
      setSelectedSerial('');
      setDeviceError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [api]);

  useEffect(() => {
    if (!open) return;
    setPosition((current) => current.x === 240 && current.y === 68
      ? { x: Math.max(16, window.innerWidth - 376), y: 68 }
      : current);
    void loadDevices();
    const timer = window.setInterval(() => void loadDevices(), 2_000);
    return () => window.clearInterval(timer);
  }, [loadDevices, open]);

  useEffect(() => {
    if (!open || !selectedSerial) return;
    let cancelled = false;
    let peer: RTCPeerConnection | undefined;
    let session: MirrorSession | undefined;
    setStatus('CONNECTING');
    setFallback(false);
    setMediaStream(null);
    setError('');
    const releaseRemote = async () => {
      const active = session;
      session = undefined;
      if (active) {
        await fetch(`/api/android/mirror-sessions/${encodeURIComponent(active.sessionId)}/subscriptions/${encodeURIComponent(active.subscriptionId)}`, { method: 'DELETE' }).catch(() => undefined);
      }
    };
    const fallbackToScreenshots = (message: string) => {
      peer?.close();
      peer = undefined;
      void releaseRemote();
      setFallback(true);
      setStatus('FALLBACK');
      setError(`实时视频不可用，已切换截图模式：${message}`);
      setFrameSequence(Date.now());
    };
    const connect = async () => {
      try {
        if (typeof RTCPeerConnection === 'undefined') throw new Error('当前浏览器不支持 WebRTC');
        session = await api<MirrorSession>('/api/android/mirror-sessions', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ schemaVersion: 1, deviceSerial: selectedSerial, clientId: clientId.current }),
        });
        if (cancelled) {
          await api<void>(`/api/android/mirror-sessions/${encodeURIComponent(session.sessionId)}/subscriptions/${encodeURIComponent(session.subscriptionId)}`, { method: 'DELETE' }).catch(() => undefined);
          return;
        }
        peer = new RTCPeerConnection();
        peer.addTransceiver('video', { direction: 'recvonly' });
        peer.ontrack = (event) => {
          const remoteStream = event.streams[0]?.getVideoTracks().length ? event.streams[0] : new MediaStream([event.track]);
          setMediaStream(remoteStream);
        };
        peer.onconnectionstatechange = () => {
          if (peer?.connectionState === 'failed' || peer?.connectionState === 'disconnected') {
            fallbackToScreenshots('实时流已断开');
          }
        };
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await waitForIceGathering(peer);
        if (!peer.localDescription) throw new Error('浏览器未生成 WebRTC Offer');
        const result = await api<MirrorPeerConnection>(`/api/android/mirror-sessions/${encodeURIComponent(session.sessionId)}/peer-connections`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            schemaVersion: 1,
            subscriptionId: session.subscriptionId,
            offer: { type: 'offer', sdp: peer.localDescription.sdp },
          }),
        });
        if (cancelled) { await releaseRemote(); return; }
        firstFrameTimer.current = window.setTimeout(() => fallbackToScreenshots('等待首帧超时'), 8_000);
        await peer.setRemoteDescription(result.answer);
      } catch (cause) {
        if (cancelled) return;
        fallbackToScreenshots(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void connect();
    return () => {
      cancelled = true;
      setMediaStream(null);
      peer?.close();
      void releaseRemote();
      if (frameTimer.current !== undefined) window.clearTimeout(frameTimer.current);
      if (firstFrameTimer.current !== undefined) window.clearTimeout(firstFrameTimer.current);
      frameTimer.current = undefined;
      firstFrameTimer.current = undefined;
    };
  }, [api, open, selectedSerial]);

  useEffect(() => {
    if (!video.current || !mediaStream) return;
    video.current.srcObject = mediaStream;
    void video.current.play().catch(() => undefined);
    return () => { if (video.current) video.current.srcObject = null; };
  }, [mediaStream]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!drag.current) return;
      const width = Math.min(344, window.innerWidth - 24);
      const x = Math.min(Math.max(12, event.clientX - drag.current.offsetX), Math.max(12, window.innerWidth - width - 12));
      const y = Math.min(Math.max(12, event.clientY - drag.current.offsetY), Math.max(12, window.innerHeight - 120));
      setPosition({ x, y });
    };
    const stop = () => { drag.current = undefined; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, select')) return;
    drag.current = { offsetX: event.clientX - position.x, offsetY: event.clientY - position.y };
    event.preventDefault();
  };

  const scheduleNextFrame = (delayMs: number) => {
    if (frameTimer.current !== undefined) window.clearTimeout(frameTimer.current);
    frameTimer.current = window.setTimeout(() => setFrameSequence(Date.now()), delayMs);
  };

  return <>
    <button className={`mirror-launch ${open ? 'active' : ''}`} aria-label="查看手机实时画面" data-tooltip="查看手机实时画面" onClick={() => setOpen((current) => !current)}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2"/><path d="M10 5h4M11 18.5h2"/></svg>
    </button>
    {open && <aside className="mirror-window" role="dialog" aria-label="手机实时画面" style={{ left: position.x, top: position.y }}>
      <div className="mirror-window-head" onPointerDown={startDrag}>
        <div><span className={`mirror-status ${status}`}/><strong>手机实时画面</strong></div>
        <button aria-label="关闭真机画面" onClick={() => setOpen(false)}>×</button>
      </div>
      <div className="mirror-device-bar">
        <select aria-label="镜像设备" value={selectedSerial} onChange={(event) => setSelectedSerial(event.target.value)}>
          {devices.length === 0 && <option value="">未发现设备</option>}
          {devices.map((device) => <option key={device.serial} value={device.serial} disabled={!device.canMirror}>{device.model} · {device.serial}{device.canMirror ? '' : ` · ${device.state}`}</option>)}
        </select>
        <button onClick={() => void loadDevices()} aria-label="刷新设备">↻</button>
      </div>
      <div className="mirror-viewport">
        {selectedSerial && !fallback ? <video ref={video} autoPlay muted playsInline onPlaying={() => { if (firstFrameTimer.current !== undefined) window.clearTimeout(firstFrameTimer.current); setStatus('PLAYING'); }} aria-label={`${selectedDevice?.model ?? '安卓设备'}实时画面`}/> : selectedSerial ? <img
          src={`/api/android/devices/${encodeURIComponent(selectedSerial)}/frame?t=${frameSequence}`}
          alt={`${selectedDevice?.model ?? '安卓设备'}实时画面`}
          onLoad={() => { setStatus('FALLBACK'); scheduleNextFrame(120); }}
          onError={() => { setStatus('ERROR'); setError('无法获取设备画面，请检查连接后重试'); scheduleNextFrame(1_000); }}
        /> : <div className="mirror-empty"><span>▣</span><strong>{devices.length ? '没有可镜像设备' : '未发现安卓设备'}</strong><p>{devices.length ? devices[0]?.reason : '请通过 USB 或无线 ADB 连接并授权设备'}</p></div>}
      </div>
      <div className="mirror-window-foot"><span>{selectedDevice ? `${selectedDevice.model} · Android ${selectedDevice.androidVersion}` : 'ADB 设备镜像'}</span><em className={status}>{selectedSerial ? statusLabel[status] : deviceError || '等待设备'}</em></div>
      {error && selectedSerial && <p className="mirror-error">{error}</p>}
    </aside>}
  </>;
}

async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      peer.removeEventListener('icegatheringstatechange', changed);
      reject(new Error('ICE 候选收集超时'));
    }, 5_000);
    const changed = () => {
      if (peer.iceGatheringState !== 'complete') return;
      window.clearTimeout(timeout);
      peer.removeEventListener('icegatheringstatechange', changed);
      resolve();
    };
    peer.addEventListener('icegatheringstatechange', changed);
  });
}
