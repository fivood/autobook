import { buildGlossaryPrompt } from '../core/glossary.js';
import type { ModelInfo, ProviderHealth, TranslationProvider, TranslationRequest, TranslationResult } from '../core/provider.js';

export interface OpenAICompatibleProviderOptions {
  id?: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  jsonMode?: boolean;
  fetchImpl?: typeof fetch;
}

interface ModelsResponse {
  data?: Array<{ id: string; created?: number; owned_by?: string }>;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
}

function readContent(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === 'string') return content;
  return (content || []).map((part) => part.text || '').join('');
}

function parseResults(content: string): TranslationResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('OpenAI-compatible provider returned non-JSON translation output.');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { translations?: unknown }).translations)) {
    throw new Error('Provider output is missing the translations array.');
  }
  return (parsed as { translations: unknown[] }).translations.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Invalid translation item at index ${index}.`);
    const value = item as { id?: unknown; text?: unknown };
    if (typeof value.id !== 'string' || typeof value.text !== 'string') throw new Error(`Invalid translation item at index ${index}.`);
    return { segmentId: value.id, target: value.text, raw: item };
  });
}

export class OpenAICompatibleProvider implements TranslationProvider {
  readonly id: string;
  readonly kind = 'remote' as const;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly headers: Record<string, string>;
  private readonly jsonMode: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.id = options.id || 'openai-compatible';
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.headers = options.headers || {};
    this.jsonMode = options.jsonMode ?? true;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  private requestHeaders(): Record<string, string> {
    return {
      ...this.headers,
      'content-type': 'application/json',
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
    };
  }

  async healthCheck(signal?: AbortSignal): Promise<ProviderHealth> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/models`, { headers: this.requestHeaders(), signal });
      if (!response.ok) return { ok: false, message: `Provider returned HTTP ${response.status}` };
      return { ok: true, message: 'Provider is reachable.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const response = await this.fetchImpl(`${this.baseUrl}/models`, { headers: this.requestHeaders(), signal });
    if (!response.ok) throw new Error(`Provider model list failed: HTTP ${response.status}`);
    const body = (await response.json()) as ModelsResponse;
    return (body.data || []).map((model) => ({ id: model.id, modifiedAt: model.created ? new Date(model.created * 1000).toISOString() : undefined, family: model.owned_by }));
  }

  async translate(request: TranslationRequest): Promise<TranslationResult[]> {
    const body: Record<string, unknown> = {
      model: request.model,
      temperature: 0.15,
      messages: [
        {
          role: 'system',
          content: [
            `Translate from ${request.sourceLanguage} to ${request.targetLanguage}.`,
            'Return JSON only in the form {"translations":[{"id":"segment id","text":"translated text"}]}',
            'Preserve placeholders, numbers, punctuation, and line breaks.',
            'Do not add explanations or omit a segment.',
            `Approved glossary:\n${buildGlossaryPrompt(request.glossary)}`,
            request.styleGuide ? `Style guide:\n${request.styleGuide}` : ''
          ].filter(Boolean).join('\n')
        },
        { role: 'user', content: JSON.stringify(request.segments.map((segment) => ({ id: segment.id, text: segment.source }))) }
      ],
      ...(this.jsonMode ? { response_format: { type: 'json_object' } } : {})
    };
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.requestHeaders(),
      body: JSON.stringify(body),
      signal: request.signal
    });
    if (!response.ok) throw new Error(`Provider translation failed: HTTP ${response.status}`);
    const result = (await response.json()) as ChatResponse;
    return parseResults(readContent(result.choices?.[0]?.message?.content));
  }
}
