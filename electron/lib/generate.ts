// Local idea generation and normalization of model output.
import type { IdeaDraft, TechItem } from '../../shared/types';
import { chat } from './ollama';
import { parseJsonLoose } from './json';

export interface GenerationInput {
  themes: string;
  goals: string;
  stack: string;
  count: number;
  model: string;
  host: string;
  avoid: string[];
  onProgress: (stage: string, label: string, received?: number) => void;
}

const SYSTEM = `You are the idea engine inside SOFTWARE PROJECT ANALYZER, a private tool for product designers and engineers.
Your job is to produce genuinely distinct, buildable software ideas, not category labels and not clones of funded products.

Hard rules:
- Every idea is a specific product with a clear wedge, not "an app for X".
- Prefer unusual but practical combinations of a real workflow and software mechanics.
- Refuse cliches: no generic chatbot wrappers, todo/habit/journal trackers, "Uber/Airbnb for X", marketplaces that need two-sided liquidity on day one, or another analytics dashboard.
- Never propose blockchain, crypto, token, NFT or DAO products unless the brief explicitly asks for one.
- Each idea must be buildable by one to three people in 4 to 16 weeks.
- description: 3 to 5 plain sentences about what it does, the core mechanic, and why someone switches. No markdown, no emoji, no hype adjectives.
- oneLiner: under 140 characters, concrete.
- techStack: 3 to 6 concrete named technologies or services, each with the role it plays. If the brief supplies a stack, use it as the base and fill the gaps.
- coreFeatures: 4 to 6 short, buildable features.
- viability.score: an honest 0 to 100 estimate that a small team ships this and gets real usage. Penalize ideas that need proprietary data, network effects or heavy compliance. Do not inflate.
- knownProjects: only real products or repositories you are confident exist, not technologies, companies or service providers. Name them exactly. Use an empty array when unsure. Never invent names.
- Return ONE JSON object. No prose, no code fences.

Shape:
{"ideas":[{"title":"","oneLiner":"","description":"","techStack":[{"name":"","role":""}],"targetUser":"","coreFeatures":["","",""],"whyUnique":"","risks":["",""],"build":{"weeks":8,"difficulty":"medium","mvpScope":""},"viability":{"score":70,"notes":""},"knownProjects":[{"name":"","note":""}]}]}`;

function asText(value: unknown, max = 2000): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function asList(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? asText(item, 300) : ''))
    .filter(Boolean)
    .slice(0, max);
}

function asTech(value: unknown): TechItem[] {
  if (!Array.isArray(value)) return [];
  const items: TechItem[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      const name = asText(entry, 80);
      if (name) items.push({ name, role: '' });
      continue;
    }
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const name = asText(record.name ?? record.tech ?? record.tool, 80);
      const role = asText(record.role ?? record.why ?? record.purpose, 200);
      if (name) items.push({ name, role });
    }
    if (items.length >= 8) break;
  }
  return items;
}

function asKnownProjects(value: unknown): IdeaDraft['knownProjects'] {
  if (!Array.isArray(value)) return [];
  const items: IdeaDraft['knownProjects'] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      const name = asText(entry, 120);
      if (name) items.push({ name, note: '' });
      continue;
    }
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const name = asText(record.name ?? record.product ?? record.title, 120);
      const note = asText(record.note ?? record.why ?? record.description, 260);
      if (name) items.push({ name, note });
    }
    if (items.length >= 6) break;
  }
  return items;
}

function asDifficulty(value: unknown): 'low' | 'medium' | 'high' {
  const text = asText(value, 20).toLowerCase();
  if (text.startsWith('low') || text.startsWith('easy')) return 'low';
  if (text.startsWith('high') || text.startsWith('hard')) return 'high';
  return 'medium';
}

function asWeeks(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(asText(value, 20));
  if (!Number.isFinite(n)) return 8;
  return Math.min(52, Math.max(1, Math.round(n)));
}

function normalizeDraft(value: unknown): IdeaDraft | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const title = asText(record.title, 120);
  if (!title) return null;

  const oneLiner = asText(record.oneLiner ?? record.tagline ?? record.summary, 200);
  const description = asText(record.description ?? record.what ?? record.details, 2400) || oneLiner;
  const buildRaw =
    record.build && typeof record.build === 'object'
      ? (record.build as Record<string, unknown>)
      : {};
  const viabilityRaw =
    record.viability && typeof record.viability === 'object'
      ? (record.viability as Record<string, unknown>)
      : {};
  const scoreRaw = Number(viabilityRaw.score ?? record.score);
  const score = Number.isFinite(scoreRaw) ? Math.min(100, Math.max(0, Math.round(scoreRaw))) : 55;

  return {
    title,
    oneLiner: oneLiner || description.slice(0, 140),
    description,
    techStack: asTech(record.techStack ?? record.stack),
    targetUser: asText(record.targetUser ?? record.audience, 300),
    coreFeatures: asList(record.coreFeatures ?? record.features, 7),
    whyUnique: asText(record.whyUnique ?? record.differentiator, 700),
    risks: asList(record.risks, 5),
    build: {
      weeks: asWeeks(buildRaw.weeks ?? record.weeks),
      difficulty: asDifficulty(buildRaw.difficulty ?? record.difficulty),
      mvpScope: asText(buildRaw.mvpScope ?? record.mvpScope, 700),
    },
    viability: {
      score,
      notes: asText(viabilityRaw.notes ?? record.viabilityNotes, 700),
    },
    knownProjects: asKnownProjects(record.knownProjects ?? record.existing),
  };
}

function pickIdeas(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.ideas)) return record.ideas;
    if (record.title) return [record];
    if (Array.isArray(record.results)) return record.results;
  }
  return [];
}

function briefText(input: GenerationInput): string {
  const avoid = input.avoid
    .map((title) => title.replace(/\s+/g, ' ').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 40);

  return `BRIEF
themes: ${input.themes || 'open, but must be specific'}
goals: ${input.goals || 'buildable by a small team, useful to a real audience'}
tech stack: ${input.stack || 'none supplied. Choose a stack you can justify for each idea.'}
count: ${input.count}
${avoid.length ? `already in the workspace, avoid near-duplicates: ${avoid.join(' | ')}` : 'workspace is empty.'}

Return exactly ${input.count} idea${input.count === 1 ? '' : 's'} in the JSON shape described by the system message.`;
}

export async function generateIdeas(input: GenerationInput): Promise<IdeaDraft[]> {
  const attempts = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    input.onProgress('drafting', attempt === 0 ? 'Drafting ideas…' : 'Reshaping the reply into JSON…');
    try {
      const raw = await chat(
        input.host,
        input.model,
        SYSTEM,
        briefText(input),
        {
          temperature: attempt === 0 ? 0.9 : 0.35,
          numPredict: Math.min(4500, 1700 + input.count * 380),
          numCtx: 8192,
          formatJson: true,
          timeoutMs: 600_000,
        },
        (chars) => input.onProgress('drafting', 'Drafting ideas…', chars),
      );

      const parsed = parseJsonLoose<Record<string, unknown>>(raw);
      const drafts = pickIdeas(parsed)
        .map((item) => normalizeDraft(item))
        .filter((item): item is IdeaDraft => item !== null)
        .slice(0, input.count);

      if (drafts.length === 0) throw new Error('The model returned no usable ideas.');

      const seen = new Set<string>();
      const unique = drafts.filter((draft) => {
        const key = draft.title.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      input.onProgress('ready', `${unique.length} idea${unique.length === 1 ? '' : 's'} ready.`);
      return unique;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('Idea generation failed.');
}
