import { AgentToolkit } from '../agent/AgentToolkit';

type NodeInfo = {
  found: boolean;
  ref: string;
  isCheckable: boolean;
  isChecked: boolean;
  isEnabled: boolean;
};

const nodeInfo = (overrides: Partial<NodeInfo> = {}): NodeInfo => ({
  found: true,
  ref: 'u1',
  isCheckable: true,
  isChecked: false,
  isEnabled: true,
  ...overrides,
});

const mockCtrl = {
  getNodeInfoByRef: jest.fn<Promise<NodeInfo>, [string]>(async () => nodeInfo()),
  getAccessibilityTree: jest.fn<Promise<unknown>, []>(async () => []),
  tapNode: jest.fn<Promise<boolean>, [string]>(async () => true),
};

jest.mock('react-native-accessibility-controller', () => mockCtrl);

function makeToolkit(delay = jest.fn(async () => undefined)) {
  return {
    toolkit: new AgentToolkit({ delay, notes: new Map() }),
    delay,
  };
}

describe('AgentToolkit ui_set_checked', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCtrl.getNodeInfoByRef.mockResolvedValue(nodeInfo());
    mockCtrl.tapNode.mockResolvedValue(true);
  });

  it('normalizes a literal boolean string before checking the target state', async () => {
    const { toolkit } = makeToolkit();
    const result = await toolkit.execute({
      name: 'ui_set_checked',
      arguments: { ref: 'u1', checked: 'false' },
    });

    expect(result).toMatchObject({ ok: true });
    expect(mockCtrl.getNodeInfoByRef).toHaveBeenCalledWith('u1');
  });

  it('returns a verified no-op when the control already has the desired state', async () => {
    mockCtrl.getNodeInfoByRef.mockResolvedValue(nodeInfo({ isChecked: true }));
    const { toolkit } = makeToolkit();
    const call = {
      name: 'ui_set_checked',
      arguments: { ref: 'u1', checked: true },
    };
    const result = await toolkit.execute(call);

    expect(result).toMatchObject({
      ok: true,
      data: { changed: false, verified: true, checked: true, ref: 'u1' },
    });
    expect(mockCtrl.tapNode).not.toHaveBeenCalled();
    expect(toolkit.resolveUiEffect(call, result)).toBe('none');
  });

  it('rejects nodes that are not checkable', async () => {
    mockCtrl.getNodeInfoByRef.mockResolvedValue(nodeInfo({ isCheckable: false }));
    const { toolkit } = makeToolkit();
    const result = await toolkit.execute({
      name: 'ui_set_checked',
      arguments: { ref: 'u1', checked: true },
    });

    expect(result).toMatchObject({ ok: false, code: 'TARGET_NOT_CHECKABLE' });
    expect(mockCtrl.tapNode).not.toHaveBeenCalled();
  });

  it('rejects disabled controls', async () => {
    mockCtrl.getNodeInfoByRef.mockResolvedValue(nodeInfo({ isEnabled: false }));
    const { toolkit } = makeToolkit();
    const result = await toolkit.execute({
      name: 'ui_set_checked',
      arguments: { ref: 'u1', checked: true },
    });

    expect(result).toMatchObject({ ok: false, code: 'TARGET_DISABLED' });
    expect(mockCtrl.tapNode).not.toHaveBeenCalled();
  });

  it('polls until the checked state reaches the requested value', async () => {
    mockCtrl.getNodeInfoByRef
      .mockResolvedValueOnce(nodeInfo({ isChecked: false }))
      .mockResolvedValueOnce(nodeInfo({ isChecked: false }))
      .mockResolvedValueOnce(nodeInfo({ isChecked: true }));
    const { toolkit, delay } = makeToolkit();
    const result = await toolkit.execute({
      name: 'ui_set_checked',
      arguments: { ref: 'u1', checked: true },
    });

    expect(mockCtrl.tapNode).toHaveBeenCalledWith('u1');
    expect(delay).toHaveBeenCalledWith(150);
    expect(result).toMatchObject({
      ok: true,
      data: { changed: true, verified: true, checked: true, ref: 'u1' },
    });
  });

  it('reports failure when an accepted click does not change the state', async () => {
    const { toolkit } = makeToolkit();
    const result = await toolkit.execute({
      name: 'ui_set_checked',
      arguments: { ref: 'u1', checked: true },
    });

    expect(mockCtrl.getNodeInfoByRef).toHaveBeenCalledTimes(5);
    expect(result).toMatchObject({
      ok: false,
      code: 'SET_CHECKED_UNCHANGED',
      details: { actionAccepted: true, desired: true, observedChecked: false },
    });
  });
});
