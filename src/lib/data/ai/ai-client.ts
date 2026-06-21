export type AiProvider = 'anthropic' | 'openai';

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
  } else {
    yield* streamOpenAi(opts, req);
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
