// Persistent TTL cache for research data. Main-process only, bounded on disk.
import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CacheInfo } from '../../shared/types';

const VERSION = 1;
const MAX_ENTRIES = 600;
const SAVE_DELAY_MS = 300;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
  savedAt: number;
}

interface CacheFile {
  version: number;
  entries: Record<string, CacheEntry>;
}

let loaded = false;
let entries = new Map<string, CacheEntry>();
let saveTimer: NodeJS.Timeout | null = null;
let saveChain: Promise<void> = Promise.resolve();

function cacheFile(): string {
  return path.join(app.getPath('userData'), 'research-cache.json');
}

function prune(): void {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (!entry || entry.expiresAt <= now) entries.delete(key);
  }
  if (entries.size <= MAX_ENTRIES) return;
  const oldest = [...entries.entries()].sort((a, b) => a[1].savedAt - b[1].savedAt);
  for (const [key] of oldest.slice(0, entries.size - MAX_ENTRIES)) entries.delete(key);
}

function serialize(): string {
  return JSON.stringify({ version: VERSION, entries: Object.fromEntries(entries) });
}

async function writeNow(): Promise<void> {
  if (!loaded) return;
  prune();
  const file = cacheFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, serialize(), 'utf8');
  await fs.rename(tmp, file);
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveChain = saveChain.then(writeNow).catch(() => undefined);
  }, SAVE_DELAY_MS);
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(await fs.readFile(cacheFile(), 'utf8')) as Partial<CacheFile>;
    if (raw.version !== VERSION || !raw.entries || typeof raw.entries !== 'object') return;
    for (const [key, entry] of Object.entries(raw.entries)) {
      if (!entry || typeof entry !== 'object') continue;
      if (!Number.isFinite(entry.expiresAt) || !Number.isFinite(entry.savedAt)) continue;
      entries.set(key, {
        value: entry.value,
        expiresAt: entry.expiresAt,
        savedAt: entry.savedAt,
      });
    }
    prune();
  } catch {
    // A missing or corrupt cache starts empty.
  }
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  await ensureLoaded();
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    scheduleSave();
    return undefined;
  }
  return entry.value as T;
}

export async function cacheSet(key: string, value: unknown, ttlMs: number): Promise<void> {
  await ensureLoaded();
  const now = Date.now();
  entries.set(key, { value, expiresAt: now + ttlMs, savedAt: now });
  prune();
  scheduleSave();
}

export async function cacheStats(): Promise<CacheInfo> {
  await ensureLoaded();
  prune();
  return {
    entries: entries.size,
    bytes: entries.size === 0 ? 0 : Buffer.byteLength(serialize(), 'utf8'),
  };
}

export async function clearCache(): Promise<CacheInfo> {
  await ensureLoaded();
  entries.clear();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await flushCache();
  return { entries: 0, bytes: 0 };
}

export async function flushCache(): Promise<void> {
  if (!loaded) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveChain = saveChain.then(writeNow).catch(() => undefined);
  await saveChain;
}

export function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}
