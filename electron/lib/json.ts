// Local models sometimes wrap JSON in thinking blocks or code fences.
export function stripThinking(raw: string): string {
  let text = raw ?? '';
  text = text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, ' ');
  if (/<\/think>/i.test(text)) {
    text = text.split(/<\/think>/i).pop() ?? text;
  }
  return text.trim();
}

export function parseJsonLoose<T>(raw: string): T {
  const text = stripThinking(raw);
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]);
  const candidates = [...fenced, text];

  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    const slice = candidate.slice(start, end + 1);
    const variants = [slice, slice.replace(/,\s*([}\]])/g, '$1')];
    for (const variant of variants) {
      try {
        return JSON.parse(variant) as T;
      } catch {
        // Try the next candidate.
      }
    }
  }

  throw new Error('The model did not return valid JSON.');
}
