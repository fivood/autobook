const $ = (selector) => document.querySelector(selector);
const state = { current: null, candidates: [], pollTimer: null };
const statusText = { 'glossary-review': '待确认术语', draft: '待开始', drafting: '初译中', paused: '已暂停，可继续', failed: '失败，可继续', review: '初译完成，待精校', completed: '已完成' };
const precisionStatusText = { idle: '尚未开始', drafting: '精校中', paused: '已暂停，可继续', failed: '精校失败，可继续', review: '精校结果待导出', completed: '精校完成' };

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body?.error || body || `HTTP ${response.status}`);
  return body;
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function setMessage(text, error = false) { const element = $('#newMessage'); element.textContent = text || ''; element.className = `message ${error ? 'error-text' : ''}`; }
function bytesToBase64(bytes) { let binary = ''; const chunkSize = 0x8000; for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length))); return btoa(binary); }

function renderJobList(jobs) {
  const list = $('#jobList');
  if (!jobs.length) { list.innerHTML = '<p class="muted">暂无任务</p>'; return; }
  list.innerHTML = jobs.map((job) => `<button class="job-item ${state.current?.id === job.id ? 'selected' : ''}" data-job-id="${job.id}"><strong>${escapeHtml(job.sourceName || job.id)}</strong><span>${statusText[job.status] || job.status} · ${job.completed}/${job.total}</span></button>`).join('');
  list.querySelectorAll('[data-job-id]').forEach((button) => button.addEventListener('click', () => loadJob(button.dataset.jobId)));
}

function renderGlossary(candidates, glossary = []) {
  const known = new Map(glossary.map((entry) => [entry.source, entry]));
  const table = $('#glossaryTable');
  if (!candidates.length) { table.innerHTML = '<p class="muted">没有达到候选阈值的专有词汇，可直接确认空术语表。</p>'; return; }
  table.innerHTML = `<div class="glossary-row glossary-head"><span>候选词</span><span>出现次数</span><span>确认译名</span></div>${candidates.map((candidate) => { const entry = known.get(candidate.source); return `<div class="glossary-row"><span><strong>${escapeHtml(candidate.source)}</strong><small>${candidate.reason}</small></span><span>${candidate.occurrences}</span><input data-term="${escapeHtml(candidate.source)}" value="${escapeHtml(entry?.target || '')}" placeholder="留空则不加入" /></div>`; }).join('')}`;
}

function renderWorkspace(job) {
  state.current = job;
  $('#workspace').classList.remove('hidden');
  $('#jobTitle').textContent = job.sourceName || job.id;
  $('#jobMeta').textContent = `${job.sourceLanguage || 'auto'} → ${job.targetLanguage} · ${job.model || 'Ollama'} · checkpoint ${new Date(job.updatedAt).toLocaleString()}`;
  const percent = job.total ? Math.min(100, Math.round((job.completed / job.total) * 100)) : 0;
  $('#progressLabel').textContent = `${percent}%`;
  $('#progressBar').style.width = `${percent}%`;
  $('#progressStats').textContent = `${job.completed} / ${job.total} 段，剩余 ${Math.max(0, job.total - job.completed)} 段`;
  $('#statusLabel').textContent = statusText[job.status] || job.status;
  $('#statusLabel').className = `status ${job.status}`;
  $('#start').disabled = job.status === 'drafting' || job.status === 'completed' || job.status === 'glossary-review';
  $('#start').textContent = job.status === 'paused' || job.status === 'failed' ? '继续初译' : '开始初译';
  $('#pause').disabled = job.status !== 'drafting';
  $('#export').disabled = !job.completed;
  $('#errorBox').textContent = job.error || '';
  $('#errorBox').classList.toggle('hidden', !job.error);
  const precision = job.precision || { status: 'idle', completed: 0, total: job.total, baseUrl: '', model: '', error: null };
  $('#precisionStatus').textContent = precisionStatusText[precision.status] || precision.status;
  $('#precisionStatus').className = `status ${precision.status}`;
  $('#precisionProgress').textContent = `${precision.completed} / ${precision.total} 段`;
  if (precision.baseUrl && !$('#precisionBaseUrl').value) $('#precisionBaseUrl').value = precision.baseUrl;
  if (precision.model && !$('#precisionModel').value) $('#precisionModel').value = precision.model;
  $('#startPrecision').disabled = !job.completed || precision.status === 'drafting' || precision.status === 'completed';
  $('#pausePrecision').disabled = precision.status !== 'drafting';
  if (precision.error) { $('#errorBox').textContent = `精校：${precision.error}`; $('#errorBox').classList.remove('hidden'); }
  state.candidates = job.candidates || [];
  renderGlossary(state.candidates, job.glossary || []);
  renderJobList(window.__jobs || []);
  if (job.status === 'drafting' || precision.status === 'drafting') startPolling();
}

async function refreshJobs() { const result = await api('/api/jobs'); window.__jobs = result.jobs || []; renderJobList(window.__jobs); }
async function loadJob(id) { try { renderWorkspace(await api(`/api/jobs/${id}`)); } catch (error) { setMessage(error.message, true); } }
function startPolling() { clearTimeout(state.pollTimer); state.pollTimer = setTimeout(async () => { if (!state.current) return; try { renderWorkspace(await api(`/api/jobs/${state.current.id}`)); await refreshJobs(); } catch (error) { $('#errorBox').textContent = error.message; $('#errorBox').classList.remove('hidden'); } }, 1500); }

