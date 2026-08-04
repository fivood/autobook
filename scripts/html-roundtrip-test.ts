import { exportHtmlAsMarkdownChunks, HtmlAdapter } from '../src/adapters/html.ts';

const adapter = new HtmlAdapter();
const source = '<article><h1>Hello</h1><p>Keep <strong>markup</strong>.</p><script>ignore()</script></article>';
const document = await adapter.extract({ sourcePath: 'demo.html', bytes: new TextEncoder().encode(source) });
if (document.segments.length !== 4) throw new Error(`Expected 4 HTML text nodes, got ${document.segments.length}.`);
const first = document.segments[0];
if (!first) throw new Error('Missing HTML segment.');
const bytes = await adapter.export(document, [{ segmentId: first.id, source: first.source, target: '你好' }]);
const output = new TextDecoder().decode(bytes);
if (!output.includes('<h1>你好</h1>') || !output.includes('<script>ignore()</script>')) {
  throw new Error('HTML markup or skipped script was not preserved.');
}
const chunks = exportHtmlAsMarkdownChunks(document, [{ segmentId: first.id, source: first.source, target: '你好' }], { maxChars: 12 });
if (chunks.length < 2 || !chunks[0]?.text.includes('你好')) throw new Error('Markdown chunk export failed.');
console.log(JSON.stringify({ format: document.format, segments: document.segments.length, chunks: chunks.length, output }));
