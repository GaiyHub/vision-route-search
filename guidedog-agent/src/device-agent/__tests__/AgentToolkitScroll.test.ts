import { AgentToolkit } from '../agent/AgentToolkit';
import { PHONE_TOOLS } from '../tools/PhoneTools';

const scrollableTree = {
  ref: 'u1',
  className: 'android.widget.ScrollView',
  isScrollable: true,
  bounds: { left: 0, top: 100, right: 1000, bottom: 1900 },
  children: [],
};

const mockCtrl = {
  getAccessibilityTree: jest.fn<Promise<unknown>, []>(async () => scrollableTree),
  getNodeInfoByRef: jest.fn(async (ref: string) => ({
    found: ref === 'u1',
    ref,
    bounds: scrollableTree.bounds,
    isScrollable: true,
    isEnabled: true,
  })),
  swipe: jest.fn<Promise<boolean>, [number, number, number, number, number?]>(async () => true),
  scrollNode: jest.fn<Promise<boolean>, [string, string]>(async () => true),
};

jest.mock('react-native-accessibility-controller', () => mockCtrl);

function makeToolkit() {
  return new AgentToolkit({ delay: async () => undefined, notes: new Map() });
}

describe('AgentToolkit scroll distance', () => {
  beforeEach(() => {
    mockCtrl.getAccessibilityTree.mockReset().mockResolvedValue(scrollableTree);
    mockCtrl.getNodeInfoByRef.mockClear();
    mockCtrl.swipe.mockReset().mockResolvedValue(true);
    mockCtrl.scrollNode.mockReset().mockResolvedValue(true);
  });

  it('exposes a constrained optional distance parameter', () => {
    const scroll = PHONE_TOOLS.find((tool) => tool.name === 'ui_scroll');
    expect(scroll?.parameters.properties.distance).toMatchObject({
      type: 'string',
      enum: ['short', 'medium', 'long'],
    });
    expect(scroll?.parameters.required).toEqual(['direction']);
  });

  it.each([
    ['short', 540],
    ['medium', 990],
    ['long', 1440],
  ] as const)('maps %s to the expected vertical gesture length', async (distance, pixels) => {
    const result = await makeToolkit().execute({
      name: 'ui_scroll',
      arguments: { ref: 'u1', direction: 'down', distance },
    });

    expect(mockCtrl.swipe).toHaveBeenCalledWith(500, 1720, 500, 1720 - pixels, 350);
    expect(mockCtrl.getAccessibilityTree).not.toHaveBeenCalled();
    expect(mockCtrl.getNodeInfoByRef).toHaveBeenCalledWith('u1');
    expect(mockCtrl.scrollNode).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      data: { method: 'coordinate', distance, distanceControlled: true },
    });
  });

  it('defaults to medium and auto-detects the scrollable node', async () => {
    const result = await makeToolkit().execute({
      name: 'ui_scroll',
      arguments: { direction: 'up' },
    });

    expect(mockCtrl.swipe).toHaveBeenCalledWith(500, 730, 500, 1720, 350);
    expect(result).toMatchObject({ ok: true, data: { ref: 'u1', distance: 'medium' } });
  });

  it('requires an explicit ref when multiple scrollable containers exist', async () => {
    mockCtrl.getAccessibilityTree.mockResolvedValue({
      ref: 'u1',
      className: 'androidx.viewpager.widget.ViewPager',
      isScrollable: true,
      bounds: { left: 0, top: 0, right: 1000, bottom: 1900 },
      children: [{
        ref: 'u2',
        className: 'androidx.recyclerview.widget.RecyclerView',
        isScrollable: true,
        bounds: { left: 0, top: 200, right: 1000, bottom: 1900 },
        children: [],
      }],
    });

    const result = await makeToolkit().execute({
      name: 'ui_scroll',
      arguments: { direction: 'down' },
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'AMBIGUOUS_SCROLL_TARGET',
      details: {
        candidates: [
          { ref: 'u1', className: 'androidx.viewpager.widget.ViewPager' },
          { ref: 'u2', className: 'androidx.recyclerview.widget.RecyclerView' },
        ],
      },
    });
    expect(mockCtrl.swipe).not.toHaveBeenCalled();
    expect(mockCtrl.scrollNode).not.toHaveBeenCalled();
  });

  it('falls back to the native node action when coordinate scrolling is rejected', async () => {
    mockCtrl.swipe.mockResolvedValue(false);

    const result = await makeToolkit().execute({
      name: 'ui_scroll',
      arguments: { ref: 'u1', direction: 'down', distance: 'long' },
    });

    expect(mockCtrl.scrollNode).toHaveBeenCalledWith('u1', 'down');
    expect(result).toMatchObject({
      ok: true,
      data: { method: 'node', distance: 'long', distanceControlled: false },
    });
  });

  it('reports a stale explicit ref without rebuilding the accessibility tree', async () => {
    mockCtrl.getNodeInfoByRef.mockResolvedValueOnce({ found: false } as never);

    const result = await makeToolkit().execute({
      name: 'ui_scroll',
      arguments: { ref: 'uold', direction: 'down' },
    });

    expect(result).toMatchObject({ ok: false, code: 'TARGET_CHANGED' });
    expect(mockCtrl.getAccessibilityTree).not.toHaveBeenCalled();
    expect(mockCtrl.swipe).not.toHaveBeenCalled();
  });

  it('rejects unsupported distances without dispatching a gesture', async () => {
    const result = await makeToolkit().execute({
      name: 'ui_scroll',
      arguments: { direction: 'down', distance: 'huge' },
    });

    expect(result).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    expect(mockCtrl.getAccessibilityTree).not.toHaveBeenCalled();
    expect(mockCtrl.swipe).not.toHaveBeenCalled();
  });
});
