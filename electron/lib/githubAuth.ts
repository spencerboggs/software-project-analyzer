// GitHub token storage: encrypted by the OS and never exposed to the renderer.
import { app, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { GitHubAuthStatus, GitHubConnectResult } from '../../shared/types';

const VERSION = 1;
const FILE = 'github-auth.json';
const ANON_LIMIT = 10;
const TOKEN_LIMIT = 30;
const ANON_QUERIES = 3;
const TOKEN_QUERIES = 10;
const USER_AGENT = 'SoftwareProjectAnalyzer/1.0 (local project analysis)';

interface StoredAuth {
  version: number;
  encrypted: string;
  login: string;
  savedAt: number;
}

interface Auth {
  token: string;
  login: string;
}

let memory: Auth | null | undefined;

function authFile(): string {
  return path.join(app.getPath('userData'), FILE);
}

function anonymousStatus(error?: string): GitHubAuthStatus {
  return {
    connected: false,
    limit: ANON_LIMIT,
    queriesPerScan: ANON_QUERIES,
    ...(error ? { error } : {}),
  };
}

function authenticatedStatus(
  login: string,
  rate?: { remaining?: number; resetAt?: number },
  error?: string,
): GitHubAuthStatus {
  return {
    connected: true,
    login,
    limit: TOKEN_LIMIT,
    queriesPerScan: TOKEN_QUERIES,
    ...(rate?.remaining !== undefined ? { remaining: rate.remaining } : {}),
    ...(rate?.resetAt !== undefined ? { resetAt: rate.resetAt } : {}),
    ...(error ? { error } : {}),
  };
}

async function loadAuth(): Promise<Auth | null> {
  if (memory !== undefined) return memory;
  memory = null;
  try {
    const raw = JSON.parse(await fs.readFile(authFile(), 'utf8')) as Partial<StoredAuth>;
    if (raw.version !== VERSION || typeof raw.encrypted !== 'string' || !raw.login) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    const token = safeStorage.decryptString(Buffer.from(raw.encrypted, 'base64'));
    if (!token) return null;
    memory = { token, login: raw.login };
  } catch {
    // A missing or unreadable token file means signed out.
  }
  return memory;
}

async function saveAuth(token: string, login: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'This system does not provide secure storage, so the token was not saved. Try again on Windows with a signed-in user.',
    );
  }
  const encrypted = safeStorage.encryptString(token).toString('base64');
  const stored: StoredAuth = { version: VERSION, encrypted, login, savedAt: Date.now() };
  const file = authFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, file);
  memory = { token, login };
}

function headers(token: string): Record<string, string> {
  return {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function fetchRate(token: string): Promise<{ remaining?: number; resetAt?: number }> {
  const res = await fetch('https://api.github.com/rate_limit', {
    headers: headers(token),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`GitHub rate check returned ${res.status}.`);
  const data = (await res.json()) as {
    resources?: { search?: { remaining?: number; reset?: number } };
  };
  const search = data.resources?.search;
  return {
    remaining: typeof search?.remaining === 'number' ? search.remaining : undefined,
    resetAt: typeof search?.reset === 'number' ? search.reset * 1000 : undefined,
  };
}

export async function getGitHubToken(): Promise<string | undefined> {
  return (await loadAuth())?.token;
}

export async function getGitHubStatus(): Promise<GitHubAuthStatus> {
  const auth = await loadAuth();
  return auth ? authenticatedStatus(auth.login) : anonymousStatus();
}

export async function refreshGitHubStatus(): Promise<GitHubAuthStatus> {
  const auth = await loadAuth();
  if (!auth) return anonymousStatus();
  try {
    return authenticatedStatus(auth.login, await fetchRate(auth.token));
  } catch (error) {
    return authenticatedStatus(
      auth.login,
      undefined,
      error instanceof Error ? error.message : 'Could not check the GitHub limit.',
    );
  }
}

export async function connectGitHub(rawToken: string): Promise<GitHubConnectResult> {
  const token = rawToken.trim().replace(/^(?:bearer|token)\s+/i, '');
  if (!/^[A-Za-z0-9_]{20,255}$/.test(token)) {
    return {
      ok: false,
      status: await getGitHubStatus(),
      error: 'That does not look like a GitHub token. Paste the full token value.',
    };
  }

  let res: Response;
  try {
    res = await fetch('https://api.github.com/user', {
      headers: headers(token),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return {
      ok: false,
      status: await getGitHubStatus(),
      error: 'GitHub could not be reached from this network.',
    };
  }

  if (res.status === 401) {
    return {
      ok: false,
      status: await getGitHubStatus(),
      error: 'GitHub rejected that token. Check that it is complete and has not expired.',
    };
  }
  if (res.status === 403 || res.status === 429) {
    return {
      ok: false,
      status: await getGitHubStatus(),
      error: 'GitHub rate-limited the token check. Wait a minute and try again.',
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: await getGitHubStatus(),
      error: `GitHub returned ${res.status} while checking the token.`,
    };
  }

  let login = '';
  try {
    const user = (await res.json()) as { login?: string };
    login = typeof user.login === 'string' ? user.login : '';
  } catch {
    // The empty login is handled below.
  }
  if (!login) {
    return {
      ok: false,
      status: await getGitHubStatus(),
      error: 'GitHub accepted the request but did not return an account name.',
    };
  }

  try {
    await saveAuth(token, login);
  } catch (error) {
    return {
      ok: false,
      status: await getGitHubStatus(),
      error: error instanceof Error ? error.message : 'Could not store the token securely.',
    };
  }

  const rate = await fetchRate(token).catch(() => undefined);
  return { ok: true, status: authenticatedStatus(login, rate) };
}

export async function disconnectGitHub(): Promise<GitHubAuthStatus> {
  memory = null;
  try {
    await fs.rm(authFile(), { force: true });
  } catch {
    // Nothing to remove.
  }
  return anonymousStatus();
}
