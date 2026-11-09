// Orchestrates query planning, public-source collection, and local model grading.
import type {
  Completeness,
  Finding,
  FindingSource,
  ResearchReport,
  Similarity,
  UsageLevel,
  Verdict,
  VerdictLevel,
} from '../../shared/types';
import { chat } from './ollama';
import { parseJsonLoose } from './json';
import { searchRepositories, type RepoHit } from './github';
import { searchHN, searchWeb, type WebHit } from './web';
import { cacheGet, cacheSet, hashKey } from './cache';

const QUERY_TTL = 7 * 24 * 60 * 60 * 1000;
const GRADE_TTL = 7 * 24 * 60 * 60 * 1000;

export interface ResearchInput {
  title: string;
  description: string;
  stack: string[];
  model: string;
  host: string;
  fresh?: boolean;
  githubToken?: string;
  onProgress: (stage: string, label: string, received?: number) => void;
}

interface Evidence {
  ref: number;
  source: FindingSource;
  name: string;
  url: string;
  description: string;
  snippet?: string;
  repo?: RepoHit;
  hit?: WebHit;
}

interface Assessment {
  ref?: number;
  similarity?: string;
  completeness?: string;
  note?: string;
}

interface Synthesis {
  findings?: Assessment[];
  verdict?: {
    level?: string;
    summary?: string;
    gaps?: unknown;
    angles?: unknown;
  };
}

const QUERY_SYSTEM = `You turn a software idea into search queries that find existing products, open-source projects and discussions that already do something similar.
Return JSON only:
{"queries":["..."],"keywords":["..."]}

Rules:
- 4 queries maximum. Each is 2 to 6 plain words. No quotes, no boolean operators, no site: filters.
- Cover the product category, the core mechanic, the target user's job, and an open-source or self-hosted angle.
- Queries must be generic enough to match work that is not named after the idea.
- keywords: 6 distinctive nouns from the idea.`;

const ANALYST_SYSTEM = `You are a project analyst for software ideas. You receive an idea and numbered EVIDENCE entries collected from GitHub, general web search and Hacker News.
Judge only from the evidence. Never invent products, URLs or numbers.

Return JSON only:
{"findings":[{"ref":1,"similarity":"direct|adjacent|loose","completeness":"production|beta|prototype|abandoned|unknown","note":"one or two sentences"}],"verdict":{"level":"open|differentiated|crowded","summary":"3 sentences max","gaps":[""],"angles":[""]}}

Rules:
- Only cite refs that exist in the evidence.
- direct = same job, same core mechanic, same audience. adjacent = overlapping job or mechanic. loose = same space only.
- If a result is an article, shop page, personal site or directory rather than working software, mark similarity "loose" and completeness "unknown".
- Never call a website "production" unless it is a shipped software product.
- production = shipped, usable, signs of maintenance. beta = usable but early or lightly maintained. prototype = demo or experiment. abandoned = archived, or no release or activity for two years. unknown = not enough evidence.
- The supplied stars, dates, points and owner types are factual. Use them. Do not restate numbers in notes.
- verdict.level: crowded when a direct match has real usage; differentiated when adjacent matches exist but no direct one; open when nothing similar surfaced.
- gaps and angles: 2 to 4 each, specific to this idea. No generic advice.
- Plain text notes, no markdown.`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function asText(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function asList(value: unknown, max = 4): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? asText(item, 260) : ''))
    .filter(Boolean)
    .slice(0, max);
}

function normalizeQueries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const queries: string[] = [];
  for (const entry of value) {
    const raw =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? (entry as Record<string, unknown>).q
          : '';
    const query = asText(raw, 90).replace(/["'()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (query.length >= 3 && query.split(' ').length <= 8) queries.push(query);
    if (queries.length >= 4) break;
  }
  return [...new Set(queries)];
}

const STOP = new Set([
  'app',
  'apps',
  'application',
  'platform',
  'tool',
  'tools',
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
  'this',
  'they',
  'their',
  'them',
  'what',
  'when',
  'where',
  'which',
  'while',
  'will',
  'would',
  'could',
  'should',
  'about',
  'also',
  'have',
  'more',
  'than',
  'then',
  'each',
  'every',
  'because',
  'small',
  'real',
  'able',
]);

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOP.has(word)),
  );
}

