import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AiTimeoutError, chatOnce, streamChat } from '../src/lib/data/ai/ai-client.ts';

/**
 * Every model call used to be unbounded. An endpoint that accepts the
 * connection and then stalls left the read waiting forever: the reader drawer
 * spun with no error, and the batch jobs sat on "running" holding their abort
 * controller so no new run could start.
 *
 * The second half of the fix matters as much as the first. Callers read
 * `AbortError` as "the user cancelled" — auto-tag-job marks such a run
 * *finished*, not failed — so a timeout that surfaced as a bare AbortError
 * would be reported to the user as a complete, successful run. The timeout
 * gets its own error type, and the last test here is what pins that.
 */

/** A server that accepts the request and then says nothing at all. */
function silentServer(afterConnect?: (res: http.ServerResponse) => void) {
  const held: http.ServerResponse[] = [];
  const server = http.createServer((_req, res) => {
    held.push(res);
    afterConnect?.(res);
    // Never end the response.
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            for (const res of held) res.destroy();
            server.close(() => done());
          })
      });
    });
  });
}

test('a server that never responds fails instead of hanging', async () => {
  const server = await silentServer();
  try {
    const started = Date.now();
    await assert.rejects(
      chatOnce(
        { provider: 'ollama', apiKey: '', baseUrl: server.url, model: 'test' },
        { system: 's', messages: [{ role: 'user', content: 'hi' }], silenceTimeoutMs: 300 }
      ),
      (err: unknown) => err instanceof AiTimeoutError
    );
    assert.ok(Date.now() - started < 5000, 'should give up promptly, not hang');
  } finally {
    await server.close();
  }
});

test('a stream that opens then goes silent also times out', async () => {
  // Headers and one event arrive, then nothing — the failure a connect-only
  // timeout would miss entirely.
  const server = await silentServer((res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"hel"}}]}\n\n');
  });
  try {
    const chunks: string[] = [];
    await assert.rejects(
      (async () => {
        for await (const chunk of streamChat(
          { provider: 'openai', apiKey: 'k', baseUrl: server.url, model: 'test' },
          { system: 's', messages: [{ role: 'user', content: 'hi' }], silenceTimeoutMs: 300 }
        )) {
          chunks.push(chunk);
        }
      })(),
      (err: unknown) => err instanceof AiTimeoutError
    );
    assert.deepEqual(chunks, ['hel'], 'what did arrive should still have been yielded');
  } finally {
    await server.close();
  }
});

test('a user abort stays an AbortError and is not reported as a timeout', async () => {
  const server = await silentServer();
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 100);
    await assert.rejects(
      chatOnce(
        { provider: 'ollama', apiKey: '', baseUrl: server.url, model: 'test' },
        {
          system: 's',
          messages: [{ role: 'user', content: 'hi' }],
          signal: ctrl.signal,
          silenceTimeoutMs: 60_000
        }
      ),
      (err: unknown) => {
        assert.ok(!(err instanceof AiTimeoutError), 'a cancel must not look like a timeout');
        assert.equal((err as Error).name, 'AbortError');
        return true;
      }
    );
  } finally {
    await server.close();
  }
});
