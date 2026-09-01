import { evalStatusV1Schema, encodeEvalRequestPayload, type EvalRequestV1, type EvalStatusV1 } from '../contracts/evaluation.js';
import { AdbRunnerError } from './errors.js';
import { parseAdbDevices, type AdbDevice } from './devices.js';
import type { ProcessAdapter, ProcessResult } from './processAdapter.js';

const DEFAULT_PACKAGE = 'com.watchdog.agent';
const DEFAULT_COMPONENT = `${DEFAULT_PACKAGE}/.EvaluationEntryActivity`;
const EVALUATE_ACTION = `${DEFAULT_PACKAGE}.action.EVALUATE`;
const CANCEL_ACTION = `${DEFAULT_PACKAGE}.action.CANCEL_EVALUATION`;

export interface AdbClientOptions {
  adbPath?: string;
  packageName?: string;
  component?: string;
  commandTimeoutMs?: number;
  maxOutputBytes?: number;
}

export class AdbClient {
  private readonly adbPath: string;
  private readonly packageName: string;
  private readonly component: string;
  private readonly commandTimeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(private readonly processAdapter: ProcessAdapter, options: AdbClientOptions = {}) {
    this.adbPath = options.adbPath ?? 'adb';
    this.packageName = options.packageName ?? DEFAULT_PACKAGE;
    this.component = options.component ?? DEFAULT_COMPONENT;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 10_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
  }

  private async execute(args: readonly string[], signal?: AbortSignal): Promise<ProcessResult> {
    try {
      return await this.processAdapter.execute({
        executable: this.adbPath,
        args,
        timeoutMs: this.commandTimeoutMs,
        maxOutputBytes: this.maxOutputBytes,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error instanceof Error && ('code' in error) && error.code === 'ENOENT') {
        throw new AdbRunnerError('ADB_NOT_FOUND', `找不到 ADB：${this.adbPath}`, false, undefined, error);
      }
      throw new AdbRunnerError('DEVICE_LOST', 'ADB 进程调用失败', true, { args }, error);
    }
  }

  private async executeForDevice(serial: string, args: readonly string[], signal?: AbortSignal): Promise<ProcessResult> {
    if (!serial.trim()) throw new AdbRunnerError('DEVICE_NOT_SELECTED', '未选择 Android 设备', false);
    return this.execute(['-s', serial, ...args], signal);
  }

  async listDevices(): Promise<AdbDevice[]> {
    const result = await this.execute(['devices', '-l']);
    if (result.exitCode !== 0) throw new AdbRunnerError('REQUEST_REJECTED', '无法读取 ADB 设备列表', true, { stderr: result.stderr });
    return parseAdbDevices(result.stdout);
  }

  async assertRunnableDevice(serial: string): Promise<AdbDevice> {
    const device = (await this.listDevices()).find((candidate) => candidate.serial === serial);
    if (!device) throw new AdbRunnerError('DEVICE_LOST', `设备已断开：${serial}`, false);
    if (device.state === 'unauthorized') throw new AdbRunnerError('DEVICE_UNAUTHORIZED', device.reason ?? '设备未授权', false);
    if (device.state !== 'device') throw new AdbRunnerError('DEVICE_OFFLINE', device.reason ?? '设备不可用', true);
    return device;
  }

  async assertPackageInstalled(serial: string): Promise<void> {
    const result = await this.executeForDevice(serial, ['shell', 'pm', 'path', this.packageName]);
    if (result.exitCode !== 0 || !result.stdout.includes(`package:`)) {
      throw new AdbRunnerError('DOUPAO_PACKAGE_MISSING', `设备未安装 ${this.packageName}`, false);
    }
  }

  async submit(serial: string, request: EvalRequestV1): Promise<void> {
    const payload = encodeEvalRequestPayload(request);
    const result = await this.executeForDevice(serial, [
      'shell', 'am', 'start', '-W', '-n', this.component, '-a', EVALUATE_ACTION, '--es', 'payload', payload,
    ]);
    this.assertActivitySucceeded(result, '提交评测请求失败');
  }

  async cancel(serial: string, requestId: string): Promise<void> {
    const result = await this.executeForDevice(serial, [
      'shell', 'am', 'start', '-W', '-n', this.component, '-a', CANCEL_ACTION, '--es', 'requestId', requestId,
    ]);
    this.assertActivitySucceeded(result, '取消评测请求失败');
  }

  async readStatus(serial: string, request: Pick<EvalRequestV1, 'runId' | 'sampleId' | 'requestId'>): Promise<EvalStatusV1 | undefined> {
    const remotePath = `/sdcard/Android/data/${this.packageName}/files/evaluation/${request.runId}/${request.sampleId}/${request.requestId}/status.json`;
    const result = await this.executeForDevice(serial, ['exec-out', 'cat', remotePath]);
    if (result.exitCode !== 0) {
      if (/No such file|does not exist/i.test(result.stderr)) return undefined;
      throw new AdbRunnerError('EVALUATION_ARTIFACTS_UNAVAILABLE', '无法读取评测状态', true, { stderr: result.stderr });
    }
    try {
      const status = evalStatusV1Schema.parse(JSON.parse(result.stdout) as unknown);
      if (status.requestId !== request.requestId || status.runId !== request.runId || status.sampleId !== request.sampleId) {
        throw new Error('状态关联 ID 与请求不一致');
      }
      return status;
    } catch (error) {
      throw new AdbRunnerError('STATUS_INVALID', '评测状态文件无效', false, undefined, error);
    }
  }

  private assertActivitySucceeded(result: ProcessResult, fallbackMessage: string): void {
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.exitCode === 0 && !/Error:|Exception|Permission Denial/i.test(output)) return;
    if (/Permission Denial|SecurityException/i.test(output)) {
      throw new AdbRunnerError('EVALUATION_PERMISSION_DENIED', 'ADB shell 无权访问评测入口', false);
    }
    if (/does not exist|unable to resolve|not found/i.test(output)) {
      throw new AdbRunnerError('EVALUATION_ENTRY_UNAVAILABLE', '豆泡评测入口不可用', false);
    }
    if (/IDEMPOTENCY_CONFLICT/.test(output)) throw new AdbRunnerError('IDEMPOTENCY_CONFLICT', fallbackMessage, false);
    if (/RUN_ALREADY_ACTIVE/.test(output)) throw new AdbRunnerError('RUN_ALREADY_ACTIVE', fallbackMessage, false);
    throw new AdbRunnerError('REQUEST_REJECTED', fallbackMessage, false, { output });
  }
}
