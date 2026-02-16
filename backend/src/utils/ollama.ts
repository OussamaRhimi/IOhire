type OllamaChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type OllamaChatRequest = {
  model: string;
  messages: OllamaChatMessage[];
  stream?: boolean;
  format?: 'json';
  options?: Record<string, unknown>;
  keep_alive?: string | number;
};

type OllamaChatResponse = {
  message?: { role: string; content: string };
  response?: string;
  error?: string;
};

const DEFAULT_OLLAMA_URL = 'http://ollama:11434';

export async function ollamaChat(options: {
  system: string;
  user: string;
  format?: 'json';
  model?: string;
  timeoutMs?: number;
  ollamaOptions?: Record<string, unknown>;
  keepAlive?: string | number;
}): Promise<string> {
  const baseUrl = (process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL).replace(/\/$/, '');
  const model = options.model || process.env.OLLAMA_MODEL || 'llama3.2:3b';
  const timeoutMs = options.timeoutMs ?? 240_000;
  const keepAlive = options.keepAlive ?? process.env.OLLAMA_KEEP_ALIVE ?? '5m';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body: OllamaChatRequest = {
      model,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user },
      ],
      stream: false,
      options: {
        temperature: options.format === 'json' ? 0 : 0.2,
        ...(options.ollamaOptions ?? {}),
      },
      keep_alive: keepAlive,
      ...(options.format ? { format: options.format } : {}),
    };

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`Ollama error (${res.status}): ${raw}`);
    }

    const parsed = JSON.parse(raw) as OllamaChatResponse;
    const content = parsed.message?.content ?? parsed.response;
    if (!content) {
      throw new Error(`Ollama returned no content: ${raw}`);
    }
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}
