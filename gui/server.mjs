import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import {
  EpubAdapter,
  HtmlAdapter,
  OllamaProvider,
  OpenAICompatibleProvider,
  TextAdapter,
  createJob,
  extractGlossaryCandidates,
  pendingSegments,
  recordTranslationResults,
  setJobStatus,
  translateInBatches,
  validateTranslationJob
} from '../dist/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUI_DIR = path.join(ROOT, 'gui');
const DATA_DIR = path.join(ROOT, 'gui-data');
const PORT = Number(process.env.TRANSLATOR_GUI_PORT || 5274);
const MAX_BODY_BYTES = 80 * 1024 * 1024;
const runtimes = new Map();

await fs.mkdir(DATA_DIR, { recursive: true });

function json(response, value, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function fail(response, error, status = 500) {
  json(response, { error: error instanceof Error ? error.message : String(error) }, status);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error(`请求体超过 ${Math.round(MAX_BODY_BYTES / 1024 / 1024)} MB 限制。`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(request) {
  try { return JSON.parse(await readBody(request) || '{}'); } catch { throw new Error('请求 JSON 无效。'); }
}

function adapterForFilename(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.epub') return { adapter: new EpubAdapter(), format: 'epub', outputExtension: '.epub' };
  if (extension === '.html' || extension === '.htm') return { adapter: new HtmlAdapter(), format: 'html', outputExtension: '.html' };
  if (extension === '.md' || extension === '.markdown') return { adapter: new TextAdapter('markdown'), format: 'markdown', outputExtension: extension };
  if (extension === '.txt' || extension === '.text') return { adapter: new TextAdapter('txt'), format: 'txt', outputExtension: '.txt' };
  throw new Error('当前 GUI 支持 EPUB、HTML、TXT 和 Markdown 文件。');
}

function checkpointPath(id) { return path.join(DATA_DIR, `${id}.json`); }
function sourcePath(id, filename) { return path.join(DATA_DIR, `${id}.source${path.extname(filename).toLowerCase() || '.bin'}`); }

function checkpointFromRuntime(runtime) {
  const { job } = runtime;
  return {
    version: 1, id: job.id, sourceName: runtime.sourceName, sourceFile: runtime.sourceFile,
    format: runtime.format, outputExtension: runtime.outputExtension, model: runtime.model,
    sourceLanguage: job.sourceLanguage, targetLanguage: job.targetLanguage,
    totalSegments: job.document.segments.length, glossary: job.glossary,
    translations: job.translations, completedSegmentIds: job.completedSegmentIds,
    status: job.status, error: job.error, createdAt: job.createdAt, updatedAt: job.updatedAt,
    candidates: runtime.candidates,
    precisionTranslations: runtime.precisionTranslations,
    precisionCompletedSegmentIds: runtime.precisionCompletedSegmentIds,
    precisionStatus: runtime.precisionStatus,
    precisionError: runtime.precisionError,
    precisionBaseUrl: runtime.precisionBaseUrl,
    precisionModel: runtime.precisionModel
  };
}

async function saveRuntime(runtime) {
  const previous = runtime.savePromise || Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const target = checkpointPath(runtime.job.id);
    const temporary = `${target}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(checkpointFromRuntime(runtime), null, 2), 'utf8');
    await fs.rename(temporary, target);
  });
  runtime.savePromise = next;
  try { await next; } finally { if (runtime.savePromise === next) runtime.savePromise = undefined; }
}

function summary(runtime) {
  const { job } = runtime;
  return {
    id: job.id, sourceName: runtime.sourceName, format: runtime.format, model: runtime.model,
    sourceLanguage: job.sourceLanguage, targetLanguage: job.targetLanguage, status: job.status,
    completed: job.completedSegmentIds.length, total: job.document.segments.length,
    glossaryCount: job.glossary.filter((entry) => entry.approved).length,
    candidates: runtime.candidates, glossary: job.glossary, error: job.error || null,
    createdAt: job.createdAt, updatedAt: job.updatedAt,
    precision: {
      status: runtime.precisionStatus,
      completed: runtime.precisionCompletedSegmentIds.length,
      total: job.document.segments.length,
      baseUrl: runtime.precisionBaseUrl || '',
      model: runtime.precisionModel || '',
      error: runtime.precisionError || null
    }
  };
}

async function createRuntime(payload) {
  const sourceName = path.basename(String(payload.name || 'source.txt'));
  if (!payload.bytesBase64) throw new Error('没有收到文件内容。');
  const bytes = new Uint8Array(Buffer.from(String(payload.bytesBase64), 'base64'));
  const { adapter, format, outputExtension } = adapterForFilename(sourceName);
  const id = randomUUID();
  const document = await adapter.extract({ sourcePath: sourceName, bytes });
  const sourceFile = sourcePath(id, sourceName);
  await fs.writeFile(sourceFile, bytes);
  const job = createJob(id, document, String(payload.sourceLanguage || document.sourceLanguage || 'en'), String(payload.targetLanguage || 'zh-CN'), []);
  const candidates = extractGlossaryCandidates(document.segments, { minOccurrences: 2, maxCandidates: 80 });
  const runtime = {
    job, sourceName, sourceFile, format, outputExtension, model: String(payload.model || 'qwen2.5:14b'), candidates,
    controller: undefined, precisionController: undefined, savePromise: undefined, adapter,
    precisionTranslations: {}, precisionCompletedSegmentIds: [], precisionStatus: 'idle', precisionError: undefined,
    precisionBaseUrl: '', precisionModel: ''
  };
  runtimes.set(id, runtime);
  await saveRuntime(runtime);
  return runtime;
}

async function loadRuntime(id) {
  if (runtimes.has(id)) return runtimes.get(id);
  const checkpoint = JSON.parse(await fs.readFile(checkpointPath(id), 'utf8'));
  const sourceName = path.basename(String(checkpoint.sourceName || 'source.txt'));
  const sourceFile = String(checkpoint.sourceFile || sourcePath(id, sourceName));
  const bytes = new Uint8Array(await fs.readFile(sourceFile));
  const { adapter, format, outputExtension } = adapterForFilename(sourceName);
  const document = await adapter.extract({ sourcePath: sourceName, bytes });
  const job = createJob(String(checkpoint.id || id), document, String(checkpoint.sourceLanguage || document.sourceLanguage || 'en'), String(checkpoint.targetLanguage || 'zh-CN'), Array.isArray(checkpoint.glossary) ? checkpoint.glossary : []);
  job.translations = checkpoint.translations && typeof checkpoint.translations === 'object' ? checkpoint.translations : {};
  job.completedSegmentIds = Array.isArray(checkpoint.completedSegmentIds) ? checkpoint.completedSegmentIds : [];
  job.status = checkpoint.status || 'glossary-review';
  job.error = checkpoint.error || undefined;
  job.createdAt = checkpoint.createdAt || job.createdAt;
  job.updatedAt = checkpoint.updatedAt || job.updatedAt;
  validateTranslationJob(job);
  const candidates = Array.isArray(checkpoint.candidates) ? checkpoint.candidates : extractGlossaryCandidates(document.segments, { minOccurrences: 2, maxCandidates: 80 });
  const precisionTranslations = checkpoint.precisionTranslations && typeof checkpoint.precisionTranslations === 'object' ? checkpoint.precisionTranslations : {};
  const precisionCompletedSegmentIds = Array.isArray(checkpoint.precisionCompletedSegmentIds) ? checkpoint.precisionCompletedSegmentIds.filter((id) => typeof id === 'string' && precisionTranslations[id]) : Object.keys(precisionTranslations);
  const runtime = {
    job, sourceName, sourceFile, format, outputExtension: checkpoint.outputExtension || outputExtension,
    model: String(checkpoint.model || 'qwen2.5:14b'), candidates, controller: undefined, precisionController: undefined,
    savePromise: undefined, adapter, precisionTranslations, precisionCompletedSegmentIds,
    precisionStatus: checkpoint.precisionStatus === 'drafting' ? 'paused' : (checkpoint.precisionStatus || 'idle'),
    precisionError: checkpoint.precisionError || undefined, precisionBaseUrl: String(checkpoint.precisionBaseUrl || ''),
    precisionModel: String(checkpoint.precisionModel || '')
  };
  runtimes.set(id, runtime);
  return runtime;
}

async function listCheckpoints() {
  const names = (await fs.readdir(DATA_DIR)).filter((name) => name.endsWith('.json'));
  const entries = [];
  for (const name of names) {
    try {
      const checkpoint = JSON.parse(await fs.readFile(path.join(DATA_DIR, name), 'utf8'));
      entries.push({ id: checkpoint.id || name.slice(0, -5), sourceName: checkpoint.sourceName, status: checkpoint.status, completed: Array.isArray(checkpoint.completedSegmentIds) ? checkpoint.completedSegmentIds.length : 0, total: checkpoint.totalSegments || 0, targetLanguage: checkpoint.targetLanguage, updatedAt: checkpoint.updatedAt });
    } catch { /* Ignore incomplete temporary files. */ }
  }
  return entries.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

async function runTranslation(runtime) {
  const { job } = runtime;
  const controller = new AbortController();
  runtime.controller = controller;
  const provider = new OllamaProvider({ timeoutMs: Number(process.env.TRANSLATOR_TIMEOUT_MS || 120000) });
  setJobStatus(job, 'drafting');
  await saveRuntime(runtime);
  try {
    await translateInBatches(pendingSegments(job), {
      provider, model: runtime.model, sourceLanguage: job.sourceLanguage, targetLanguage: job.targetLanguage,
      glossary: job.glossary, batchSize: 1, maxRetries: 3, retryDelayMs: 1000, signal: controller.signal,
      onBatchComplete: async (results) => { recordTranslationResults(job, results); await saveRuntime(runtime); }
    });
    setJobStatus(job, pendingSegments(job).length ? 'review' : 'completed');
    await saveRuntime(runtime);
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') setJobStatus(job, 'paused');
    else setJobStatus(job, 'failed', error instanceof Error ? error.message : String(error));
    await saveRuntime(runtime);
  } finally { runtime.controller = undefined; }
}

async function runPrecision(runtime, config) {
  const { job } = runtime;
  const controller = new AbortController();
  runtime.precisionController = controller;
  runtime.precisionStatus = 'drafting';
  runtime.precisionError = undefined;
  runtime.precisionBaseUrl = config.baseUrl;
  runtime.precisionModel = config.model;
  await saveRuntime(runtime);
  const provider = new OpenAICompatibleProvider({ baseUrl: config.baseUrl, apiKey: config.apiKey || undefined, id: 'precision' });
  const pending = job.document.segments.filter((segment) => !runtime.precisionCompletedSegmentIds.includes(segment.id) && runtime.precisionTranslations[segment.id] === undefined);
  const segments = pending.map((segment) => ({ ...segment, source: `${segment.source}\n\n[CURRENT DRAFT TRANSLATION]\n${job.translations[segment.id] || segment.source}` }));
  try {
    await translateInBatches(segments, {
      provider, model: config.model, sourceLanguage: job.sourceLanguage, targetLanguage: job.targetLanguage,
      glossary: job.glossary, styleGuide: 'Polish the current draft translation into natural target-language prose. Return only the polished target text, without labels or explanations.',
      batchSize: 1, maxRetries: 2, retryDelayMs: 1200, signal: controller.signal,
      onBatchComplete: async (results) => {
        for (const result of results) {
          runtime.precisionTranslations[result.segmentId] = result.target;
          if (!runtime.precisionCompletedSegmentIds.includes(result.segmentId)) runtime.precisionCompletedSegmentIds.push(result.segmentId);
        }
        await saveRuntime(runtime);
      }
    });
    runtime.precisionStatus = runtime.precisionCompletedSegmentIds.length === job.document.segments.length ? 'completed' : 'review';
    await saveRuntime(runtime);
  } catch (error) {
    runtime.precisionStatus = controller.signal.aborted || error?.name === 'AbortError' ? 'paused' : 'failed';
    runtime.precisionError = error instanceof Error ? error.message : String(error);
    await saveRuntime(runtime);
  } finally { runtime.precisionController = undefined; }
}

async function exportRuntime(runtime) {
  const replacements = runtime.job.document.segments.filter((segment) => runtime.precisionTranslations[segment.id] || runtime.job.translations[segment.id]).map((segment) => ({ segmentId: segment.id, source: segment.source, target: runtime.precisionTranslations[segment.id] || runtime.job.translations[segment.id] }));
  return runtime.adapter.export(runtime.job.document, replacements);
}

async function handleApi(request, response, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.pathname === '/api/health' && request.method === 'GET') {
    const provider = new OllamaProvider({ timeoutMs: 5000 });
    const health = await provider.healthCheck();
    const models = health.ok ? await provider.listModels() : [];
    return json(response, { ...health, models });
  }
  if (url.pathname === '/api/jobs' && request.method === 'GET') return json(response, { jobs: await listCheckpoints() });
  if (url.pathname === '/api/jobs' && request.method === 'POST') return json(response, summary(await createRuntime(await readJson(request))), 201);
  if (parts[0] !== 'api' || parts[1] !== 'jobs' || !parts[2]) return json(response, { error: 'Not found' }, 404);
  const runtime = await loadRuntime(parts[2]);
  if (parts.length === 3 && request.method === 'GET') return json(response, summary(runtime));
  if (parts[3] === 'glossary' && request.method === 'POST') {
    const payload = await readJson(request);
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    runtime.job.glossary = entries.filter((entry) => entry && typeof entry.source === 'string' && typeof entry.target === 'string' && entry.target.trim()).map((entry, index) => ({ id: String(entry.id || `gui-glossary-${index + 1}`), source: entry.source.trim(), target: entry.target.trim(), rule: entry.rule === 'do-not-translate' || entry.rule === 'forbidden' ? entry.rule : 'preferred', note: typeof entry.note === 'string' ? entry.note : undefined, approved: entry.approved !== false }));
    if (runtime.job.status === 'glossary-review') setJobStatus(runtime.job, 'draft');
    await saveRuntime(runtime);
    return json(response, summary(runtime));
  }
  if (parts[3] === 'start' && request.method === 'POST') {
    if (runtime.controller) return json(response, { error: '任务已经在运行。' }, 409);
    if (runtime.job.status === 'glossary-review') return json(response, { error: '请先确认术语表。' }, 409);
    if (runtime.job.status === 'completed') return json(response, summary(runtime));
    void runTranslation(runtime);
    return json(response, summary(runtime), 202);
  }
  if (parts[3] === 'precision' && parts[4] === 'start' && request.method === 'POST') {
    if (runtime.precisionController) return json(response, { error: '精校任务已经在运行。' }, 409);
    if (!runtime.job.completedSegmentIds.length) return json(response, { error: '请先完成本地初译。' }, 409);
    const payload = await readJson(request);
    const baseUrl = String(payload.baseUrl || '').trim();
    const model = String(payload.model || '').trim();
    if (!/^https?:\/\//i.test(baseUrl) || !model) return json(response, { error: '请填写有效的 OpenAI-compatible Base URL 和模型名。' }, 400);
    void runPrecision(runtime, { baseUrl, model, apiKey: String(payload.apiKey || '') });
    return json(response, summary(runtime), 202);
  }
  if (parts[3] === 'precision' && parts[4] === 'pause' && request.method === 'POST') {
    if (runtime.precisionController) runtime.precisionController.abort();
    else if (runtime.precisionStatus === 'drafting') runtime.precisionStatus = 'paused';
    await saveRuntime(runtime);
    return json(response, summary(runtime));
  }
  if (parts[3] === 'pause' && request.method === 'POST') {
    if (runtime.controller) runtime.controller.abort();
    else if (runtime.job.status === 'drafting') setJobStatus(runtime.job, 'paused');
    await saveRuntime(runtime);
    return json(response, summary(runtime));
  }
  if (parts[3] === 'export' && request.method === 'GET') {
    const bytes = await exportRuntime(runtime);
    const name = `${path.basename(runtime.sourceName, path.extname(runtime.sourceName))}.draft.${runtime.job.targetLanguage}${runtime.outputExtension}`;
    response.writeHead(200, { 'content-type': runtime.format === 'epub' ? 'application/epub+zip' : 'application/octet-stream', 'content-disposition': `attachment; filename="${encodeURIComponent(name)}"`, 'content-length': bytes.byteLength });
    response.end(Buffer.from(bytes));
    return;
  }
  return json(response, { error: 'Not found' }, 404);
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' })[ext] || 'application/octet-stream';
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url);
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = path.resolve(GUI_DIR, `.${requested}`);
    if (!filePath.startsWith(GUI_DIR)) return json(response, { error: 'Not found' }, 404);
    response.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-store' });
    response.end(await fs.readFile(filePath));
  } catch (error) { fail(response, error); }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Translator Workbench GUI: http://127.0.0.1:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
