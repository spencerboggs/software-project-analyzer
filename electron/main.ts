// Electron main process: owns the window, local files, and every network request.
import { app, BrowserWindow, clipboard, ipcMain, net, session, shell } from 'electron';
import path from 'node:path';
import { dataFilePath, loadState, sanitizeState, saveState } from './lib/store';
import { checkOllama, listModels } from './lib/ollama';
import { generateIdeas } from './lib/generate';
import { researchIdea } from './lib/research';
import { setWebFetcher } from './lib/web';
import { cacheStats, clearCache, flushCache } from './lib/cache';
import {
  connectGitHub,
  disconnectGitHub,
  getGitHubStatus,
  getGitHubToken,
  refreshGitHubStatus,
} from './lib/githubAuth';
import { exportWorkspace, importWorkspace } from './lib/backup';
import type { GenerateRequest, ProgressEvent, ResearchRequest } from '../shared/types';

const devUrl = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#F1EDE3',
    title: 'Software Project Analyzer',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const target = devUrl ?? `file://${path.join(__dirname, '../../dist/index.html')}`;
  void win.loadURL(target);


  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

function fail(message: string): never {
  throw new Error(message);
}

function asString(value: unknown, max = 20_000): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function normalizeGenerate(raw: unknown): GenerateRequest {
  const input = (raw ?? {}) as Partial<GenerateRequest>;
  const count = Math.min(5, Math.max(1, Math.round(Number(input.count) || 3)));
  return {
    taskId: asString(input.taskId, 100),
    themes: asString(input.themes, 1200),
    goals: asString(input.goals, 1200),
    stack: asString(input.stack, 800),
    count,
    model: asString(input.model, 200),
    host: asString(input.host, 300),
    avoid: Array.isArray(input.avoid)
      ? input.avoid.filter((item): item is string => typeof item === 'string').slice(0, 80)
      : [],
  };
}

function normalizeResearch(raw: unknown): ResearchRequest {
  const input = (raw ?? {}) as Partial<ResearchRequest>;
  return {
    taskId: asString(input.taskId, 100),
    ideaId: asString(input.ideaId, 100),
    title: asString(input.title, 300) || fail('Missing idea title.'),
    description: asString(input.description, 8000) || fail('Missing idea description.'),
    stack: Array.isArray(input.stack)
      ? input.stack.filter((item): item is string => typeof item === 'string').slice(0, 20)
      : [],
    model: asString(input.model, 200),
    host: asString(input.host, 300),
    fresh: Boolean(input.fresh),
  };
}

function registerIpc(): void {
  ipcMain.handle('app:bootstrap', async () => {
    const state = await loadState();
    const [health, github, cache] = await Promise.all([
      checkOllama(state.settings.host),
      getGitHubStatus(),
      cacheStats(),
    ]);
    return {
      state,
      models: health.models,
      dataPath: dataFilePath(),
      ollamaOk: health.ok,
      ollamaError: health.error,
      github,
      cache,
    };
  });

  ipcMain.handle('state:save', async (_event, raw: unknown) => {
    await saveState(sanitizeState(raw));
  });

  ipcMain.handle('ollama:models', async (_event, rawHost: unknown) => {
    const host = asString(rawHost, 300);
    try {
      return { ok: true, models: await listModels(host) };
    } catch (error) {
      return {
        ok: false,
        models: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('ideas:generate', async (event, raw: unknown) => {
    const request = normalizeGenerate(raw);
    const emit = (stage: string, label: string, received?: number) => {
      const payload: ProgressEvent = { taskId: request.taskId, stage, label, received };
      if (!event.sender.isDestroyed()) event.sender.send('task:progress', payload);
    };
    return generateIdeas({ ...request, onProgress: emit });
  });

  ipcMain.handle('research:run', async (event, raw: unknown) => {
    const request = normalizeResearch(raw);
    const emit = (stage: string, label: string, received?: number) => {
      const payload: ProgressEvent = { taskId: request.taskId, stage, label, received };
      if (!event.sender.isDestroyed()) event.sender.send('task:progress', payload);
    };
    const githubToken = await getGitHubToken();
    const report = await researchIdea({ ...request, githubToken, onProgress: emit });
    await flushCache();
    return report;
  });

  ipcMain.handle('github:connect', async (_event, raw: unknown) => {
    return connectGitHub(asString(raw, 500));
  });

  ipcMain.handle('github:disconnect', async () => disconnectGitHub());

  ipcMain.handle('github:refresh', async () => refreshGitHubStatus());

  ipcMain.handle('workspace:export', async (event, raw: unknown) => {
    return exportWorkspace(sanitizeState(raw), BrowserWindow.fromWebContents(event.sender));
  });

  ipcMain.handle('workspace:import', async (event) => {
    return importWorkspace(BrowserWindow.fromWebContents(event.sender));
  });

  ipcMain.handle('cache:stats', async () => cacheStats());

  ipcMain.handle('cache:clear', async () => clearCache());

  ipcMain.handle('shell:open', async (_event, rawUrl: unknown) => {
    const url = asString(rawUrl, 2000);
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
  });

  ipcMain.handle('clipboard:write', async (_event, rawText: unknown) => {
    const text = asString(rawText, 5000);
    if (text) clipboard.writeText(text);
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false);
    });
    setWebFetcher((url, init) => net.fetch(url, init));
    registerIpc();
    mainWindow = createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on('before-quit', () => {
    void flushCache();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
