import { AgentToolkit } from '../agent/AgentToolkit';

const mockCtrl: {
  openApp: jest.Mock<Promise<boolean>, [string]>;
  getCurrentForegroundApp?: jest.Mock<
    Promise<{ packageName?: string; className?: string }>,
    []
  >;
} = {
  openApp: jest.fn<Promise<boolean>, [string]>(async () => true),
  getCurrentForegroundApp: jest.fn(async () => ({
    packageName: 'previous.app',
    className: 'PreviousActivity',
  })),
};

jest.mock('react-native-accessibility-controller', () => mockCtrl);

function makeToolkit() {
  return new AgentToolkit({
    // Foreground-query timeouts remain pending; poll delays complete immediately.
    delay: (ms) => ms === 500 ? new Promise<void>(() => {}) : Promise.resolve(),
    notes: new Map(),
  });
}

async function openApp(packageName = 'target.app') {
  return makeToolkit().execute({ name: 'open_app', arguments: { packageName } }) as Promise<{
    ok: boolean;
    error?: string;
    data: {
      requestedPackage: string;
      foregroundPackage: string;
      activity: string;
      launchAccepted: boolean;
      launchConfirmed: boolean;
      confirmationAvailable: boolean;
      alreadyForeground: boolean;
      elapsedMs: number;
    };
  }>;
}

describe('AgentToolkit open_app foreground confirmation', () => {
  beforeEach(() => {
    mockCtrl.openApp.mockReset().mockResolvedValue(true);
    mockCtrl.getCurrentForegroundApp = jest.fn(async () => ({
      packageName: 'previous.app',
      className: 'PreviousActivity',
    }));
  });

  it('returns immediately without dispatch when the package is already foreground', async () => {
    mockCtrl.getCurrentForegroundApp!.mockResolvedValue({
      packageName: 'target.app',
      className: 'TargetActivity',
    });

    const result = await openApp();

    expect(result).toMatchObject({
      ok: true,
      data: {
        requestedPackage: 'target.app',
        foregroundPackage: 'target.app',
        activity: 'TargetActivity',
        launchAccepted: true,
        launchConfirmed: true,
        confirmationAvailable: true,
        alreadyForeground: true,
      },
    });
    expect(mockCtrl.openApp).not.toHaveBeenCalled();
  });

  it('polls until the requested package reaches foreground', async () => {
    mockCtrl.getCurrentForegroundApp!
      .mockResolvedValueOnce({ packageName: 'previous.app', className: 'PreviousActivity' })
      .mockResolvedValueOnce({ packageName: 'android', className: 'ResolverActivity' })
      .mockResolvedValue({ packageName: 'target.app', className: 'TargetActivity' });

    const result = await openApp();

    expect(mockCtrl.openApp).toHaveBeenCalledWith('target.app');
    expect(result).toMatchObject({
      ok: true,
      data: {
        foregroundPackage: 'target.app',
        activity: 'TargetActivity',
        launchAccepted: true,
        launchConfirmed: true,
        alreadyForeground: false,
      },
    });
  });

  it('returns a rejected dispatch with actionable structured state', async () => {
    mockCtrl.openApp.mockResolvedValue(false);

    const result = await openApp('missing.app');

    expect(result).toMatchObject({
      ok: false,
      error: 'APP_LAUNCH_REJECTED',
      code: 'APP_LAUNCH_REJECTED',
      details: {
        requestedPackage: 'missing.app',
        foregroundPackage: 'previous.app',
        launchAccepted: false,
        launchConfirmed: false,
      },
    });
    expect(result).not.toHaveProperty('retryable');
    expect(result).not.toHaveProperty('hint');
  });

  it('returns the last observed package after bounded confirmation attempts', async () => {
    mockCtrl.getCurrentForegroundApp!.mockResolvedValue({
      packageName: 'android',
      className: 'ResolverActivity',
    });

    const result = await openApp();

    expect(result).toMatchObject({
      ok: false,
      error: 'APP_NOT_FOREGROUND',
      code: 'APP_NOT_FOREGROUND',
      details: {
        requestedPackage: 'target.app',
        foregroundPackage: 'android',
        activity: 'ResolverActivity',
        launchAccepted: true,
        launchConfirmed: false,
        confirmationAvailable: true,
      },
    });
    expect(mockCtrl.getCurrentForegroundApp).toHaveBeenCalledTimes(17);
  });

  it('preserves dispatch compatibility when foreground inspection is unavailable', async () => {
    mockCtrl.getCurrentForegroundApp = undefined;

    const result = await openApp();

    expect(result).toMatchObject({
      ok: true,
      data: {
        requestedPackage: 'target.app',
        foregroundPackage: '',
        launchAccepted: true,
        launchConfirmed: false,
        confirmationAvailable: false,
      },
    });
    expect(mockCtrl.openApp).toHaveBeenCalledWith('target.app');
  });
});
