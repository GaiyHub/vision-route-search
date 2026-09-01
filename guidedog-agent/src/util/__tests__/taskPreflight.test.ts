jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 36 },
  PermissionsAndroid: {
    PERMISSIONS: { POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS' },
    check: jest.fn(async () => true),
  },
}));

jest.mock('react-native-accessibility-controller', () => ({
  probeProjectionReady: jest.fn<Promise<boolean>, []>(),
  isMediaProjectionReady: jest.fn<Promise<boolean>, []>(),
  requestMediaProjection: jest.fn<Promise<boolean>, []>(),
  releaseMediaProjection: jest.fn<Promise<void>, []>(),
  invalidateMediaProjection: jest.fn<Promise<void>, []>(),
}), { virtual: true });

import { PREFLIGHT_ITEMS, runPreflight } from '../taskPreflight';

const controller = jest.requireMock('react-native-accessibility-controller') as {
  probeProjectionReady: jest.Mock<Promise<boolean>, []>;
  isMediaProjectionReady: jest.Mock<Promise<boolean>, []>;
  requestMediaProjection: jest.Mock<Promise<boolean>, []>;
  releaseMediaProjection: jest.Mock<Promise<void>, []>;
  invalidateMediaProjection: jest.Mock<Promise<void>, []>;
};

const screenCapture = PREFLIGHT_ITEMS.find((item) => item.id === 'screenCapture')!;

describe('screen-capture preflight', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    controller.probeProjectionReady.mockResolvedValue(true);
    controller.isMediaProjectionReady.mockResolvedValue(true);
    controller.requestMediaProjection.mockResolvedValue(true);
    controller.releaseMediaProjection.mockResolvedValue();
    controller.invalidateMediaProjection.mockResolvedValue();
  });

  it('uses the active liveness probe instead of trusting a non-null handle', async () => {
    await expect(screenCapture.check()).resolves.toBe(true);

    expect(controller.probeProjectionReady).toHaveBeenCalledTimes(1);
    expect(controller.isMediaProjectionReady).not.toHaveBeenCalled();
  });

  it('uses the fresh native handle for the immediate post-consent recheck', async () => {
    await runPreflight({ screenCaptureCheck: 'freshHandle' });

    expect(controller.isMediaProjectionReady).toHaveBeenCalledTimes(1);
    expect(controller.probeProjectionReady).not.toHaveBeenCalled();
  });

  it('releases a stale session, requests consent, and verifies the new session', async () => {
    controller.probeProjectionReady.mockResolvedValue(false);

    await expect(screenCapture.fix()).resolves.toBeUndefined();

    expect(controller.invalidateMediaProjection).toHaveBeenCalledTimes(1);
    expect(controller.releaseMediaProjection).not.toHaveBeenCalled();
    expect(controller.requestMediaProjection).toHaveBeenCalledTimes(1);
    expect(controller.probeProjectionReady).toHaveBeenCalledTimes(1);
    expect(controller.isMediaProjectionReady).toHaveBeenCalledTimes(1);
  });

  it('does not accept an authorization result without a native projection handle', async () => {
    controller.probeProjectionReady.mockResolvedValue(false);
    controller.isMediaProjectionReady.mockResolvedValue(false);

    await expect(screenCapture.fix()).rejects.toThrow('屏幕录制授权未生效');

    expect(controller.invalidateMediaProjection).toHaveBeenCalledTimes(1);
    expect(controller.releaseMediaProjection).toHaveBeenCalledTimes(1);
  });
});
