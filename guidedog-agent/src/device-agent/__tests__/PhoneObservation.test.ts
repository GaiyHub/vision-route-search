const mockCtrl = {
  getCurrentForegroundApp: jest.fn(async () => ({
    packageName: 'external.app',
    className: 'Main',
  })),
  getLastForegroundApp: jest.fn(async () => ({
    packageName: 'external.app',
    className: 'Main',
  })),
  bringHostAppToForeground: jest.fn(async () => true),
  returnToPreviousApp: jest.fn(async (_packageName: string) => true),
  takeScreenshot: jest.fn<Promise<unknown>, []>(async () => null),
  isMediaProjectionReady: jest.fn(async () => false),
  probeProjectionReady: jest.fn(async () => false),
  requestMediaProjection: jest.fn(async () => false),
  captureWithMediaProjection: jest.fn<Promise<unknown>, []>(async () => null),
  getAccessibilityTree: jest.fn<Promise<unknown>, []>(),
  getAccessibilitySnapshot: jest.fn<Promise<{
    nodes: unknown[];
    truncated: boolean;
    reason: string | null;
    visitedNodes: number;
    returnedNodes: number;
    durationMs: number;
  }>, []>(),
  suspendOverlayForAutomation: jest.fn<Promise<boolean>, []>(async () => true),
  resumeOverlayAfterAutomation: jest.fn<Promise<void>, []>(async () => undefined),
};

jest.mock('react-native-accessibility-controller', () => mockCtrl);

import { PhoneObservation } from '../agent/PhoneObservation';

describe('PhoneObservation bounded accessibility snapshots', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCtrl.suspendOverlayForAutomation.mockResolvedValue(true);
    mockCtrl.getCurrentForegroundApp.mockResolvedValue({
      packageName: 'external.app',
      className: 'Main',
    });
    mockCtrl.getLastForegroundApp.mockResolvedValue({
      packageName: 'external.app',
      className: 'Main',
    });
    mockCtrl.bringHostAppToForeground.mockResolvedValue(true);
    mockCtrl.returnToPreviousApp.mockResolvedValue(true);
    mockCtrl.takeScreenshot.mockResolvedValue(null);
    mockCtrl.isMediaProjectionReady.mockResolvedValue(false);
    mockCtrl.probeProjectionReady.mockResolvedValue(false);
    mockCtrl.requestMediaProjection.mockResolvedValue(false);
    mockCtrl.captureWithMediaProjection.mockResolvedValue(null);
  });

  it('reports an explicit host-foreground condition instead of a capture failure', async () => {
    mockCtrl.getCurrentForegroundApp.mockResolvedValue({ packageName: '', className: '' });
    const observation = new PhoneObservation({
      suppressHostScreen: true,
      delay: async () => undefined,
    });

    await expect(observation.screenshot()).rejects.toMatchObject({
      code: 'HOST_APP_FOREGROUND',
    });
  });

  it('preserves partial nodes and exposes compact truncation metadata', async () => {
    mockCtrl.getAccessibilitySnapshot.mockResolvedValue({
      nodes: [{
        ref: 'u1',
        resourceId: 'app:id/buy',
        className: 'android.widget.Button',
        text: '购买',
        contentDescription: '',
        bounds: { left: 10, top: 20, right: 110, bottom: 80 },
        isClickable: true,
        isScrollable: false,
        isEditable: false,
        isFocused: false,
        isChecked: false,
        isEnabled: true,
      }],
      truncated: true,
      reason: 'visited_node_limit',
      visitedNodes: 421,
      returnedNodes: 37,
      durationMs: 1204,
    });
    const observation = new PhoneObservation({
      suppressHostScreen: false,
      delay: () => new Promise<void>(() => undefined),
    });

    const result = await observation.inspectUi();

    expect(result).toContain('Button "购买"');
    expect(result).toContain('ref=u1 resourceId=app:id/buy');
    expect(result).toContain(
      '部分结果 reason=visited_node_limit visited=421 returned=37 durationMs=1204',
    );
    expect(mockCtrl.suspendOverlayForAutomation).toHaveBeenCalledTimes(1);
    expect(mockCtrl.resumeOverlayAfterAutomation).toHaveBeenCalledTimes(1);
    expect(mockCtrl.suspendOverlayForAutomation.mock.invocationCallOrder[0])
      .toBeLessThan(mockCtrl.getAccessibilitySnapshot.mock.invocationCallOrder[0]);
    expect(mockCtrl.getAccessibilitySnapshot.mock.invocationCallOrder[0])
      .toBeLessThan(mockCtrl.resumeOverlayAfterAutomation.mock.invocationCallOrder[0]);
    expect(mockCtrl.getAccessibilityTree).not.toHaveBeenCalled();
  });

  it('does not queue another capture when native reports busy', async () => {
    mockCtrl.getAccessibilitySnapshot.mockRejectedValue(
      Object.assign(new Error('busy'), { code: 'TREE_CAPTURE_BUSY' }),
    );
    const observation = new PhoneObservation({
      suppressHostScreen: false,
      delay: () => new Promise<void>(() => undefined),
    });

    await expect(observation.inspectUi()).resolves.toBe(
      '=== 屏幕元素 === (已有采集正在进行，本次未重复排队)',
    );
    expect(mockCtrl.resumeOverlayAfterAutomation).toHaveBeenCalledTimes(1);
  });

  it('raises a typed permission signal without opening authorization UI itself', async () => {
    const observation = new PhoneObservation({
      suppressHostScreen: false,
      delay: async () => undefined,
    });

    await expect(observation.screenshot()).rejects.toMatchObject({
      code: 'SCREEN_CAPTURE_PERMISSION_REQUIRED',
    });
    expect(mockCtrl.requestMediaProjection).not.toHaveBeenCalled();
    expect(mockCtrl.bringHostAppToForeground).not.toHaveBeenCalled();
    expect(mockCtrl.returnToPreviousApp).not.toHaveBeenCalled();
  });

  it('uses a live MediaProjection session when accessibility capture fails', async () => {
    mockCtrl.probeProjectionReady.mockResolvedValue(true);
    mockCtrl.captureWithMediaProjection.mockResolvedValue({
      path: '/tmp/projected.png',
      base64: 'image-data',
    });
    const observation = new PhoneObservation({
      suppressHostScreen: false,
      delay: async () => undefined,
    });

    await expect(observation.screenshot()).resolves.toMatchObject({
      path: '/tmp/projected.png',
    });
    expect(mockCtrl.requestMediaProjection).not.toHaveBeenCalled();
  });
});