function heuristicQueries(input: ResearchInput): string[] {
  const words = [...tokenSet(`${input.title} ${input.description}`)].slice(0, 12);
  const titleWords = input.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(' ');
  return [
    titleWords,
    words.slice(0, 3).join(' '),
    words.slice(2, 5).join(' '),
    `open source ${words.slice(0, 2).join(' ')}`,
  ]
    .map((query) => query.trim())
    .filter((query) => query.length > 2);
}

async function planQueries(
  input: ResearchInput,
  fresh: boolean,
): Promise<{ queries: string[]; cached: boolean }> {
  const key = `queries:${input.host}:${input.model}:${hashKey(
    `${input.title}|${input.description.slice(0, 2400)}|${input.stack.join(',')}`,
  )}`;

  if (!fresh) {
    const cached = await cacheGet<string[]>(key);
    if (Array.isArray(cached) && cached.length > 0) return { queries: cached, cached: true };
  }

  const user = `TITLE: ${input.title}
IDEA: ${input.description.slice(0, 1600)}
STACK: ${input.stack.join(', ') || 'unspecified'}`;

  let queries: string[] = [];
  try {
    const raw = await chat(input.host, input.model, QUERY_SYSTEM, user, {
      temperature: 0.2,
      numPredict: 400,
      numCtx: 4096,
      formatJson: true,
      timeoutMs: 180_000,
    });
    const parsed = parseJsonLoose<Record<string, unknown>>(raw);
    queries = normalizeQueries(parsed.queries);
  } catch {
    // Use local heuristics when the model cannot provide a query plan.
  }

  const finalQueries = queries.length > 0 ? queries : heuristicQueries(input);
  if (finalQueries.length > 0) await cacheSet(key, finalQueries, QUERY_TTL);
  return { queries: finalQueries, cached: false };
}

