// The renderer gets only this narrow, typed bridge; Node stays in the main process.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { Api, ProgressEvent } from '../shared/types';

const api: Api = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  listModels: (host) => ipcRenderer.invoke('ollama:models', host),
  generate: (request) => ipcRenderer.invoke('ideas:generate', request),
  research: (request) => ipcRenderer.invoke('research:run', request),
  connectGitHub: (token) => ipcRenderer.invoke('github:connect', token),
  disconnectGitHub: () => ipcRenderer.invoke('github:disconnect'),
  refreshGitHub: () => ipcRenderer.invoke('github:refresh'),
  exportWorkspace: (state) => ipcRenderer.invoke('workspace:export', state),
  importWorkspace: () => ipcRenderer.invoke('workspace:import'),
  cacheStats: () => ipcRenderer.invoke('cache:stats'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  onProgress: (callback) => {
    const handler = (_event: IpcRendererEvent, payload: ProgressEvent) => callback(payload);
    ipcRenderer.on('task:progress', handler);
    return () => {
      ipcRenderer.removeListener('task:progress', handler);
    };
  },
};

contextBridge.exposeInMainWorld('softwareProjectAnalyzer', api);
