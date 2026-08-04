import { buildGlossaryPrompt } from '../core/glossary.js';
import type { ModelInfo, ProviderHealth, TranslationProvider, TranslationRequest, TranslationResult } from '../core/provider.js';

export interface OllamaProviderOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface OllamaTagsResponse {
  models?: Array<{ name: string; size?: number; modified_at?: string; details?: { family?: string; parameter_size?: string; quantization_level?: string } }>;
}

interface OllamaChatResponse {
  message?: { content?: string };
  response?: string;
}

function parseJsonObject(content: string): unknown {
  const normalized = content.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const candidates = [normalized];
  const start = normalized.indexOf('{');
  const end = normalized.lastIndexOf('}');
  if (start >= 0 && end > start && (start !== 0 || end !== normalized.length - 1)) {
    candidates.push(normalized.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next normalization before reporting a provider-format error.
    }
  }
  throw new Error('Ollama returned non-JSON translation output.');
}

function fallbackText(content: string): string {
  return content
    .replace(/^\s*```(?:text|plain)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/^\s*(?:translation|translated text)\s*:\s*/i, '')
    .trim();
}

export class OllamaProvider implements TranslationProvider {
  readonly id = 'ollama';
  readonly kind = 'local' as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = (options.baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = Math.max(1000, options.timeoutMs ?? 180000);
  }

  private async request(url: string, init: RequestInit = {}, parentSignal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortParent = () => controller.abort();
    parentSignal?.addEventListener('abort', abortParent, { once: true });
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortParent);
    }
  }

  async healthCheck(signal?: AbortSignal): Promise<ProviderHealth> {
    try {
      const response = await this.request(`${this.baseUrl}/api/tags`, {}, signal);
      if (!response.ok) return { ok: false, message: `Ollama returned HTTP ${response.status}` };
      return { ok: true, message: 'Ollama is reachable.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const response = await this.request(`${this.baseUrl}/api/tags`, {}, signal);
    if (!response.ok) throw new Error(`Ollama model list failed: HTTP ${response.status}`);
    const body = (await response.json()) as OllamaTagsResponse;
    return (body.models || []).map((model) => ({
      id: model.name,
      size: model.size,
      modifiedAt: model.modified_at,
      family: model.details?.family,
      parameterSize: model.details?.parameter_size,
      quantization: model.details?.quantization_level
    }));
  }

  async translate(request: TranslationRequest): Promise<TranslationResult[]> {
    if (!request.segments.length) return [];
    const glossary = buildGlossaryPrompt(request.glossary);
    const payload = {
      model: request.model,
      stream: false,
      format: 'json',
      options: { temperature: 0.15 },
      messages: [
        {
          role: 'system',
          content: [
            `Translate from ${request.sourceLanguage} to ${request.targetLanguage}.`,
            'Return JSON only in the form {"translations":[{"id":"segment id","text":"translated text"}]}',
            'Preserve placeholders, numbers, punctuation, and line breaks unless the target language requires otherwise.',
            'Do not add explanations or omit a segment.',
            'Approved glossary:',
            glossary,
            request.styleGuide ? `Style guide:\n${request.styleGuide}` : ''
          ].filter(Boolean).join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify(request.segments.map((segment) => ({ id: segment.id, text: segment.source })))
        }
      ]
    };

    const response = await this.request(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }, request.signal);
    if (!response.ok) throw new Error(`Ollama translation failed: HTTP ${response.status}`);

    const body = (await response.json()) as OllamaChatResponse;
    const content = body.message?.content || body.response || '';
    try {
      const parsed = parseJsonObject(content);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { translations?: unknown }).translations)) {
        throw new Error('Ollama output is missing the translations array.');
      }

      const parsedResults = (parsed as { translations: unknown[] }).translations.map((item, index) => {
        if (!item || typeof item !== 'object') throw new Error(`Invalid translation item at index ${index}.`);
        const value = item as { id?: unknown; text?: unknown };
        if (typeof value.id !== 'string' || typeof value.text !== 'string') {
          throw new Error(`Invalid translation item at index ${index}.`);
        }
        return { segmentId: value.id, target: value.text, raw: item };
      });
      if (request.segments.length === 1 && parsedResults.length === 1) {
        return [{ ...parsedResults[0]!, segmentId: request.segments[0]!.id }];
      }
      return parsedResults;
    } catch (error) {
      if (request.segments.length > 1) {
        const splitResults: TranslationResult[] = [];
        for (const segment of request.segments) {
          splitResults.push(...await this.translate({ ...request, segments: [segment] }));
        }
        return splitResults;
      }
      const target = fallbackText(content);
      if (!target) throw error;
      return [{ segmentId: request.segments[0]!.id, target, raw: { fallback: true, content } }];
    }
  }
}
