import { AdbRunnerError } from './errors.js';

export type AdbDeviceState = 'device' | 'offline' | 'unauthorized' | 'unknown';

export interface AdbDevice {
  serial: string;
  state: AdbDeviceState;
  runnable: boolean;
  reason?: string;
  product?: string;
  model?: string;
  device?: string;
  transportId?: string;
}

export function parseAdbDevices(output: string): AdbDevice[] {
  const lines = output.replace(/\r/g, '').split('\n');
  const headerIndex = lines.findIndex((line) => line.trim() === 'List of devices attached');
  if (headerIndex < 0) {
    throw new AdbRunnerError('REQUEST_REJECTED', 'ADB 设备列表输出格式异常', false, { output });
  }
  return lines.slice(headerIndex + 1).filter((line) => line.trim().length > 0).map((line) => {
    const [serial, rawState, ...attributes] = line.trim().split(/\s+/);
    if (!serial || !rawState) {
      throw new AdbRunnerError('REQUEST_REJECTED', 'ADB 设备记录格式异常', false, { line });
    }
    const state: AdbDeviceState = rawState === 'device' || rawState === 'offline' || rawState === 'unauthorized'
      ? rawState
      : 'unknown';
    const metadata = Object.fromEntries(attributes.flatMap((attribute) => {
      const separator = attribute.indexOf(':');
      return separator > 0 ? [[attribute.slice(0, separator), attribute.slice(separator + 1)]] : [];
    }));
    return {
      serial,
      state,
      runnable: state === 'device',
      ...(state === 'device' ? {} : { reason: state === 'unauthorized' ? '设备未授权 USB 调试' : `设备状态：${rawState}` }),
      ...(metadata.product ? { product: metadata.product } : {}),
      ...(metadata.model ? { model: metadata.model } : {}),
      ...(metadata.device ? { device: metadata.device } : {}),
      ...(metadata.transport_id ? { transportId: metadata.transport_id } : {}),
    };
  });
}