function expandQueries(base: string[], input: ResearchInput, budget: number): string[] {
  const unique = new Map<string, string>();
  const add = (raw: string) => {
    const query = asText(raw, 90).replace(/["'()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (query.length < 3 || query.split(' ').length > 8) return;
    const key = query.toLowerCase();
    if (!unique.has(key)) unique.set(key, query);
  };

  base.forEach(add);
  if (unique.size < budget) {
    const words = [...tokenSet(`${input.title} ${input.description}`)]
      .filter((word) => word.length > 3)
      .slice(0, 10);
    const titleWords = input.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .join(' ');
    const stack = input.stack
      .map((item) => item.replace(/[^a-z0-9.+#-]/gi, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const candidates = [
      `${words[0] ?? ''} ${words[1] ?? ''}`,
      `${words[0] ?? ''} ${words[1] ?? ''} open source`,
      `${words[1] ?? ''} ${words[2] ?? ''} ${words[3] ?? ''}`,
      `${words[0] ?? ''} ${words[4] ?? ''} ${words[5] ?? ''}`,
      `${stack[0] ?? ''} ${words[0] ?? ''}`,
      `${stack[1] ?? ''} ${words[1] ?? ''}`,
      `${titleWords} alternative`,
      `${words[2] ?? ''} ${words[3] ?? ''} library`,
    ];

    for (const candidate of candidates) {
      add(candidate);
      if (unique.size >= budget) break;
    }
  }

  return [...unique.values()].slice(0, budget);
}

function monthsSince(iso?: string): number {
  if (!iso) return 999;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 999;
  return (Date.now() - then) / (1000 * 60 * 60 * 24 * 30.4);
}

function githubUsage(repo: RepoHit): UsageLevel {
  if (repo.stars >= 8000 || (repo.ownerType === 'Organization' && repo.stars >= 2000)) return 'major';
  if (repo.stars >= 800) return 'notable';
  if (repo.stars >= 80) return 'niche';
  return 'low';
}

function hnUsage(hit: WebHit): UsageLevel {
  const points = hit.points ?? 0;
  if (points >= 200) return 'major';
  if (points >= 60) return 'notable';
  if (points >= 15) return 'niche';
  return 'low';
}

function usageFor(evidence: Evidence): UsageLevel {
  if (evidence.repo) return githubUsage(evidence.repo);
  if (evidence.source === 'hn' && evidence.hit) return hnUsage(evidence.hit);
  return 'unknown';
}

function heuristicCompleteness(evidence: Evidence): Completeness {
  if (!evidence.repo) return 'unknown';
  const repo = evidence.repo;
  const months = monthsSince(repo.pushedAt);
  if (repo.archived || months > 30) return 'abandoned';
  if (repo.stars >= 1000 && months <= 9) return 'production';
  if (repo.stars >= 100 && months <= 18) return 'beta';
  if (months > 18) return 'abandoned';
  return 'prototype';
}

function normalizeCompleteness(value: unknown): Completeness | null {
  const text = asText(value, 20).toLowerCase();
  if (text === 'production' || text === 'beta' || text === 'prototype' || text === 'abandoned') {
    return text;
  }
  if (text === 'unknown') return 'unknown';
  return null;
}

function normalizeSimilarity(value: unknown): Similarity | null {
  const text = asText(value, 20).toLowerCase();
  if (text === 'direct' || text === 'adjacent' || text === 'loose') return text;
  return null;
}

function normalizeLevel(value: unknown): VerdictLevel | null {
  const text = asText(value, 20).toLowerCase();
  if (text === 'open' || text === 'differentiated' || text === 'crowded') return text;
  return null;
}

function evidenceText(evidence: Evidence): string {
  const parts = [evidence.description, evidence.snippet ?? ''];
  if (evidence.repo?.readme) parts.push(`README: ${evidence.repo.readme}`);
  return parts.filter(Boolean).join(' ').slice(0, 900);
}

function toFinding(evidence: Evidence, assessment: Assessment | undefined): Finding {
  const note = asText(assessment?.note, 400) || asText(evidence.description, 220);
  const finding: Finding = {
    id: evidence.repo?.id ?? evidence.hit?.id ?? `${evidence.source}:${evidence.ref}`,
    ref: evidence.ref,
    name: evidence.name,
    url: evidence.url,
    source: evidence.source,
    description: asText(evidence.description, 320),
    snippet: evidence.snippet ? asText(evidence.snippet, 320) : undefined,
    completeness:
      normalizeCompleteness(assessment?.completeness) ?? heuristicCompleteness(evidence),
    usage: usageFor(evidence),
    similarity: normalizeSimilarity(assessment?.similarity) ?? 'loose',
    note,
    stars: evidence.repo?.stars,
    forks: evidence.repo?.forks,
    points: evidence.hit?.points,
    comments: evidence.hit?.comments,
    lastPush: evidence.repo?.pushedAt,
    createdAt: evidence.repo?.createdAt ?? evidence.hit?.createdAt,
    owner: evidence.repo?.owner ?? (evidence.hit?.url ? safeDomain(evidence.hit.url) : undefined),
    orgBacked: evidence.repo?.ownerType === 'Organization',
    archived: evidence.repo?.archived,
    language: evidence.repo?.language,
    readme: evidence.repo?.readme,
  };
  return finding;
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function fallbackSimilarity(evidence: Evidence, ideaTokens: Set<string>): Similarity {
  const tokens = tokenSet(`${evidence.name} ${evidence.description}`);
  let overlap = 0;
  for (const token of tokens) if (ideaTokens.has(token)) overlap += 1;
  return overlap >= 3 ? 'adjacent' : 'loose';
}

function sortFindings(findings: Finding[]): Finding[] {
  const similarityRank: Record<Similarity, number> = { direct: 0, adjacent: 1, loose: 2 };
  const usageRank: Record<UsageLevel, number> = {
    major: 0,
    notable: 1,
    niche: 2,
    low: 3,
    unknown: 4,
  };
  return [...findings].sort((a, b) => {
    const bySimilarity = similarityRank[a.similarity] - similarityRank[b.similarity];
    if (bySimilarity !== 0) return bySimilarity;
    const byUsage = usageRank[a.usage] - usageRank[b.usage];
    if (byUsage !== 0) return byUsage;
    return (b.stars ?? b.points ?? 0) - (a.stars ?? a.points ?? 0);
  });
}

function deriveLevel(findings: Finding[]): VerdictLevel {
  const hasDirect = findings.some((finding) => finding.similarity === 'direct');
  const directWithRealUsage = findings.some(
    (finding) =>
      finding.similarity === 'direct' &&
      (finding.usage === 'major' || finding.usage === 'notable'),
  );
  if (directWithRealUsage) return 'crowded';
  if (hasDirect || findings.some((finding) => finding.similarity === 'adjacent')) {
    return 'differentiated';
  }
  return 'open';
}

const LEVEL_WEIGHT: Record<VerdictLevel, number> = { open: 0, differentiated: 1, crowded: 2 };

function buildVerdict(raw: Synthesis['verdict'], findings: Finding[]): Verdict {
  const rawLevel = normalizeLevel(raw?.level);
  const evidenceLevel = deriveLevel(findings);
  const modelLevel = rawLevel ?? evidenceLevel;
  const level =
    LEVEL_WEIGHT[evidenceLevel] > LEVEL_WEIGHT[modelLevel] ? evidenceLevel : modelLevel;

  const direct = findings.filter((finding) => finding.similarity === 'direct').length;
  const adjacent = findings.filter((finding) => finding.similarity === 'adjacent').length;

  const fallbackSummary: Record<VerdictLevel, string> = {
    open:
      'No direct match surfaced in this evidence. That is a starting point, not a guarantee that the idea does not exist.',
    differentiated: `${direct} direct and ${adjacent} adjacent matches surfaced. There is room, but the general shape is taken.`,
    crowded: `${Math.max(1, direct)} direct matches with real usage surfaced. Assume you are entering an occupied category.`,
  };

  const summary = asText(raw?.summary, 700) || fallbackSummary[level];
  const gaps = asList(raw?.gaps, 4);
  const angles = asList(raw?.angles, 4);

  return {
    level,
    summary,
    gaps: gaps.length ? gaps : fallbackGaps(level, findings),
    angles: angles.length ? angles : fallbackAngles(level),
  };
}

function fallbackGaps(level: VerdictLevel, findings: Finding[]): string[] {
  const named = findings[0]?.name ? ` ${findings[0].name}` : '';
  if (level === 'open') {
    return ['Nothing surfaced, so the risk is demand, not competition. Validate the workflow with five users before building.'];
  }
  return [
    `Existing tools${named ? ` such as${named}` : ''} were not built for this exact audience. Own the niche workflow they skip.`,
    'Undercut the setup cost: ship a single-purpose tool that works in minutes, not a suite.',
  ];
}

function fallbackAngles(level: VerdictLevel): string[] {
  if (level === 'open') {
    return [
      'Prove the job exists: interview five people who currently use spreadsheets or paper.',
      'Ship the narrowest useful slice and charge from day one if the audience is professional.',
    ];
  }
  return [
    'Target the segment the incumbents price out or ignore.',
    'Differentiate on workflow, not on feature count.',
  ];
}

export async function researchIdea(input: ResearchInput): Promise<ResearchReport> {
  const notices: string[] = [];
  const addNotice = (message: string) => {
    if (message && !notices.includes(message)) notices.push(message);
  };

  input.onProgress('queries', 'Reading the idea and planning searches…');
  const planned = await planQueries(input, Boolean(input.fresh));
  const queries = planned.queries;
  let cacheHits = planned.cached ? 1 : 0;
  if (queries.length === 0) throw new Error('Could not build search queries from that idea.');

  const githubBudget = input.githubToken ? 10 : 3;
  const githubQueries = expandQueries(queries, input, githubBudget);
  input.onProgress('github', 'Searching GitHub repositories…');
  const repoSearch = await searchRepositories(githubQueries, addNotice, {
    token: input.githubToken,
    maxQueries: githubBudget,
    fresh: input.fresh,
  });
  cacheHits += repoSearch.cacheHits;

  input.onProgress('web', 'Scanning general web results…');
  const web: WebHit[] = [];
  let webFailures = 0;
  for (let index = 0; index < Math.min(3, queries.length); index += 1) {
    if (index > 0) await sleep(700);
    try {
      const result = await searchWeb(queries[index], input.fresh);
      web.push(...result.hits);
      if (result.cached) cacheHits += 1;
      webFailures = 0;
    } catch (error) {
      webFailures += 1;
      if (index === 0) {
        addNotice(
          error instanceof Error
            ? `${error.message} GitHub and Hacker News results are still included.`
            : 'General web search failed. GitHub and Hacker News results are still included.',
        );
      }
      if (webFailures >= 2) break;
    }
  }

  input.onProgress('hn', 'Checking Hacker News launches and discussions…');
  let hn: WebHit[] = [];
  try {
    const result = await searchHN(queries[0] ?? input.title, input.fresh);
    hn = result.hits;
    if (result.cached) cacheHits += 1;
  } catch {
    addNotice('Hacker News search failed.');
  }

  const seenUrls = new Set<string>();
  const webUnique: WebHit[] = [];
  for (const hit of web) {
    const key = hit.url.replace(/\/+$/, '').toLowerCase();
    if (seenUrls.has(key) || /github\.com/i.test(hit.url)) continue;
    seenUrls.add(key);
    webUnique.push(hit);
    if (webUnique.length >= 8) break;
  }
  const hnUnique: WebHit[] = [];
  for (const hit of hn) {
    const key = hit.url.replace(/\/+$/, '').toLowerCase();
    if (seenUrls.has(key) || /github\.com/i.test(hit.url)) continue;
    seenUrls.add(key);
    hnUnique.push(hit);
    if (hnUnique.length >= 4) break;
  }

  const evidence: Evidence[] = [];
  let ref = 1;
  for (const repo of repoSearch.hits.slice(0, 10)) {
    evidence.push({
      ref: ref++,
      source: 'github',
      name: repo.fullName,
      url: repo.url,
      description: repo.description,
      repo,
    });
  }
  for (const hit of webUnique) {
    evidence.push({
      ref: ref++,
      source: 'web',
      name: hit.title,
      url: hit.url,
      description: hit.snippet,
      snippet: hit.snippet,
      hit,
    });
  }
  for (const hit of hnUnique) {
    evidence.push({
      ref: ref++,
      source: 'hn',
      name: hit.title,
      url: hit.url,
      description: hit.snippet,
      snippet: hit.snippet,
      hit,
    });
  }

  let findings: Finding[] = [];
  let verdict: Verdict | null = null;
  let assessed = false;

  if (evidence.length > 0) {
    input.onProgress('assessing', 'Weighing the evidence…');

    const packed = evidence.map((item) => ({
      ref: item.ref,
      source: item.source,
      name: item.name,
      url: item.url,
      stars: item.repo?.stars,
      forks: item.repo?.forks,
      pushed: item.repo?.pushedAt?.slice(0, 10),
      created: item.repo?.createdAt?.slice(0, 10),
      archived: item.repo?.archived,
      ownerType: item.repo?.ownerType,
      language: item.repo?.language,
      points: item.hit?.points,
      comments: item.hit?.comments,
      text: evidenceText(item),
    }));

    const user = `IDEA
title: ${input.title}
what it is: ${input.description.slice(0, 1800)}
stack: ${input.stack.join(', ') || 'unspecified'}

EVIDENCE
${JSON.stringify(packed)}`;

    const assessmentKey = `assessment:${input.host}:${input.model}:${hashKey(
      JSON.stringify({
        title: input.title,
        description: input.description,
        stack: input.stack,
        evidence: packed,
      }),
    )}`;

    try {
      let parsed: Synthesis | null = null;
      if (!input.fresh) {
        const cached = await cacheGet<Synthesis>(assessmentKey);
        if (cached) {
          parsed = cached;
          cacheHits += 1;
        }
      }
      if (!parsed) {
        const raw = await chat(input.host, input.model, ANALYST_SYSTEM, user, {
          temperature: 0.1,
          numPredict: 2000,
          numCtx: 8192,
          formatJson: true,
          timeoutMs: 360_000,
        });
        parsed = parseJsonLoose<Synthesis>(raw);
        await cacheSet(assessmentKey, parsed, GRADE_TTL);
      }
      const assessments = Array.isArray(parsed.findings) ? parsed.findings : [];
      const byRef = new Map<number, Assessment>();
      for (const assessment of assessments) {
        const key = Number(assessment?.ref);
        if (Number.isInteger(key)) byRef.set(key, assessment);
      }

      findings = evidence
        .filter((item) => byRef.has(item.ref))
        .map((item) => toFinding(item, byRef.get(item.ref)));

      if (findings.length > 0) {
        verdict = buildVerdict(parsed.verdict, findings);
        assessed = true;
      }
    } catch (error) {
      addNotice(
        error instanceof Error
          ? `Model assessment failed (${error.message}). Showing raw matches instead.`
          : 'Model assessment failed. Showing raw matches instead.',
      );
    }
  }

  if (!assessed) {
    const ideaTokens = tokenSet(`${input.title} ${input.description}`);
    findings = evidence.map((item) => {
      const finding = toFinding(item, {
        similarity: fallbackSimilarity(item, ideaTokens),
        note: item.description || item.snippet || 'Match returned by search.',
      });
      return finding;
    });
  }

  findings = sortFindings(findings).slice(0, 14);

  if (!verdict) {
    verdict = buildVerdict(undefined, findings);
  }

  if (evidence.length === 0) {
    addNotice('No matches came back from the searches. Try a more literal description.');
  }

  input.onProgress('ready', 'Report ready.');
  return {
    createdAt: Date.now(),
    model: input.model,
    queries: githubQueries,
    findings,
    verdict,
    notices,
    assessed,
    cacheHits,
    githubQueries: repoSearch.queriesUsed,
  };
}
