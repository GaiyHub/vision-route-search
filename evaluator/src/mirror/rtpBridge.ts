import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

export interface RtpBridge {
  onPacket(listener: (packet: Buffer) => void): () => void;
  stop(): Promise<void>;
}

export interface RtpBridgeFactory {
  start(input: Readable): Promise<RtpBridge>;
}

export class FfmpegRtpBridgeFactory implements RtpBridgeFactory {
  constructor(private readonly ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg') {}

  async start(input: Readable): Promise<RtpBridge> {
    const socket = await bindUdp();
    const address = socket.address();
    if (typeof address === 'string') throw new Error('无法分配 RTP 端口');
    const process = spawn(this.ffmpegPath, buildFfmpegRtpArgs(address.port), { stdio: ['pipe', 'ignore', 'pipe'] });
    let diagnostics = '';
    process.stderr.on('data', (chunk: Buffer) => { diagnostics = `${diagnostics}${chunk.toString()}`.slice(-4_000); });
    input.pipe(process.stdin);
    const listeners = new Set<(packet: Buffer) => void>();
    const pendingPackets: Buffer[] = [];
    let pendingBytes = 0;
    socket.on('message', (packet) => {
      if (listeners.size === 0 && pendingBytes < 8 * 1024 * 1024) {
        const copy = Buffer.from(packet);
        pendingPackets.push(copy);
        pendingBytes += copy.length;
      }
      listeners.forEach((listener) => listener(packet));
    });

    await Promise.race([
      new Promise<void>((resolve) => socket.once('listening', resolve)),
      new Promise<never>((_resolve, reject) => process.once('error', reject)),
      new Promise<never>((_resolve, reject) => process.once('close', (code) => reject(new Error(`ffmpeg 提前退出（${code}）：${diagnostics}`)))),
      new Promise<void>((resolve) => setTimeout(resolve, 100)),
    ]);

    return {
      onPacket(listener) {
        listeners.add(listener);
        for (const packet of pendingPackets) listener(packet);
        pendingPackets.length = 0;
        pendingBytes = 0;
        return () => listeners.delete(listener);
      },
      stop: async () => {
        input.unpipe(process.stdin);
        process.stdin.destroy();
        socket.close();
        await stopProcess(process);
      },
    };
  }
}

export function buildFfmpegRtpArgs(port: number): string[] {
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-fflags', '+genpts', '-use_wallclock_as_timestamps', '1', '-analyzeduration', '0', '-probesize', '32',
    '-framerate', '30', '-f', 'h264', '-i', 'pipe:0', '-an', '-c:v', 'copy',
    '-bsf:v', 'dump_extra=freq=keyframe',
    '-f', 'rtp', '-payload_type', '96', '-ssrc', '11223344',
    `rtp://127.0.0.1:${port}?pkt_size=1200`,
  ];
}

function bindUdp(): Promise<UdpSocket> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', () => {
      socket.removeListener('error', reject);
      resolve(socket);
    });
  });
}

async function stopProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => process.once('close', () => resolve())),
    new Promise<void>((resolve) => setTimeout(() => { process.kill('SIGKILL'); resolve(); }, 1_000)),
  ]);
}
