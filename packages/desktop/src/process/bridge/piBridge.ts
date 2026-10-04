import { ipcMain, dialog, shell, type BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename } from 'node:path';
import type { PiMethod, PiMethods } from '@/common/pi';
import type { PiService } from '../services/pi/PiService';
import { gitDiff, gitStatus, listFiles, previewFile } from '../services/pi/content';
import { safeError } from '../services/pi/paths';

const execute = promisify(execFile);
export async function openChrome(url: string): Promise<void> {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error('invalid_link');
  await execute('/usr/bin/open', ['-a', 'Google Chrome', parsed.href]);
}

export function registerPiBridge(
  service: PiService,
  getWindow: () => BrowserWindow | undefined,
  focused: (id?: string) => void
): void {
  const handlers: {
    [K in PiMethod]: (input: PiMethods[K]['input']) => Promise<PiMethods[K]['output']> | PiMethods[K]['output'];
  } = {
    articles: () => service.articles.list(),
    article: (input) => service.articles.read(input.id),
    list: () => service.list(),
    taskTree: () => service.taskTree(),
    taskLimits: () => service.taskLimits(),
    saveTaskLimits: (input) => service.saveTaskLimits(input),
    skillCatalog: () => service.skillCatalog(),
    refreshSkills: () => service.refreshSkills(),
    approveSkill: (input) => service.approveSkill(input.name),
    rejectSkill: (input) => service.rejectSkill(input.name),
    create: (input) => service.create(input.cwd, input.botId),
    bots: () => service.bots.list(),
    botPreview: async (input) => {
      if (input?.github !== undefined) {
        if (typeof input.github !== 'string' || input.github.length > 2000) throw new Error('bot_github_url');
        return service.bots.prepare({ github: input.github });
      }
      const result = await dialog.showOpenDialog(getWindow()!, { properties: ['openDirectory'] });
      return result.canceled ? undefined : service.bots.prepare({ folder: result.filePaths[0] });
    },
    botInstall: async (input) => {
      const installed = await service.bots.install(input.token);
      await service.refreshTaskResources();
      return installed;
    },
    botDiscard: (input) => service.bots.discard(input.token),
    botFavorite: (input) => service.bots.favorite(input.id, input.favorite),
    botRemove: async (input) => {
      await service.bots.remove(input.id);
      await service.refreshTaskResources();
    },
    open: (input) => service.open(input.id),
    send: (input) => service.send(input.id, input.text, input.attachments, input.mode),
    dispatch: (input) => service.dispatch(input.id, input.goal, input.attachments),
    stopTask: (input) => service.stopTask(input.id, input.subtree),
    resumeTask: (input) => service.resumeTask(input.id, input.subtree),
    reviewTaskResearch: (input) =>
      service.reviewTaskResearch(input.id, input.version, input.accepted, input.feedback, input.searchTerms),
    verifyTask: (input) => service.verifyTask(input.id, input.accepted, input.notes),
    command: (input) => service.command(input.id, input.command),
    respond: (input) => service.respond(input.id, input.response),
    rename: (input) => service.rename(input.id, input.title),
    pin: async (input) => {
      await service.store.pin(input.id, input.pinned);
      service.changed();
    },
    remove: (input) => service.remove(input.id, shell.trashItem),
    fork: (input) => service.fork(input.id, input.entryId),
    folders: async () => [...new Set((await service.list()).filter((c) => !c.managedFolder).map((c) => c.cwd))],
    chooseFolder: async () => {
      const result = await dialog.showOpenDialog(getWindow()!, { properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? undefined : result.filePaths[0];
    },
    chooseFiles: async () => {
      const result = await dialog.showOpenDialog(getWindow()!, { properties: ['openFile', 'multiSelections'] });
      return result.canceled ? [] : result.filePaths.map((path) => ({ path, name: basename(path) }));
    },
    files: (input) => listFiles(service.store.get(input.id).conversation.cwd, input.path, input.search),
    preview: (input) => previewFile(service.store.get(input.id).conversation.cwd, input.path),
    git: (input) => gitStatus(service.store.get(input.id).conversation.cwd),
    diff: (input) => gitDiff(service.store.get(input.id).conversation.cwd, input.path),
    catalog: () => service.settings.catalog(),
    saveConnection: (input) => service.settingsChange(() => service.settings.connection(input)),
    imageGenerationConfig: () => service.imageGeneration.get(),
    saveImageGenerationConfig: async (input) => {
      await service.settingsChange(async () => {
        await service.imageGeneration.save(input);
      });
      return service.imageGeneration.get();
    },
    importImageGenerationConfig: async (input) => {
      let result!: Awaited<ReturnType<typeof service.imageGeneration.get>>;
      await service.settingsChange(async () => {
        result = await service.imageGeneration.importFromFile(input.filePath);
      });
      return result;
    },
    saveSettings: async (input) => {
      await service.settings.save(input);
      await service.refreshTaskResources();
    },
    setLearning: (input) => service.setLearning(input.id, input.profile),
    login: (input) => service.settingsChange(() => service.settings.login(input.provider, input.type)),
    authRespond: (input) => service.settings.respond(input),
    cancelLogin: () => service.settings.cancel(),
    logout: (input) => service.settingsChange(() => service.settings.logout(input.provider)),
    testConnection: () => service.testConnection(),
    automationStatus: () => service.automation.status(),
    saveAutomation: (input) =>
      service
        .settingsChange(async () => {
          await service.automation.save(input);
        })
        .then(() => service.automation.status()),
    automationAction: (input) => service.automation.action(input.action),
    external: (input) => openChrome(input.url),
    focus: (input) => focused(input.id),
  };
  ipcMain.handle('aionpi:invoke', async (event, method: string, input: unknown) => {
    const window = getWindow();
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      return { ok: false, error: 'untrusted_sender' };
    if (!Object.prototype.hasOwnProperty.call(handlers, method)) return { ok: false, error: 'unknown_method' };
    try {
      const handler = handlers[method as PiMethod] as (value: unknown) => unknown;
      return { ok: true, data: await handler(input) };
    } catch (error) {
      return { ok: false, error: safeError(error) };
    }
  });
}
