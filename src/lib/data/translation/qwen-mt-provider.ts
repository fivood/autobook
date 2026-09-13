/**
 * Qwen-MT (阿里云百炼) translation provider.
 *
 * Qwen-MT is a translation-specialized model served via an OpenAI-compatible
 * endpoint. Unlike a generic chat model it:
 *   - translates a single user text per call (no multi-segment JSON),
 *   - takes `translation_options` (source_lang/target_lang/terms/domains),
 *   - does NOT support a system message.
 *
 * We translate one segment per request (serial), carrying the approved
 * glossary as `terms`. Draft-pass only — the review pass keeps the generic LLM.
 */

import type {
  GlossaryEntry,
  ModelInfo,
  ProviderHealth,
  TranslationProvider,
  TranslationRequest,
  TranslationResult
} from 'translator-workbench';

export interface QwenMtProviderOptions {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

/** Qwen-MT language names (not BCP-47). Map from the common short codes. */
const QWEN_LANG: Record<string, string> = {
  zh: 'Chinese',
  'zh-cn': 'Chinese',
  'zh-tw': 'TraditionalChinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  ru: 'Russian',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian'
};

function qwenLang(code: string): string {
  return QWEN_LANG[code.toLowerCase()] || code;
}

export class QwenMtProvider implements TranslationProvider {
  readonly id = 'qwen-mt';
  readonly kind = 'remote' as const;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: QwenMtProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
    };
  }

  async healthCheck(signal?: AbortSignal): Promise<ProviderHealth> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/models`, { headers: this.headers(), signal });
      if (!res.ok) return { ok: false, message: `Qwen-MT endpoint returned HTTP ${res.status}` };
      return { ok: true, message: 'Qwen-MT endpoint is reachable.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/models`, { headers: this.headers(), signal });
    if (!res.ok) throw new Error(`Qwen-MT model list failed: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data || []).map((m) => ({ id: m.id }));
  }

  async translate(request: TranslationRequest): Promise<TranslationResult[]> {
    if (!request.segments.length) return [];
    const source = qwenLang(request.sourceLanguage);
    const target = qwenLang(request.targetLanguage);
    const terms = request.glossary
      .filter((g: GlossaryEntry) => g.approved && g.source && g.target)
      .map((g: GlossaryEntry) => ({ source: g.source, target: g.target }));

    const results: TranslationResult[] = [];
    // Qwen-MT is single-text per call — one request per segment (serial).
    for (const segment of request.segments) {
      const translationOptions: Record<string, unknown> = {
        source_lang: source,
        target_lang: target
      };
      if (terms.length) translationOptions.terms = terms;
      if (request.styleGuide) translationOptions.domains = request.styleGuide;

      const body = {
        model: request.model,
        messages: [{ role: 'user', content: segment.source }],
        translation_options: translationOptions
      };
      const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: request.signal
      });
      if (!res.ok) throw new Error(`Qwen-MT translation failed: HTTP ${res.status}`);
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) {
        throw new Error(`Qwen-MT returned empty translation for segment ${segment.id}`);
      }
      results.push({ segmentId: segment.id, target: text.trim() });
    }
    return results;
  }
}
