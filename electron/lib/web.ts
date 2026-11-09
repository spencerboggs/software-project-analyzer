// Public web and Hacker News search. The main process supplies the browser-like fetcher.
import { cacheGet, cacheSet, hashKey } from './cache';

export interface WebHit {
  id: string;
  title: string;
  url: string;
  snippet: string;
  engine: 'ddg' | 'yahoo' | 'hn';
  points?: number;
  comments?: number;
  createdAt?: string;
}

export type WebFetcher = (url: string, init?: RequestInit) => Promise<Response>;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const WEB_TTL = 12 * 60 * 60 * 1000;
const HN_TTL = 6 * 60 * 60 * 1000;

export interface CachedWebResult {
  hits: WebHit[];
  cached: boolean;
}

let webFetch: WebFetcher = (url, init) => fetch(url, init);

/** Main process swaps in Electron's Chromium fetch so search pages see a browser, not Node. */
export function setWebFetcher(fetcher: WebFetcher): void {
  webFetch = fetcher;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeText(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&rsquo;/gi, '’')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&ldquo;/gi, '“')
    .replace(/&rdquo;/gi, '”')
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function unwrapUrl(rawHref: string): string {
  let href = decodeText(rawHref);
  if (href.startsWith('//')) href = `https:${href}`;
  try {
    const parsed = new URL(href);
    const target = parsed.searchParams.get('uddg');
    if (target) return decodeURIComponent(target);
    if (parsed.hostname.endsWith('duckduckgo.com')) return '';
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function parseDdg(html: string): WebHit[] {
  const linkPattern =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetPattern = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  const links = [...html.matchAll(linkPattern)];
  const snippets = [...html.matchAll(snippetPattern)];
  const hits: WebHit[] = [];
  const seen = new Set<string>();

  links.forEach((link, index) => {
    const url = unwrapUrl(link[1]);
    if (!url) return;
    const title = decodeText(link[2]);
    if (!title) return;
    const key = url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({
      id: `web:${key.slice(0, 180)}`,
      title,
      url,
      snippet: snippets[index] ? decodeText(snippets[index][1]) : '',
      engine: 'ddg',
    });
  });

  return hits;
}

async function ddgOnce(query: string): Promise<WebHit[]> {
  const res = await webFetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
      Origin: 'https://html.duckduckgo.com',
      Referer: 'https://html.duckduckgo.com/',
    },
    body: `q=${encodeURIComponent(query)}&b=`,
  });
  if (!res.ok) throw new Error(`Web search returned ${res.status}.`);
  const html = await res.text();
  return parseDdg(html);
}

function unwrapYahoo(rawHref: string): string {
  const href = rawHref.replace(/&amp;/g, '&');
  const wrapped = href.match(/\/RU=([^/]+)/i);
  if (wrapped) {
    try {
      return decodeURIComponent(wrapped[1]);
    } catch {
      // Fall back to the original href.
    }
  }
  return href.startsWith('http') ? href : '';
}

function parseYahoo(html: string): WebHit[] {
  const pattern =
    /<a[^>]+data-matarget="algo"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  const hits: WebHit[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(pattern)) {
    const url = unwrapYahoo(match[1]);
    const title = decodeText(match[2]);
    if (!url || !title || !/^https?:/i.test(url)) continue;
    const key = url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const tail = html.slice(
      (match.index ?? 0) + match[0].length,
      (match.index ?? 0) + match[0].length + 2600,
    );
    const snippetMatch =
      tail.match(/<div[^>]+class="[^"]*compText[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ??
      tail.match(/<p[^>]+class="[^"]*fc-dustygray[^"]*"[^>]*>([\s\S]*?)<\/p>/i);

    hits.push({
      id: `web:${key.slice(0, 180)}`,
      title,
      url,
      snippet: snippetMatch ? decodeText(snippetMatch[1]) : '',
      engine: 'yahoo',
    });
    if (hits.length >= 8) break;
  }

  return hits;
}

async function yahooOnce(query: string): Promise<WebHit[]> {
  const res = await webFetch(
    `https://search.yahoo.com/search?p=${encodeURIComponent(query).replace(/%20/g, '+')}`,
    {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
    },
  );
  if (!res.ok) throw new Error(`Web search returned ${res.status}.`);
  const html = await res.text();
  return parseYahoo(html);
}

export async function searchWeb(query: string, fresh = false): Promise<CachedWebResult> {
  const key = `web:${hashKey(query.trim().toLowerCase())}`;
  if (!fresh) {
    const cached = await cacheGet<WebHit[]>(key);
    if (cached) return { hits: cached, cached: true };
  }

  let lastError: Error | null = null;

  const collect = async (): Promise<WebHit[]> => {
    const merged = new Map<string, WebHit>();
    const results = await Promise.allSettled([ddgOnce(query), yahooOnce(query)]);
    for (const result of results) {
      if (result.status === 'rejected') {
        lastError =
          result.reason instanceof Error ? result.reason : new Error(String(result.reason));
        continue;
      }
      for (const hit of result.value) {
        const key = hit.url.replace(/\/+$/, '').toLowerCase();
        if (!merged.has(key)) merged.set(key, hit);
      }
    }
    return [...merged.values()].slice(0, 8);
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await sleep(700);
    const hits = await collect();
    if (hits.length > 0) {
      await cacheSet(key, hits, WEB_TTL);
      return { hits, cached: false };
    }
  }

  if (lastError) throw lastError;
  throw new Error('General web search returned no results.');
}

interface HnHit {
  objectID?: string;
  title?: string;
  url?: string;
  points?: number;
  num_comments?: number;
  created_at?: string;
  story_text?: string;
}

export async function searchHN(query: string, fresh = false): Promise<CachedWebResult> {
  const key = `hn:${hashKey(query.trim().toLowerCase())}`;
  if (!fresh) {
    const cached = await cacheGet<WebHit[]>(key);
    if (cached) return { hits: cached, cached: true };
  }

  const res = await fetch(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=6`,
    { signal: AbortSignal.timeout(12_000) },
  );
  if (!res.ok) throw new Error(`Hacker News search returned ${res.status}.`);
  const data = (await res.json()) as { hits?: HnHit[] };

  const hits = (data.hits ?? [])
    .filter((hit) => Boolean(hit.title && hit.url) && (hit.points ?? 0) >= 5)
    .map((hit) => ({
      id: `hn:${hit.objectID ?? hit.title}`,
      title: decodeText(hit.title ?? ''),
      url: hit.url ?? '',
      snippet: decodeText(hit.story_text ?? '').slice(0, 300),
      engine: 'hn' as const,
      points: hit.points ?? 0,
      comments: hit.num_comments ?? 0,
      createdAt: hit.created_at,
    }))
    .filter((hit) => hit.url.startsWith('http'))
    .slice(0, 4);

  await cacheSet(key, hits, HN_TTL);
  return { hits, cached: false };
}
