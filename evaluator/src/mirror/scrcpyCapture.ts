import { access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer, Socket } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { PassThrough, type Readable } from 'node:stream';

const REMOTE_SERVER_PREFIX = '/data/local/tmp/doupao-scrcpy-';
const SOCKET_PREFIX = 'scrcpy_6d';

export interface ScrcpyCapture {
  stream: Readable;
  stop(): Promise<void>;
}

export interface ScrcpyCaptureProvider {
  start(deviceSerial: string): Promise<ScrcpyCapture>;
}

export class ScrcpyCaptureError extends Error {
  constructor(readonly code: 'RUNTIME_NOT_FOUND' | 'CAPTURE_START_FAILED', message: string) {
    super(message);
    this.name = 'ScrcpyCaptureError';
  }
}

export class StandaloneScrcpyCaptureProvider implements ScrcpyCaptureProvider {
  constructor(
    private readonly adbPath = process.env.ADB_PATH ?? 'adb',
    private readonly scrcpyPath = process.env.SCRCPY_PATH ?? 'scrcpy',
    private readonly configuredServerPath = process.env.SCRCPY_SERVER_PATH,
  ) {}

  async start(deviceSerial: string): Promise<ScrcpyCapture> {
    await this.cleanupStaleSessions(deviceSerial);
    const sessionSuffix = randomBytes(3).toString('hex');
    const scid = `6d${sessionSuffix}`;
    const remoteServer = `${REMOTE_SERVER_PREFIX}${scid}.jar`;
    const socketName = `${SOCKET_PREFIX}${sessionSuffix}`;
    const [serverPath, version, localPort] = await Promise.all([
      this.resolveServerPath(),
      this.resolveVersion(),
      reserveTcpPort(),
    ]);
    await run(this.adbPath, ['-s', deviceSerial, 'push', serverPath, remoteServer]);
    await run(this.adbPath, ['-s', deviceSerial, 'forward', `tcp:${localPort}`, `localabstract:${socketName}`]);

    const server = spawn(this.adbPath, [
      '-s', deviceSerial, 'shell', `CLASSPATH=${remoteServer}`, 'app_process', '/',
      'com.genymobile.scrcpy.Server', version,
      `scid=${scid}`,
      'tunnel_forward=true', 'audio=false', 'control=false', 'cleanup=true',
      'raw_stream=true', 'max_size=1024', 'max_fps=30', 'video_bit_rate=4000000',
      'video_codec_options=i-frame-interval=1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostics = '';
    server.stderr.on('data', (chunk: Buffer) => { diagnostics = `${diagnostics}${chunk.toString()}`.slice(-4_000); });

    try {
      const { socket, stream } = await connectWithRetry(localPort, server);
      return {
        stream,
        stop: async () => {
          socket.destroy();
          stream.destroy();
          await stopProcess(server);
          await run(this.adbPath, ['-s', deviceSerial, 'forward', '--remove', `tcp:${localPort}`], true);
        },
      };
    } catch (error) {
      await stopProcess(server);
      await run(this.adbPath, ['-s', deviceSerial, 'forward', '--remove', `tcp:${localPort}`], true);
      const reason = diagnostics.trim() || (error instanceof Error ? error.message : String(error));
      throw new ScrcpyCaptureError('CAPTURE_START_FAILED', `无法启动设备视频流：${reason}`);
    }
  }

  private async resolveServerPath(): Promise<string> {
    const candidates = [
      this.configuredServerPath,
      '/opt/homebrew/opt/scrcpy/share/scrcpy/scrcpy-server',
      '/usr/local/share/scrcpy/scrcpy-server',
      '/usr/share/scrcpy/scrcpy-server',
    ].filter((value): value is string => Boolean(value));
    for (const path of candidates) {
      try { await access(path); return path; } catch { /* 继续尝试。 */ }
    }
    throw new ScrcpyCaptureError('RUNTIME_NOT_FOUND', '未找到 scrcpy-server，请安装 scrcpy 或设置 SCRCPY_SERVER_PATH');
  }

  private async resolveVersion(): Promise<string> {
    const output = await run(this.scrcpyPath, ['--version']);
    const version = /^scrcpy\s+([^\s]+)/m.exec(output)?.[1];
    if (!version) throw new ScrcpyCaptureError('RUNTIME_NOT_FOUND', '无法识别 scrcpy 版本');
    return version;
  }

  private async cleanupStaleSessions(deviceSerial: string): Promise<void> {
    const forwards = await run(this.adbPath, ['forward', '--list'], true);
    for (const line of forwards.split('\n')) {
      const [serial, local, remote] = line.trim().split(/\s+/);
      if (serial === deviceSerial && local && remote?.startsWith(`localabstract:${SOCKET_PREFIX}`)) {
        await run(this.adbPath, ['-s', deviceSerial, 'forward', '--remove', local], true);
      }
    }
    const processes = await run(this.adbPath, ['-s', deviceSerial, 'shell', 'ps', '-A', '-o', 'PID,ARGS'], true);
    for (const line of processes.split('\n')) {
      if (!line.includes('com.genymobile.scrcpy.Server') || !line.includes(REMOTE_SERVER_PREFIX)) continue;
      const pid = /^\s*(\d+)/.exec(line)?.[1];
      if (pid) await run(this.adbPath, ['-s', deviceSerial, 'shell', 'kill', pid], true);
    }
  }
}

async function reserveTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('无法分配本地端口'));
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function connectWithRetry(port: number, server: ChildProcess): Promise<{ socket: Socket; stream: PassThrough }> {
  const deadline = Date.now() + 5_000;
  let lastError: Error | undefined;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`scrcpy-server 已退出（${server.exitCode}）`);
    try {
      return await new Promise<{ socket: Socket; stream: PassThrough }>((resolve, reject) => {
        const socket = new Socket();
        const failed = (error: Error) => { socket.destroy(); reject(error); };
        socket.once('error', failed);
        socket.once('end', () => failed(new Error('scrcpy-server 尚未开始输出')));
        socket.once('data', (firstChunk: Buffer) => {
          socket.removeListener('error', failed);
          socket.removeAllListeners('end');
          const stream = new PassThrough();
          stream.write(firstChunk);
          socket.pipe(stream);
          resolve({ socket, stream });
        });
        socket.connect(port, '127.0.0.1');
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError ?? new Error('连接 scrcpy-server 超时');
}

async function run(command: string, args: string[], tolerateFailure = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0 || tolerateFailure) resolve(stdout);
      else reject(new ScrcpyCaptureError('CAPTURE_START_FAILED', `${command} 执行失败：${stderr.trim() || code}`));
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
