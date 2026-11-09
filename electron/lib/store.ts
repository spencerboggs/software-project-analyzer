// Workspace persistence and sanitization. All reads and writes stay in the main process.
import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppState, ViewName } from '../../shared/types';

const VERSION = 1;
const MAX_IDEAS = 3000;

export function defaultState(): AppState {
  return {
    version: VERSION,
    settings: { model: '', host: 'http://127.0.0.1:11434' },
    folders: [],
    ideas: [],
    prompts: [],
    ui: { view: 'generate', ideaId: null },
  };
}

export function dataFilePath(): string {
  return path.join(app.getPath('userData'), 'workspace.json');
}

function safeView(value: unknown): ViewName {
  return value === 'verify' || value === 'idea' || value === 'settings' ? value : 'generate';
}

function merge(raw: Partial<AppState> | null | undefined): AppState {
  const base = defaultState();
  const source = raw ?? {};
  const host =
    typeof source.settings?.host === 'string' && source.settings.host.trim()
      ? source.settings.host.trim()
      : base.settings.host;
  const model =
    typeof source.settings?.model === 'string' ? source.settings.model.trim() : base.settings.model;

  const folders = Array.isArray(source.folders)
    ? source.folders
        .filter((folder) => folder && typeof folder.id === 'string')
        .map((folder) => ({
          id: folder.id,
          name: typeof folder.name === 'string' && folder.name.trim() ? folder.name : 'Folder',
          collapsed: Boolean(folder.collapsed),
        }))
    : [];

  const folderIds = new Set(folders.map((folder) => folder.id));
  const ideas = Array.isArray(source.ideas)
    ? source.ideas
        .filter((idea) => idea && typeof idea.id === 'string' && typeof idea.title === 'string')
        .map((idea) => ({
          ...idea,
          folderId: idea.folderId && folderIds.has(idea.folderId) ? idea.folderId : null,
        }))
        .slice(0, MAX_IDEAS)
    : [];

  const prompts = Array.isArray(source.prompts)
    ? source.prompts.filter((prompt) => prompt && typeof prompt.id === 'string')
    : [];

  return {
    version: VERSION,
    settings: { model, host },
    folders,
    ideas,
    prompts,
    ui: {
      view: safeView(source.ui?.view),
      ideaId: typeof source.ui?.ideaId === 'string' ? source.ui.ideaId : null,
    },
  };
}

export function sanitizeState(input: unknown): AppState {
  return merge((input ?? {}) as Partial<AppState>);
}

export async function loadState(): Promise<AppState> {
  const file = dataFilePath();
  try {
    const raw = await fs.readFile(file, 'utf8');
    return merge(JSON.parse(raw) as Partial<AppState>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultState();
    try {
      await fs.rename(file, `${file}.broken-${Date.now()}`);
    } catch {
      // Cleanup failure should not prevent the app from opening.
    }
    return defaultState();
  }
}

export async function saveState(state: AppState): Promise<void> {
  const file = dataFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(tmp, file);
}
