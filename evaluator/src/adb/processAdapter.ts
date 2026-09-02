import { spawn } from 'node:child_process';

export interface ProcessRequest {
  executable: string;
  args: readonly string[];
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stdoutBytes?: Uint8Array;
  stderr: string;
}

export interface ProcessAdapter {
  execute(request: ProcessRequest): Promise<ProcessResult>;
}

export class NodeProcessAdapter implements ProcessAdapter {
  async execute(request: ProcessRequest): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(request.executable, [...request.args], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', abort);
        callback();
      };
      const fail = (error: Error) => finish(() => reject(error));
      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > request.maxOutputBytes) {
          child.kill('SIGKILL');
          fail(new Error(`进程输出超过 ${request.maxOutputBytes} 字节限制`));
          return;
        }
        target.push(chunk);
      };
      const abort = () => {
        child.kill('SIGKILL');
        fail(new Error('进程已取消'));
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        fail(new Error(`进程执行超过 ${request.timeoutMs}ms`));
      }, request.timeoutMs);

      child.stdout.on('data', collect(stdout));
      child.stderr.on('data', collect(stderr));
      child.once('error', fail);
      child.once('close', (exitCode) => finish(() => resolve({
        exitCode: exitCode ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stdoutBytes: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })));
      if (request.signal?.aborted) abort();
      else request.signal?.addEventListener('abort', abort, { once: true });
    });
  }
}
