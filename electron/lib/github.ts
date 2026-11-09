// GitHub search and README access, with per-scan query and rate-limit budgets.
import { cacheGet, cacheSet } from './cache';

const BASE_HEADERS = {
  'User-Agent': 'SoftwareProjectAnalyzer/1.0 (local project analysis)',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

const SEARCH_TTL = 6 * 60 * 60 * 1000;
const README_TTL = 7 * 24 * 60 * 60 * 1000;
const EMPTY_README_TTL = 24 * 60 * 60 * 1000;

export interface RepoHit {
  id: string;
  name: string;
  fullName: string;
  url: string;
  description: string;
  stars: number;
  forks: number;
  language?: string;
  owner: string;
  ownerType: string;
  archived: boolean;
  pushedAt?: string;
  createdAt?: string;
  license?: string;
  topics: string[];
  defaultBranch: string;
  readme?: string;
}

interface GhRepo {
  id?: number;
  name?: string;
  full_name?: string;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  language?: string | null;
  archived?: boolean;
  pushed_at?: string | null;
  created_at?: string | null;
  default_branch?: string;
  topics?: string[];
  license?: { spdx_id?: string | null } | null;
  owner?: { login?: string; type?: string };
}

export interface GitHubRate {
  limit: number;
  remaining?: number;
  resetAt?: number;
}

export interface RepoSearchResult {
  hits: RepoHit[];
  queriesUsed: number;
  cacheHits: number;
  rate?: GitHubRate;
  authenticated: boolean;
}

export interface RepoSearchOptions {
  token?: string;
  maxQueries?: number;
  fresh?: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function keywords(query: string): string {
  const stop = new Set([
    'app',
    'apps',
    'application',
    'platform',
    'tool',
    'system',
    'software',
    'for',
    'with',
    'that',
    'using',
    'from',
    'into',
    'your',
    'users',
    'user',
    'open',
    'source',
    'self',
    'hosted',
    'the',
    'and',
  ]);
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !stop.has(word))
    .slice(0, 3)
    .join(' ');
}

function cleanReadme(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchReadme(
  repo: RepoHit,
  fresh: boolean,
): Promise<{ text?: string; cached: boolean }> {
  const key = `readme:${repo.fullName.toLowerCase()}:${repo.pushedAt ?? ''}:${repo.defaultBranch}`;
  if (!fresh) {
    const cached = await cacheGet<string>(key);
    if (typeof cached === 'string') return { text: cached || undefined, cached: true };
  }

  const branch = repo.defaultBranch || 'main';
  for (const file of ['README.md', 'readme.md']) {
    try {
      const res = await fetch(
        `https://raw.githubusercontent.com/${repo.fullName}/${branch}/${file}`,
        { headers: { 'User-Agent': BASE_HEADERS['User-Agent'] }, signal: AbortSignal.timeout(9000) },
      );
      if (!res.ok) continue;
      const text = cleanReadme(await res.text());
      if (text) {
        const clipped = text.slice(0, 1200);
        await cacheSet(key, clipped, README_TTL);
        return { text: clipped, cached: false };
      }
    } catch {
      // Try the alternate README filename.
    }
  }
  await cacheSet(key, '', EMPTY_README_TTL);
  return { cached: false };
}

function rateFrom(response: Response, authenticated: boolean): GitHubRate {
  const number = (name: string): number | undefined => {
    const raw = response.headers.get(name);
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const reset = number('x-ratelimit-reset');
  return {
    limit: number('x-ratelimit-limit') ?? (authenticated ? 30 : 10),
    remaining: number('x-ratelimit-remaining'),
    resetAt: reset !== undefined ? reset * 1000 : undefined,
  };
}

export async function searchRepositories(
  queries: string[],
  note: (message: string) => void,
  options: RepoSearchOptions = {},
): Promise<RepoSearchResult> {
  const found = new Map<string, RepoHit>();
  const seenTerms = new Set<string>();
  const token = options.token?.trim() || undefined;
  const fresh = Boolean(options.fresh);
  const limit = Math.max(1, options.maxQueries ?? 3);
  const batch = queries.slice(0, limit);
  const spacing = token ? 2100 : 1500;

  let cacheHits = 0;
  let queriesUsed = 0;
  let liveCalls = 0;
  let rate: GitHubRate | undefined;

  const absorb = (items: RepoHit[]) => {
    for (const item of items) {
      const key = item.fullName.toLowerCase();
      if (!found.has(key)) found.set(key, item);
    }
  };

  for (let index = 0; index < batch.length; index += 1) {
    const terms = keywords(batch[index]);
    if (!terms || seenTerms.has(terms)) continue;
    seenTerms.add(terms);
    queriesUsed += 1;

    const sort = index === 0 ? '&sort=stars&order=desc' : '';
    const key = `github:search:${terms}:${sort ? 'stars' : 'relevance'}`;
    if (!fresh) {
      const cached = await cacheGet<RepoHit[]>(key);
      if (cached) {
        cacheHits += 1;
        absorb(cached);
        continue;
      }
    }

    if (liveCalls > 0) await sleep(spacing);
    liveCalls += 1;

    let res: Response;
    try {
      res = await fetch(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(
          `${terms} in:name,description`,
        )}&per_page=8${sort}`,
        {
          headers: token ? { ...BASE_HEADERS, Authorization: `Bearer ${token}` } : BASE_HEADERS,
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      note('GitHub search could not be reached from this network.');
      continue;
    }

    rate = rateFrom(res, Boolean(token));

    if (res.status === 401) {
      note('GitHub rejected the saved token. Reconnect it in Settings; GitHub repositories were skipped for this scan.');
      break;
    }
    if (res.status === 403 || res.status === 429) {
      note(
        token
          ? 'GitHub rate limit reached, so fewer repositories were checked. Wait a minute and re-scan.'
          : 'GitHub rate limit reached, so fewer repositories were checked. Add a token in Settings to raise the limit to 30 requests per minute, or re-scan in a minute.',
      );
      break;
    }
    if (!res.ok) {
      note(`GitHub search returned ${res.status}.`);
      continue;
    }

    let data: { items?: GhRepo[] };
    try {
      data = (await res.json()) as { items?: GhRepo[] };
    } catch {
      note('GitHub returned an unreadable response.');
      continue;
    }

    const page: RepoHit[] = [];
    for (const item of data.items ?? []) {
      if (!item.full_name || !item.html_url) continue;
      page.push({
        id: `github:${item.id ?? item.full_name}`,
        name: item.name ?? item.full_name,
        fullName: item.full_name,
        url: item.html_url,
        description: (item.description ?? '').trim(),
        stars: item.stargazers_count ?? 0,
        forks: item.forks_count ?? 0,
        language: item.language ?? undefined,
        owner: item.owner?.login ?? item.full_name.split('/')[0],
        ownerType: item.owner?.type ?? 'User',
        archived: Boolean(item.archived),
        pushedAt: item.pushed_at ?? undefined,
        createdAt: item.created_at ?? undefined,
        license: item.license?.spdx_id ?? undefined,
        topics: Array.isArray(item.topics) ? item.topics.slice(0, 6) : [],
        defaultBranch: item.default_branch ?? 'main',
      });
    }

    await cacheSet(key, page, SEARCH_TTL);
    absorb(page);

    if (rate?.remaining === 0) {
      note(
        token
          ? 'GitHub reports no search requests left this minute. Re-scan after the reset.'
          : 'GitHub reports no search requests left this minute. Add a token in Settings for 30 requests per minute, or re-scan after the reset.',
      );
      break;
    }
  }

  const hits = [...found.values()].slice(0, 10);
  await Promise.all(
    hits.slice(0, 3).map(async (repo) => {
      const readme = await fetchReadme(repo, fresh);
      if (readme.cached) cacheHits += 1;
      repo.readme = readme.text;
    }),
  );

  return { hits, queriesUsed, cacheHits, rate, authenticated: Boolean(token) };
}
