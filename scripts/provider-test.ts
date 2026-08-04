import { OllamaProvider } from '../dist/providers/ollama.js';

const segments = [
  { id: 'a', documentId: 'doc', filePath: 'chapter.xhtml', start: 0, end: 1, source: 'A', kind: 'text' as const, contextPath: 'body' },
  { id: 'b', documentId: 'doc', filePath: 'chapter.xhtml', start: 1, end: 2, source: 'B', kind: 'text' as const, contextPath: 'body' }
];
const request = { model: 'test', sourceLanguage: 'en', targetLanguage: 'zh-CN', segments, glossary: [] };

const splittingProvider = new OllamaProvider({
  fetchImpl: async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    const input = JSON.parse(payload.messages[1].content) as Array<{ id: string }>;
    const content = input.length > 1
      ? '模型这次没有按 JSON 输出'
      : JSON.stringify({ translations: [{ id: input[0]?.id, text: `译文-${input[0]?.id}` }] });
    return new Response(JSON.stringify({ message: { content } }), { status: 200 });
  }
});
const splitResults = await splittingProvider.translate(request);
if (splitResults.length !== 2 || splitResults[0]?.target !== '译文-a' || splitResults[1]?.target !== '译文-b') {
  throw new Error('Ollama batch fallback did not split and recover the request.');
}

const fallbackProvider = new OllamaProvider({
  fetchImpl: async () => new Response(JSON.stringify({ message: { content: '单段临时译文' } }), { status: 200 })
});
const fallbackResults = await fallbackProvider.translate({ ...request, segments: [segments[0]!] });
if (fallbackResults[0]?.target !== '单段临时译文') throw new Error('Ollama single-segment fallback did not preserve text.');

console.log(JSON.stringify({ status: 'ok', split: splitResults.length, singleFallback: fallbackResults[0]?.target }));
