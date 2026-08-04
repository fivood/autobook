export type AiProvider = 'anthropic' | 'openai' | 'ollama';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiClientOpts {
  provider: AiProvider;
  apiKey: string;
  baseUrl?: string;
  model: string;
}

export interface StreamRequest {
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export async function* streamChat(
  opts: AiClientOpts,
  req: StreamRequest
): AsyncGenerator<string, void, void> {
  if (opts.provider === 'anthropic') {
    yield* streamAnthropic(opts, req);
  } else if (opts.provider === 'ollama') {
    yield* streamOllama(opts, req);
  } else {
    yield* streamOpenAi(opts, req);
  }
}

/**
 * One request, one string back. Short tasks — glossing a word, naming a
 * chapter, suggesting tags — have no use for streaming, and a plain awaited
 * call keeps their call sites free of generator plumbing.
 */
export async function chatOnce(
  opts: AiClientOpts,
  req: StreamRequest & { jsonMode?: boolean }
): Promise<string> {
  if (opts.provider === 'ollama') {
    const base = (opts.baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        ...(req.jsonMode ? { format: 'json' } : {}),
        options: { temperature: 0 },
        messages: [{ role: 'system', content: req.system }, ...req.messages]
      }),
      signal: req.signal
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await safeReadBody(res)}`);
    const data = await res.json();
    return String(data?.message?.content ?? data?.response ?? '').trim();
  }

  // Anthropic and OpenAI-compatible endpoints both stream cleanly, so the
  // simplest correct implementation is to drain the existing generator rather
  // than maintain a third pair of request shapes.
  let out = '';
  for await (const chunk of streamChat(opts, req)) out += chunk;
  return out.trim();
}

/**
 * Ollama streams newline-delimited JSON rather than SSE, so it needs its own
 * reader — parseSse would find no `data:` prefixes and yield nothing.
 */
async function* streamOllama(
  opts: AiClientOpts,
  req: StreamRequest
): AsyncGenerator<string, void, void> {
  const base = (opts.baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      messages: [{ role: 'system', content: req.system }, ...req.messages]
    }),
    signal: req.signal
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama ${res.status}: ${await safeReadBody(res)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const data = JSON.parse(line);
          const text = data?.message?.content;
          if (typeof text === 'string' && text) yield text;
          if (data?.done) return;
        } catch {
          // A partial line can arrive mid-chunk; the next read completes it.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function* streamAnthropic(
  opts: AiClientOpts,
  req: StreamRequest
): AsyncGenerator<string, void, void> {
  const base = opts.baseUrl?.replace(/\/$/, '') || 'https://api.anthropic.com';
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: req.maxTokens ?? 4096,
      system: req.system,
      stream: true,
      messages: req.messages
    }),
    signal: req.signal
  });
  if (!res.ok || !res.body) {
    throw new Error(`Anthropic ${res.status}: ${await safeReadBody(res)}`);
  }
  for await (const event of parseSse(res.body)) {
    if (event.event === 'content_block_delta') {
      try {
        const data = JSON.parse(event.data);
        const text = data?.delta?.text;
        if (typeof text === 'string') yield text;
      } catch {
        // ignore parse errors per event
      }
    } else if (event.event === 'message_stop') {
      return;
    } else if (event.event === 'error') {
      throw new Error(`Anthropic stream error: ${event.data}`);
    }
  }
}

async function* streamOpenAi(
  opts: AiClientOpts,
  req: StreamRequest
): AsyncGenerator<string, void, void> {
  const base = opts.baseUrl?.replace(/\/$/, '') || 'https://api.openai.com/v1';
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: req.system },
    ...req.messages
  ];
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey}`
    },
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      messages,
      max_tokens: req.maxTokens ?? 4096
    }),
    signal: req.signal
  });
  if (!res.ok || !res.body) {
    throw new Error(`OpenAI ${res.status}: ${await safeReadBody(res)}`);
  }
  for await (const event of parseSse(res.body)) {
    if (event.data === '[DONE]') return;
    try {
      const data = JSON.parse(event.data);
      const text = data?.choices?.[0]?.delta?.content;
      if (typeof text === 'string') yield text;
    } catch {
      // ignore
    }
  }
}

interface SseEvent {
  event: string;
  data: string;
}

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let currentEvent = 'message';
  let currentData = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        if (currentData) yield { event: currentEvent, data: currentData };
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (!line) {
          if (currentData) {
            yield { event: currentEvent, data: currentData };
          }
          currentEvent = 'message';
          currentData = '';
          continue;
        }
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          const chunk = line.slice(5).trimStart();
          currentData = currentData ? `${currentData}\n${chunk}` : chunk;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<no body>';
  }
}