async function refreshRuntime() {
  try {
    const health = await api('/api/health');
    $('#runtimeBadge').textContent = health.ok ? `Ollama 在线 · ${health.models.length} 个模型` : `Ollama 不可用 · ${health.message}`;
    $('#runtimeBadge').className = `badge ${health.ok ? 'online' : 'offline'}`;
    if (health.models?.length) { $('#model').innerHTML = health.models.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.id)}</option>`).join(''); if (health.models.some((model) => model.id === 'qwen2.5:14b')) $('#model').value = 'qwen2.5:14b'; }
  } catch (error) { $('#runtimeBadge').textContent = `Ollama 不可用 · ${error.message}`; $('#runtimeBadge').className = 'badge offline'; }
}

function selectedFiles() { return [...($('#sourceFile').files || []), ...($('#sourceFolder').files || [])].filter((file, index, files) => /\.(epub|html?|txt|text|md|markdown)$/i.test(file.name) && files.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size && candidate.lastModified === file.lastModified) === index); }
function updateImportButton() { const count = selectedFiles().length; $('#inspect').disabled = !count; $('#inspect').textContent = count > 1 ? `导入并分析 ${count} 个文件` : '导入并分析术语'; }
$('#sourceFile').addEventListener('change', () => { updateImportButton(); setMessage(''); });
$('#sourceFolder').addEventListener('change', () => { updateImportButton(); setMessage(''); });
$('#inspect').addEventListener('click', async () => {
  const files = selectedFiles(); if (!files.length) return;
  $('#inspect').disabled = true; setMessage(`正在解析 ${files.length} 个文件…`);
  try {
    let lastJob;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      setMessage(`正在解析第 ${index + 1}/${files.length} 个文件：${file.name}`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      lastJob = await api('/api/jobs', { method: 'POST', body: JSON.stringify({ name: file.name, bytesBase64: bytesToBase64(bytes), targetLanguage: $('#targetLanguage').value, model: $('#model').value }) });
    }
    if (lastJob) renderWorkspace(lastJob);
    await refreshJobs();
    setMessage(`已创建 ${files.length} 个翻译任务。`);
  } catch (error) { setMessage(error.message, true); } finally { $('#inspect').disabled = false; updateImportButton(); }
});

$('#confirmGlossary').addEventListener('click', async () => {
  if (!state.current) return;
  const entries = [...document.querySelectorAll('[data-term]')].map((input, index) => ({ id: `gui-glossary-${index + 1}`, source: input.dataset.term, target: input.value.trim(), rule: 'preferred', approved: Boolean(input.value.trim()) })).filter((entry) => entry.target);
  try { renderWorkspace(await api(`/api/jobs/${state.current.id}/glossary`, { method: 'POST', body: JSON.stringify({ entries }) })); } catch (error) { $('#errorBox').textContent = error.message; $('#errorBox').classList.remove('hidden'); }
});
$('#start').addEventListener('click', async () => { try { renderWorkspace(await api(`/api/jobs/${state.current.id}/start`, { method: 'POST', body: '{}' })); startPolling(); } catch (error) { $('#errorBox').textContent = error.message; $('#errorBox').classList.remove('hidden'); } });
$('#pause').addEventListener('click', async () => { try { renderWorkspace(await api(`/api/jobs/${state.current.id}/pause`, { method: 'POST', body: '{}' })); } catch (error) { $('#errorBox').textContent = error.message; $('#errorBox').classList.remove('hidden'); } });
$('#startPrecision').addEventListener('click', async () => {
  try {
    renderWorkspace(await api(`/api/jobs/${state.current.id}/precision/start`, { method: 'POST', body: JSON.stringify({ baseUrl: $('#precisionBaseUrl').value.trim(), model: $('#precisionModel').value.trim(), apiKey: $('#precisionApiKey').value }) }));
    startPolling();
  } catch (error) { $('#errorBox').textContent = error.message; $('#errorBox').classList.remove('hidden'); }
});
$('#pausePrecision').addEventListener('click', async () => { try { renderWorkspace(await api(`/api/jobs/${state.current.id}/precision/pause`, { method: 'POST', body: '{}' })); } catch (error) { $('#errorBox').textContent = error.message; $('#errorBox').classList.remove('hidden'); } });
$('#export').addEventListener('click', async () => { try { const response = await fetch(`/api/jobs/${state.current.id}/export`); if (!response.ok) throw new Error(await response.text()); const blob = await response.blob(); const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = `${state.current.sourceName}.draft.${state.current.targetLanguage}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(anchor.href), 1000); } catch (error) { $('#errorBox').textContent = error.message; $('#errorBox').classList.remove('hidden'); } });
$('#newJob').addEventListener('click', () => { state.current = null; $('#workspace').classList.add('hidden'); $('#sourceFile').value = ''; $('#sourceFolder').value = ''; $('#inspect').disabled = true; $('#inspect').textContent = '导入并分析术语'; setMessage(''); });
$('#refreshJobs').addEventListener('click', async () => { await refreshJobs(); await refreshRuntime(); });

await refreshRuntime();
await refreshJobs();
