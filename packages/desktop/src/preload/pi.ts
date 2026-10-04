import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { PiAPI, PiEvent } from '../common/pi/types';

const api: PiAPI = {
  invoke: async (method, input) => {
    const result = await ipcRenderer.invoke('aionpi:invoke', method, input);
    if (!result.ok) throw new Error(String(result.error));
    return result.data;
  },
  subscribe: (listener) => {
    const handler = (_event: unknown, event: PiEvent): void => listener(event);
    ipcRenderer.on('aionpi:event', handler);
    return () => ipcRenderer.removeListener('aionpi:event', handler);
  },
  filePath: (file) => webUtils.getPathForFile(file),
};
contextBridge.exposeInMainWorld('aionPi', api);
