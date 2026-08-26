export type AiProvider = 'anthropic' | 'openai' | 'ollama';

/**
 * How long the app waits on complete silence from a model endpoint before
 * giving up. Generous on purpose: Ollama loading a large model on the first
 * request legitimately takes a minute or more, and the clock resets on every
 * token, so this only fires when nothing at all is arriving.
 *
 * Every call here used to be unbounded. An endpoint that accepts the
 * connection and then stalls — a busy Ollama, a half-open proxy tunnel, a
 * cloud endpoint that hangs — left `await reader.read()` waiting forever:
 * the reader drawer spun with no error, and the batch jobs sat on "running"
 * with their abort controller still held, so no new run could start.
 */
const SILENCE_TIMEOUT_MS = 180_000;

/** Thrown when SILENCE_TIMEOUT_MS elapses with nothing arriving. */
export class AiTimeoutError extends Error {
  constructor(label: string, timeoutMs = SILENCE_TIMEOUT_MS) {
    super(
      `${label} 在 ${Math.round(timeoutMs / 1000)} 秒内没有任何响应。` +
        '请检查模型服务是否在运行、地址是否正确；本地模型首次加载较慢时可以稍后重试。'
    );
    this.name = 'AiTimeoutError';
  }
}

/**
 * Abort signal that fires on the caller's abort OR on silence.
 *
 * The distinction matters more than it looks: callers treat `AbortError` as
 * "the user cancelled" — the auto-tag job marks such a run *finished* rather
 * than failed. A timeout surfacing as a plain AbortError would therefore be
 * reported to the user as a successful, complete run.
 */
function silenceGuard(
  caller: AbortSignal | undefined,
  label: string,
  timeoutMs = SILENCE_TIMEOUT_MS
) {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const onCallerAbort = () => ctrl.abort();
  const bump = () => {
    if (timedOut) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);
  };

  if (caller?.aborted) ctrl.abort();
  else caller?.addEventListener('abort', onCallerAbort);
  bump();

  return {
    signal: ctrl.signal,
    bump,
    dispose() {
      clearTimeout(timer);
      caller?.removeEventListener('abort', onCallerAbort);
    },
    /** `err`, replaced by a timeout error when silence is what aborted it. */
    wrap(err: unknown): unknown {
      return timedOut ? new AiTimeoutError(label, timeoutMs) : err;
    }
  };
}

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
  /** Override the silence timeout. Only the test for it passes this. */
  silenceTimeoutMs?: number;
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
    const guard = silenceGuard(req.signal, 'Ollama', req.silenceTimeoutMs);
    try {
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
        signal: guard.signal
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}: ${await safeReadBody(res)}`);
      const data = await res.json();
      return String(data?.message?.content ?? data?.response ?? '').trim();
    } catch (err) {
      throw guard.wrap(err);
    } finally {
      guard.dispose();
    }
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
  const guard = silenceGuard(req.signal, 'Ollama', req.silenceTimeoutMs);
  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        stream: true,
        messages: [{ role: 'system', content: req.system }, ...req.messages]
      }),
      signal: guard.signal
    });
  } catch (err) {
    guard.dispose();
    throw guard.wrap(err);
  }
  if (!res.ok || !res.body) {
    guard.dispose();
    throw new Error(`Ollama ${res.status}: ${await safeReadBody(res)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      let value: Uint8Array | undefined;
      let done: boolean;
      try {
        ({ value, done } = await reader.read());
      } catch (err) {
        throw guard.wrap(err);
      }
      if (done) break;
      guard.bump();
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
    guard.dispose();
    reader.releaseLock();
  }
}

async function* streamAnthropic(
  opts: AiClientOpts,
  req: StreamRequest
): AsyncGenerator<string, void, void> {
  const base = opts.baseUrl?.replace(/\/$/, '') || 'https://api.anthropic.com';
  const guard = silenceGuard(req.signal, 'Anthropic', req.silenceTimeoutMs);
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
    signal: guard.signal
  }).catch((err) => {
    guard.dispose();
    throw guard.wrap(err);
  });
  if (!res.ok || !res.body) {
    guard.dispose();
    throw new Error(`Anthropic ${res.status}: ${await safeReadBody(res)}`);
  }
  try {
    for await (const event of parseSse(res.body, guard.bump)) {
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
  } catch (err) {
    throw guard.wrap(err);
  } finally {
    guard.dispose();
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
  const guard = silenceGuard(req.signal, 'OpenAI', req.silenceTimeoutMs);
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
    signal: guard.signal
  }).catch((err) => {
    guard.dispose();
    throw guard.wrap(err);
  });
  if (!res.ok || !res.body) {
    guard.dispose();
    throw new Error(`OpenAI ${res.status}: ${await safeReadBody(res)}`);
  }
  try {
    for await (const event of parseSse(res.body, guard.bump)) {
      if (event.data === '[DONE]') return;
      try {
        const data = JSON.parse(event.data);
        const text = data?.choices?.[0]?.delta?.content;
        if (typeof text === 'string') yield text;
      } catch {
        // ignore
      }
    }
  } catch (err) {
    throw guard.wrap(err);
  } finally {
    guard.dispose();
  }
}

interface SseEvent {
  event: string;
  data: string;
}

async function* parseSse(
  body: ReadableStream<Uint8Array>,
  /** Called on every chunk that arrives, to reset the silence clock. */
  onChunk?: () => void
): AsyncGenerator<SseEvent, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let currentEvent = 'message';
  let currentData = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      onChunk?.();
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
