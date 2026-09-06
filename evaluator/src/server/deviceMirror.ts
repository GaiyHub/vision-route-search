import { AdbClient } from '../adb/adbClient.js';

export interface MirrorDevice {
  serial: string;
  model: string;
  androidVersion: string;
  state: 'ONLINE' | 'OFFLINE' | 'UNAUTHORIZED' | 'UNKNOWN';
  canMirror: boolean;
  reason?: string;
}

export interface DeviceMirrorService {
  listDevices(): Promise<MirrorDevice[]>;
  captureFrame(serial: string): Promise<Buffer>;
}

export class DeviceMirrorError extends Error {
  constructor(
    readonly code: 'DEVICE_NOT_FOUND' | 'DEVICE_NOT_MIRRORABLE',
    message: string,
  ) {
    super(message);
    this.name = 'DeviceMirrorError';
  }
}

export class AdbDeviceMirrorService implements DeviceMirrorService {
  constructor(private readonly adb: AdbClient) {}

  async listDevices(): Promise<MirrorDevice[]> {
    const devices = await this.adb.listDevices();
    return Promise.all(devices.map(async (device): Promise<MirrorDevice> => {
      const state = normalizeState(device.state);
      const canMirror = state === 'ONLINE';
      return {
        serial: device.serial,
        model: (device.model ?? device.device ?? 'Android 设备').replaceAll('_', ' '),
        androidVersion: canMirror ? await this.adb.readAndroidVersion(device.serial) : '未知',
        state,
        canMirror,
        ...(!canMirror ? { reason: device.reason ?? stateReason(state) } : {}),
      };
    }));
  }

  async captureFrame(serial: string): Promise<Buffer> {
    await this.adb.assertRunnableDevice(serial);
    return this.adb.captureScreenshot(serial);
  }
}

function normalizeState(state: string): MirrorDevice['state'] {
  if (state === 'device') return 'ONLINE';
  if (state === 'offline') return 'OFFLINE';
  if (state === 'unauthorized') return 'UNAUTHORIZED';
  return 'UNKNOWN';
}

function stateReason(state: MirrorDevice['state']): string {
  if (state === 'UNAUTHORIZED') return '请在手机上允许 USB 调试授权';
  if (state === 'OFFLINE') return '设备当前离线';
  return '设备状态暂不可用';
}
