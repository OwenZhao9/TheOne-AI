import { app, BrowserWindow, Menu, Notification, safeStorage, session } from 'electron';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { piPaths, safeError } from './paths';
import type { PiService } from './PiService';
import { ImageGenerationConfigService } from './ImageGenerationConfigService';
import type { PiEvent } from '@/common/pi';
import words from '@/renderer/services/i18n/locales/zh-CN/common.json';

app.setName('TheOne');
// Keep the existing data location so renaming the app preserves settings and conversations.
const data = process.env.AIONPI_TEST_DATA || join(app.getPath('appData'), 'AionPi');
mkdirSync(data, { recursive: true, mode: 0o700 });
app.setPath('userData', data);
app.setPath('sessionData', join(data, 'browser'));
const imageConfigImportOnly = process.argv.includes('--import-image-config-only');
const locked = imageConfigImportOnly ? true : app.requestSingleInstanceLock();
if (!locked) app.quit();
let window: BrowserWindow | undefined;
let service: PiService | undefined;
let focusedId: string | undefined;
let quitting = false;
let initialized = false;

function imageConfigImportPath(argv: string[]): string | undefined {
  const flag = '--import-image-config';
  const inline = argv.find((value) => value.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function importImageConfig(path: string | undefined): Promise<void> {
  if (!path || !service) return;
  const result = await service.imageGeneration.importFromFile(path);
  console.log(`[TheOne] image generation config imported: ${JSON.stringify(result)}`);
}

function secretCodec() {
  return {
    seal: (value: string) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('secure_storage_unavailable');
      return safeStorage.encryptString(value).toString('base64');
    },
    open: (value: string) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('secure_storage_unavailable');
      return safeStorage.decryptString(Buffer.from(value, 'base64'));
    },
  };
}

async function importImageConfigOnly(): Promise<void> {
  const path = imageConfigImportPath(process.argv);
  if (!path) throw new Error('image_generation_import_path_missing');
  const runtime = app.isPackaged
    ? join(process.resourcesPath, 'aionpi-runtime')
    : join(app.getAppPath(), 'resources/aionpi-runtime');
  const config = new ImageGenerationConfigService(piPaths(data, runtime), secretCodec());
  await config.load();
  const result = await config.importFromFile(path);
  console.log(`[TheOne] image generation config imported: ${JSON.stringify(result)}`);
}

async function createWindow(): Promise<void> {
  const { openChrome } = await import('../../bridge/piBridge');
  window = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 840,
    minHeight: 600,
    title: 'TheOne',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openChrome(url).catch((): void => {});
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('closed', () => {
    window = undefined;
    focusedId = undefined;
  });
  if (process.env.ELECTRON_RENDERER_URL)
    await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/pages/PiDesktop/index.html`);
  else await window.loadFile(join(__dirname, '../renderer/pages/PiDesktop/index.html'));
}

if (imageConfigImportOnly)
  void app
    .whenReady()
    .then(async () => {
      await importImageConfigOnly();
      app.exit(0);
    })
    .catch((error) => {
      console.error('[TheOne] image generation config import failed:', safeError(error));
      app.exit(1);
    });
else if (locked)
  void app
    .whenReady()
    .then(async () => {
      const [{ PiService }, { registerPiBridge }] = await Promise.all([
        import('./PiService'),
        import('../../bridge/piBridge'),
      ]);
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      const runtime = app.isPackaged
        ? join(process.resourcesPath, 'aionpi-runtime')
        : join(app.getAppPath(), 'resources/aionpi-runtime');
      service = new PiService(
        {
          ...piPaths(data, runtime),
          // External Node processes need the unpacked file, not Electron's virtual ASAR path.
          builtinImageGenScript: app.isPackaged
            ? join(process.resourcesPath, 'app.asar.unpacked', 'out', 'main', 'builtin-mcp-image-gen.js')
            : join(__dirname, 'builtin-mcp-image-gen.js'),
        },
        secretCodec()
      );
      await service.init();
      await importImageConfig(imageConfigImportPath(process.argv));
      registerPiBridge(
        service,
        () => window,
        (id) => {
          focusedId = id;
        }
      );
      service.on('event', (event: PiEvent) => {
        window?.webContents.send('aionpi:event', event);
        if (
          event.kind === 'attention' &&
          service!.settings.get().notifications &&
          (!window?.isFocused() || focusedId !== event.id)
        ) {
          if (!window?.isFocused() && Notification.isSupported()) {
            const body =
              event.reason === 'finished'
                ? words.pi.finished
                : event.reason === 'question'
                  ? words.pi.question
                  : words.pi.failed;
            const notification = new Notification({ title: 'TheOne', body });
            notification.on('click', () => {
              window?.show();
              window?.focus();
              window?.webContents.send('aionpi:event', { kind: 'navigate', id: event.id });
            });
            notification.show();
          }
        }
      });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          { role: 'appMenu' },
          { role: 'editMenu' },
          { role: 'viewMenu' },
          { role: 'windowMenu' },
        ])
      );
      initialized = true;
      await createWindow();
    })
    .catch((error) => {
      console.error('[TheOne] startup failed:', safeError(error));
      try {
        writeFileSync(join(data, 'startup-error.log'), `${safeError(error)}\n`, { mode: 0o600 });
      } catch {
        // Preserve the original startup failure when diagnostics cannot be saved.
      }
      app.exit(1);
    });

if (!imageConfigImportOnly) {
  app.on('second-instance', (_event, commandLine) => {
    const path = imageConfigImportPath(commandLine);
    if (path && service)
      void service
        .settingsChange(async (): Promise<void> => {
          await service!.imageGeneration.importFromFile(path);
        })
        .then(() =>
          console.log(`[TheOne] image generation config imported: ${JSON.stringify(service!.imageGeneration.get())}`)
        )
        .catch((error) => console.error('[TheOne] image generation config import failed:', safeError(error)));
    window?.show();
    window?.focus();
  });
  app.on('activate', () => {
    if (!window && initialized) void createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', (event) => {
    if (quitting || !service) return;
    event.preventDefault();
    quitting = true;
    void service
      .dispose()
      .catch((error) => console.error('[TheOne] shutdown failed:', safeError(error)))
      .finally(() => app.quit());
  });
}
