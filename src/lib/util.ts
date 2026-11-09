export interface Brief {
  themes: string;
  goals: string;
  stack: string;
  count: number;
}

export function uid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function pickDefaultModel(models: string[]): string {
  if (models.length === 0) return '';
  const preferences = [
    /^qwen3:8b$/i,
    /^qwen3:4b$/i,
    /^qwen3/i,
    /^gemma3:12b$/i,
    /^gemma3/i,
    /^llama3\.1:8b$/i,
    /^llama/i,
    /^mistral/i,
  ];
  for (const preference of preferences) {
    const found = models.find((model) => preference.test(model));
    if (found) return found;
  }
  return models[0];
}

export function promptSignature(brief: {
  themes: string;
  goals: string;
  stack: string;
  count: number;
}): string {
  return [brief.themes, brief.goals, brief.stack, String(brief.count)]
    .map((value) => value.trim().toLowerCase().replace(/\s+/g, ' '))
    .join('||');
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function shortDate(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: '2-digit', month: 'short' });
}

export function deriveTitle(text: string): string {
  const first = text.trim().split(/(?<=[.!?])\s|\n/)[0] ?? '';
  const clean = first.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Untitled idea';
  if (clean.length <= 90) return clean;
  return `${clean.slice(0, 87).trim()}…`;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
