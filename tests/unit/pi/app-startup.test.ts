import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  events: new Map<string, (event?: { preventDefault: () => void }) => void>(),
  init: vi.fn<() => Promise<void>>(),
  dispose: vi.fn<() => Promise<void>>(),
  lock: vi.fn(() => true),
  quit: vi.fn(),
  bridge: vi.fn(),
  window: vi.fn(),
  exit: vi.fn(),
  load: vi.fn(async () => undefined),
  paths: vi.fn(),
  packaged: false,
}));

vi.mock('node:fs', () => ({ mkdirSync: vi.fn(), writeFileSync: vi.fn() }));
vi.mock('@/process/services/pi/paths', () => ({ piPaths: vi.fn(), safeError: () => 'startup_failed' }));
vi.mock('@/process/services/pi/PiService', () => ({
  PiService: class {
    constructor(paths: unknown) {
      state.paths(paths);
    }
    init = state.init;
    dispose = state.dispose;
    on = vi.fn();
  },
}));
vi.mock('@/process/bridge/piBridge', () => ({ registerPiBridge: state.bridge, openChrome: vi.fn() }));
vi.mock('@/process/utils/initStorage', () => {
  throw new Error('Legacy storage dependencies are not shipped in TheOne');
});
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.packaged;
    },
    setName: vi.fn(),
    getPath: () => '/test-data',
    setPath: vi.fn(),
    requestSingleInstanceLock: state.lock,
    quit: state.quit,
    whenReady: async () => undefined,
    getAppPath: () => '/test-app',
    on: (event: string, callback: (event?: { preventDefault: () => void }) => void) =>
      state.events.set(event, callback),
    exit: state.exit,
  },
  BrowserWindow: class {
    constructor() {
      state.window();
      expect(state.bridge).toHaveBeenCalledOnce();
    }
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() };
    on = vi.fn();
    loadFile = state.load;
  },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
  Notification: {},
  safeStorage: {},
  session: { defaultSession: { setPermissionRequestHandler: vi.fn() } },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.events.clear();
  state.lock.mockReturnValue(true);
  state.dispose.mockResolvedValue(undefined);
  state.packaged = false;
});

afterEach(() => vi.unstubAllGlobals());

it('starts the packaged app with an external image tool without legacy storage dependencies', async () => {
  state.packaged = true;
  state.init.mockResolvedValue(undefined);
  vi.stubGlobal('process', Object.assign(Object.create(process), { resourcesPath: '/test-resources' }));
  await import('@/process/services/pi/app');
  await vi.waitFor(() => expect(state.load).toHaveBeenCalledOnce());
  expect(state.paths).toHaveBeenCalledWith({
    builtinImageGenScript: '/test-resources/app.asar.unpacked/out/main/builtin-mcp-image-gen.js',
  });
  expect(state.exit).not.toHaveBeenCalled();
});

it('lets a duplicate instance exit without waiting for a service it never created', async () => {
  state.lock.mockReturnValue(false);
  await import('@/process/services/pi/app');
  const preventDefault = vi.fn();
  state.events.get('before-quit')?.({ preventDefault });
  expect(state.quit).toHaveBeenCalledOnce();
  expect(preventDefault).not.toHaveBeenCalled();
  expect(state.init).not.toHaveBeenCalled();
});

it('finishes quitting even if service cleanup fails', async () => {
  state.init.mockResolvedValue(undefined);
  state.dispose.mockRejectedValue(new Error('cleanup_failed'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    await import('@/process/services/pi/app');
    await vi.waitFor(() => expect(state.load).toHaveBeenCalledOnce());
    const preventDefault = vi.fn();
    state.events.get('before-quit')?.({ preventDefault });
    await vi.waitFor(() => expect(state.quit).toHaveBeenCalledOnce());
    state.events.get('before-quit')?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(state.dispose).toHaveBeenCalledOnce();
  } finally {
    log.mockRestore();
  }
});

it('does not open an unconnected window when macOS activates during initialization', async () => {
  let ready!: () => void;
  state.init.mockReturnValue(
    new Promise<void>((resolve) => {
      ready = resolve;
    })
  );
  await import('@/process/services/pi/app');
  await vi.waitFor(() => expect(state.init).toHaveBeenCalledOnce());
  state.events.get('activate')?.();
  expect(state.window).not.toHaveBeenCalled();
  ready();
  await vi.waitFor(() => expect(state.load).toHaveBeenCalledOnce());
  state.events.get('activate')?.();
  expect(state.window).toHaveBeenCalledOnce();
});

it('does not expose a chat window after service initialization fails', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  state.init.mockRejectedValue(new Error('init_failed'));
  try {
    await import('@/process/services/pi/app');
    await vi.waitFor(() => expect(state.exit).toHaveBeenCalledWith(1));
    state.events.get('activate')?.();
    expect(state.window).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
