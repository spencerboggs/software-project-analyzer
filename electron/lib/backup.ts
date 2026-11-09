// Workspace backups contain user state only; tokens and caches are intentionally excluded.
import { app, dialog, type BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppState, BackupResult, ImportResult } from '../../shared/types';
import { sanitizeState, saveState } from './store';

const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

export async function exportWorkspace(
  state: AppState,
  parent: BrowserWindow | null,
): Promise<BackupResult> {
  const date = new Date().toISOString().slice(0, 10);
  const options = {
    title: 'Export workspace backup',
    defaultPath: path.join(app.getPath('documents'), `software-project-analyzer-backup-${date}.json`),
    filters: [{ name: 'JSON backup', extensions: ['json'] }],
  };

  try {
    const picked = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };

    const clean = sanitizeState(state);
    const payload = {
      app: 'Software Project Analyzer',
      version: 1,
      exportedAt: new Date().toISOString(),
      state: clean,
    };
    await fs.writeFile(picked.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, path: picked.filePath };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not write the backup.',
    };
  }
}

export async function importWorkspace(parent: BrowserWindow | null): Promise<ImportResult> {
  try {
    const picked = parent
      ? await dialog.showOpenDialog(parent, {
          title: 'Import a workspace backup',
          filters: [{ name: 'JSON backup', extensions: ['json'] }],
          properties: ['openFile'],
        })
      : await dialog.showOpenDialog({
          title: 'Import a workspace backup',
          filters: [{ name: 'JSON backup', extensions: ['json'] }],
          properties: ['openFile'],
        });
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true };

    const file = picked.filePaths[0];
    const stat = await fs.stat(file);
    if (stat.size > MAX_BACKUP_BYTES) {
      return { ok: false, error: 'That backup is larger than 25 MB and was not opened.' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      return { ok: false, error: 'That file is not valid JSON.' };
    }

    const candidate =
      parsed && typeof parsed === 'object' && 'state' in parsed
        ? (parsed as { state?: unknown }).state
        : parsed;
    if (!candidate || typeof candidate !== 'object') {
      return { ok: false, error: 'That file does not contain a workspace backup.' };
    }
    const record = candidate as Record<string, unknown>;
    if (!('ideas' in record || 'folders' in record || 'prompts' in record || 'settings' in record)) {
      return { ok: false, error: 'That file does not contain a workspace backup.' };
    }

    const state = sanitizeState(candidate);
    const message = `${state.ideas.length} idea${
      state.ideas.length === 1 ? '' : 's'
    }, ${state.folders.length} folder${state.folders.length === 1 ? '' : 's'}, and ${
      state.prompts.length
    } saved brief${state.prompts.length === 1 ? '' : 's'} will replace the current workspace.`;
    const confirmOptions = {
      type: 'warning' as const,
      buttons: ['Cancel', 'Replace workspace'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Import workspace',
      message: 'Replace the current workspace?',
      detail: `${message}\n\nExport a backup first if you want to keep what is already here.`,
    };
    const confirm = parent
      ? await dialog.showMessageBox(parent, confirmOptions)
      : await dialog.showMessageBox(confirmOptions);
    if (confirm.response !== 1) return { ok: false, canceled: true };

    await saveState(state);
    return { ok: true, state };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not import that backup.',
    };
  }
}

