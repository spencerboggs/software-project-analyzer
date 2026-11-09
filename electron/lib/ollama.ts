// Ollama client. The host is user-configurable and defaults to loopback.
export interface ChatOptions {
  temperature?: number;
  numPredict?: number;
  numCtx?: number;
  formatJson?: boolean;
  timeoutMs?: number;
}

const THINKING_MODELS = /(qwen3|qwen3\.5|deepseek-r1|magistral|gpt-oss|qwq|phi4-reasoning)/i;

export function normalizeHost(host: string): string {
  let value = (host || '').trim();
  if (!value) value = 'http://127.0.0.1:11434';
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  value = value.replace(/\/+$/, '');
  if (value.toLowerCase().endsWith('/api')) value = value.slice(0, -4);
  return value;
}

export async function listModels(host: string): Promise<string[]> {
  const base = normalizeHost(host);
  let res: Response;
  try {
    res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new Error(`Can't reach Ollama at ${base}. Start it with "ollama serve".`);
  }
  if (!res.ok) throw new Error(`Ollama responded ${res.status} at ${base}.`);
  const data = (await res.json()) as { models?: Array<{ name?: string }> };
  return (data.models ?? [])
    .map((model) => (typeof model.name === 'string' ? model.name : ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export async function checkOllama(
  host: string,
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    return { ok: true, models: await listModels(host) };
  } catch (error) {
    return { ok: false, models: [], error: error instanceof Error ? error.message : String(error) };
  }
}

interface OllamaChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

async function readStream(res: Response, onChars?: (chars: number) => void): Promise<string> {
  if (!res.body) throw new Error('Ollama returned an empty response.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let chunk: OllamaChunk;
      try {
        chunk = JSON.parse(trimmed) as OllamaChunk;
      } catch {
        continue;
      }
      if (chunk.error) throw new Error(chunk.error);
      const piece = chunk.message?.content;
      if (piece) {
        text += piece;
        onChars?.(text.length);
      }
    }
  }

  const tail = buffer.trim();
  if (tail) {
    try {
      const chunk = JSON.parse(tail) as OllamaChunk;
      if (chunk.message?.content) text += chunk.message.content;
    } catch {
      // Ignore a trailing partial line at end of stream.
    }
  }
  return text;
}

function friendlyFetchError(base: string): Error {
  return new Error(
    `Can't reach Ollama at ${base}. Start it with "ollama serve" and make sure a model is installed.`,
  );
}

export async function chat(
  host: string,
  model: string,
  system: string,
  user: string,
  options: ChatOptions = {},
  onChars?: (chars: number) => void,
): Promise<string> {
  if (!model) throw new Error('No model selected. Open Settings and choose an Ollama model.');
  const base = normalizeHost(host);
  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    options: {
      temperature: options.temperature ?? 0.4,
      top_p: 0.95,
      num_ctx: options.numCtx ?? 8192,
      num_predict: options.numPredict ?? 1600,
    },
    keep_alive: '15m',
  };
  if (options.formatJson) body.format = 'json';
  if (THINKING_MODELS.test(model)) body.think = false;

  let lastTick = 0;
  const throttled =
    onChars === undefined
      ? undefined
      : (chars: number) => {
          const now = Date.now();
          if (now - lastTick < 220 && chars > 0) return;
          lastTick = now;
          onChars(chars);
        };

  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 600_000),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new Error('The model took too long. Try a smaller model or a shorter brief.');
    }
    throw friendlyFetchError(base);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 400).trim();
    if (res.status === 404) {
      throw new Error(`Model "${model}" isn't installed. Run: ollama pull ${model}`);
    }
    throw new Error(`Ollama error ${res.status}${detail ? `: ${detail}` : ''}`);
  }

  let text: string;
  try {
    text = await readStream(res, throttled);
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('The model took too long. Try a smaller model or a shorter brief.');
    }
    throw error;
  }

  if (!text.trim()) {
    throw new Error('The model returned an empty reply. Try again or switch models in Settings.');
  }
  return text;
}
