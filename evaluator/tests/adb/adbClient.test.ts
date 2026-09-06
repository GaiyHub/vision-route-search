import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import requestFixture from '../../../specs/pc-batch-evaluation/fixtures/eval-request-v1.json' with { type: 'json' };
import statusFixture from '../../../specs/pc-batch-evaluation/fixtures/eval-status-v1.json' with { type: 'json' };
import { AdbClient } from '../../src/adb/adbClient.js';
import { parseAdbDevices } from '../../src/adb/devices.js';
import type { ProcessAdapter, ProcessRequest, ProcessResult } from '../../src/adb/processAdapter.js';
import { evalRequestV1Schema } from '../../src/contracts/evaluation.js';

class FakeProcessAdapter implements ProcessAdapter {
  readonly requests: ProcessRequest[] = [];
  constructor(private readonly responses: ProcessResult[]) {}
  async execute(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error('缺少 Fake ADB 响应');
    return response;
  }
}

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const ok = (stdout = ''): ProcessResult => ({ exitCode: 0, stdout, stderr: '' });

describe('ADB 设备发现', () => {
  it('保留全部设备状态，只标记 device 为可运行', () => {
    const devices = parseAdbDevices(`List of devices attached\nserial-1 device product:p model:Pixel_8 device:husky transport_id:1\nserial-2 unauthorized usb:1-1\nserial-3 offline\n`);
    expect(devices).toMatchObject([
      { serial: 'serial-1', state: 'device', runnable: true, model: 'Pixel_8' },
      { serial: 'serial-2', state: 'unauthorized', runnable: false },
      { serial: 'serial-3', state: 'offline', runnable: false },
    ]);
  });

  it('拒绝异常输出', () => {
    expect(() => parseAdbDevices('daemon failed')).toThrow('格式异常');
  });
});

describe('ADB 请求边界', () => {
  it('显式指定 serial，并将完整 UTF-8 请求作为单一 Base64URL 参数提交', async () => {
    const adapter = new FakeProcessAdapter([ok('Starting: Intent')]);
    const client = new AdbClient(adapter);
    const request = evalRequestV1Schema.parse(requestFixture.request);
    await client.submit('serial-1', request);
    const call = adapter.requests[0];
    expect(call?.executable).toBe('adb');
    expect(call?.args.slice(0, 2)).toEqual(['-s', 'serial-1']);
    expect(call?.args).toContain(requestFixture.encodedPayload);
    expect(call?.args.join(' ')).not.toContain(request.instruction);
  });

  it('按指定关联路径读取并校验状态', async () => {
    const completed = statusFixture.statuses[2];
    const adapter = new FakeProcessAdapter([ok(JSON.stringify(completed))]);
    const client = new AdbClient(adapter);
    const request = evalRequestV1Schema.parse(requestFixture.request);
    await expect(client.readStatus('serial-1', request)).resolves.toMatchObject({ state: 'COMPLETED' });
    expect(adapter.requests[0]?.args).toContain(`/sdcard/Android/data/com.watchdog.agent/files/evaluation/${request.runId}/${request.sampleId}/${request.requestId}/status.json`);
  });

  it('区分入口缺失与权限拒绝', async () => {
    const request = evalRequestV1Schema.parse(requestFixture.request);
    const missing = new AdbClient(new FakeProcessAdapter([{ exitCode: 1, stdout: '', stderr: 'Error: Activity class does not exist.' }]));
    await expect(missing.submit('serial-1', request)).rejects.toMatchObject({ code: 'EVALUATION_ENTRY_UNAVAILABLE' });
    const denied = new AdbClient(new FakeProcessAdapter([{ exitCode: 1, stdout: '', stderr: 'Permission Denial: SecurityException' }]));
    await expect(denied.submit('serial-1', request)).rejects.toMatchObject({ code: 'EVALUATION_PERMISSION_DENIED' });
  });

  it('读取设备与评测入口 readiness 元信息', async () => {
    const adapter = new FakeProcessAdapter([
      ok('13\n'),
      ok('  versionCode=1\n  versionName=0.1.0\n'),
      ok('ActivityInfo:\n  name=com.watchdog.agent.EvaluationEntryActivity\n  permission=android.permission.DUMP\n'),
    ]);
    const client = new AdbClient(adapter);
    await expect(client.readAndroidVersion('serial-1')).resolves.toBe('13');
    await expect(client.readPackageVersion('serial-1')).resolves.toBe('0.1.0');
    await expect(client.readEvaluationApiVersion('serial-1')).resolves.toBe(1);
    expect(adapter.requests.every((request) => request.args.slice(0, 2).join(' ') === '-s serial-1')).toBe(true);
  });

  it('仅允许读取关联目录中的白名单产物', async () => {
    const request = evalRequestV1Schema.parse(requestFixture.request);
    const adapter = new FakeProcessAdapter([ok('{"traceId":"abc"}')]);
    const client = new AdbClient(adapter);
    await expect(client.readEvaluationArtifact(
      'serial-1',
      request,
      `todo-${'a'.repeat(32)}.json`,
      true,
    )).resolves.toContain('traceId');
    await expect(client.readEvaluationArtifact('serial-1', request, '../settings.json')).rejects.toMatchObject({
      code: 'REQUEST_REJECTED',
    });
    expect(adapter.requests).toHaveLength(1);
  });

  it('通过 adb pull 将 OTel 直接落盘并执行独立大小限制', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doupao-adb-pull-'));
    roots.push(root);
    await mkdir(root, { recursive: true });
    const destination = join(root, 'otel.jsonl');
    const requests: ProcessRequest[] = [];
    const adapter: ProcessAdapter = {
      async execute(processRequest) {
        requests.push(processRequest);
        await writeFile(destination, 'streamed-otel');
        return ok('1 file pulled');
      },
    };
    const client = new AdbClient(adapter);
    const request = evalRequestV1Schema.parse(requestFixture.request);
    const fileName = `otel-${'a'.repeat(32)}.jsonl`;

    await client.pullEvaluationArtifact('serial-1', request, fileName, destination, 32);

    expect(await readFile(destination, 'utf8')).toBe('streamed-otel');
    expect(requests[0]?.args).toEqual(expect.arrayContaining(['-s', 'serial-1', 'pull', destination]));
    await expect(client.pullEvaluationArtifact('serial-1', request, fileName, destination, 4)).rejects.toMatchObject({
      code: 'EVALUATION_ARTIFACTS_UNAVAILABLE',
    });
  });

  it('采集最终截图、UI 层级和前台 Activity', async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    const adapter = new FakeProcessAdapter([
      { ...ok(), stdoutBytes: png },
      ok('UI hierchary dumped to: /dev/tty\n<?xml version="1.0"?><hierarchy/>\n'),
      ok('  mResumedActivity: ActivityRecord{abc u0 com.example.app/.MainActivity t42}\n'),
    ]);
    const client = new AdbClient(adapter);
    await expect(client.captureScreenshot('serial-1')).resolves.toEqual(png);
    await expect(client.dumpUiHierarchy('serial-1')).resolves.toBe('<?xml version="1.0"?><hierarchy/>');
    await expect(client.readForegroundActivity('serial-1')).resolves.toEqual({ packageName: 'com.example.app', activityName: '.MainActivity' });
    expect(adapter.requests.map((request) => request.args.slice(2, 4))).toEqual([
      ['exec-out', 'screencap'], ['exec-out', 'uiautomator'], ['shell', 'dumpsys'],
    ]);
  });
});
