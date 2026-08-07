import {
  buildGlossaryPrompt,
  ComicAdapter,
  EpubAdapter,
  HtmlAdapter,
  OllamaProvider,
  OpenAICompatibleProvider,
  TextAdapter,
  type DocumentAdapter,
  type ModelInfo,
  type ProviderHealth,
  type TranslationDocument,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResult
} from 'translator-workbench';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import { aiApiKey$, aiBaseUrl$, aiLocalBaseUrl$, aiModel$, aiProvider$ } from '$lib/data/store';
import { tImmediate } from '$lib/i18n';

/**
 * AutoBook integration seam. The reader UI can pass a File/Uint8Array here;
 * the shared adapter remains independent of Svelte, IndexedDB and Tauri.
 */
export async function inspectEpubFile(file: File): Promise<TranslationDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return new EpubAdapter().extract({ sourcePath: file.name, bytes });
}

export interface InspectedTranslationFile {
  document: TranslationDocument;
  adapter: DocumentAdapter;
  extension: string;
}

export function adapterForTranslationDocument(document: TranslationDocument): DocumentAdapter {
  switch (document.format) {
    case 'epub': return new EpubAdapter();
    case 'html':
    case 'htmlz': return new HtmlAdapter();
    case 'markdown': return new TextAdapter('markdown');
    case 'txt': return new TextAdapter('txt');
    case 'cbz':
    case 'cbr': return new ComicAdapter();
    default:
      throw new Error(tImmediate('translate.error.noAdapter', { format: document.format }));
  }
}

export async function inspectTranslationFile(file: File): Promise<InspectedTranslationFile> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const adapter: DocumentAdapter = extension === 'epub'
    ? new EpubAdapter()
    : extension === 'html' || extension === 'htm'
      ? new HtmlAdapter()
    : extension === 'md' || extension === 'markdown'
      ? new TextAdapter('markdown')
      : extension === 'txt' || extension === 'text'
        ? new TextAdapter('txt')
        : (() => {
            throw new Error(
              tImmediate('translate.error.unsupportedFormat', {
                ext: extension || tImmediate('translate.error.unknownFormat')
              })
            );
          })();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    document: await adapter.extract({ sourcePath: file.name, bytes }),
    adapter,
    extension: extension === 'markdown' ? 'md' : extension === 'htm' ? 'html' : extension
  };
}

export function isComicFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return ext === 'cbz' || ext === 'cbr';
}

export async function inspectStoredBook(book: BooksDbBookData): Promise<InspectedTranslationFile> {
  if (!book.elementHtml) throw new Error(tImmediate('translate.error.noHtml'));
  const adapter = new HtmlAdapter();
  const document = await adapter.extract({
    sourcePath: `${book.title || 'autobook'}.html`,
    bytes: new TextEncoder().encode(book.elementHtml)
  });
  document.title = book.title;
  document.sourceLanguage = book.language || document.sourceLanguage;
  return { document, adapter, extension: 'html' };
}

/**
 * Local runtime URL for the translation providers — the same one the rest of
 * the AI surface uses, so changing it in settings moves everything at once.
 */
export function localTranslationBaseUrl(): string {
  return aiLocalBaseUrl$.getValue();
}

export async function checkLocalTranslationRuntime(): Promise<ProviderHealth> {
  return new OllamaProvider({ baseUrl: localTranslationBaseUrl() }).healthCheck();
}

export async function listLocalTranslationModels(): Promise<ModelInfo[]> {
  return new OllamaProvider({ baseUrl: localTranslationBaseUrl() }).listModels();
}

/** Provider for the draft pass, pointed at the configured local runtime. */
export function createLocalTranslationProvider(): OllamaProvider {
  return new OllamaProvider({ baseUrl: localTranslationBaseUrl() });
}

/**
 * Anthropic Messages API as a TranslationProvider. Same prompt structure as
 * OllamaProvider / OpenAICompatibleProvider — the three are interchangeable
 * at the translateInBatches level.
 */
class AnthropicTranslationProvider implements TranslationProvider {
  readonly id = 'anthropic';
  readonly kind = 'remote' as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: { baseUrl?: string; apiKey: string }) {
    this.baseUrl = (options.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
    this.apiKey = options.apiKey;
  }

  async healthCheck(signal?: AbortSignal): Promise<ProviderHealth> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this.requestHeaders(),
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
        signal
      });
      if (res.status === 401) return { ok: false, message: 'API key invalid' };
      return { ok: true, message: 'Anthropic endpoint is reachable.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async listModels(_signal?: AbortSignal): Promise<ModelInfo[]> {
    return [];
  }

  async translate(request: TranslationRequest): Promise<TranslationResult[]> {
    if (!request.segments.length) return [];
    const systemPrompt = [
      `Translate from ${request.sourceLanguage} to ${request.targetLanguage}.`,
      'Return JSON only in the form {"translations":[{"id":"segment id","text":"translated text"}]}',
      'Preserve placeholders, numbers, punctuation, and line breaks.',
      'Do not add explanations or omit a segment.',
      `Approved glossary:\n${buildGlossaryPrompt(request.glossary)}`,
      request.styleGuide ? `Style guide:\n${request.styleGuide}` : ''
    ].filter(Boolean).join('\n');

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.requestHeaders(),
      body: JSON.stringify({
        model: request.model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: JSON.stringify(request.segments.map((s) => ({ id: s.id, text: s.source })))
        }]
      }),
      signal: request.signal
    });
    if (!res.ok) throw new Error(`Anthropic translation failed: HTTP ${res.status}`);
    const body = await res.json();
    const content: string = body.content?.map((block: { text?: string }) => block.text || '').join('') || '';
    return parseTranslationJson(content, request.segments);
  }

  private requestHeaders(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
  }
}

function parseTranslationJson(content: string, segments: readonly { id: string }[]): TranslationResult[] {
  const normalized = content.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const candidates = [normalized];
  const start = normalized.indexOf('{');
  const end = normalized.lastIndexOf('}');
  if (start >= 0 && end > start && (start !== 0 || end !== normalized.length - 1)) {
    candidates.push(normalized.slice(start, end + 1));
  }
  let parsed: { translations?: Array<{ id: string; text: string }> } | undefined;
  for (const candidate of candidates) {
    try { parsed = JSON.parse(candidate); break; } catch { /* try next */ }
  }
  if (!parsed || !Array.isArray(parsed.translations)) {
    throw new Error('Provider returned non-JSON translation output.');
  }
  return parsed.translations.map((item, index) => {
    if (typeof item?.id !== 'string' || typeof item?.text !== 'string') {
      throw new Error(`Invalid translation item at index ${index}.`);
    }
    const result: TranslationResult = { segmentId: item.id, target: item.text, raw: item };
    if (segments.length === 1 && parsed!.translations!.length === 1) {
      result.segmentId = segments[0].id;
    }
    return result;
  });
}

export type TranslationSource = 'local' | 'cloud';

/**
 * Build a TranslationProvider from the user's cloud AI settings.
 * Works with both Anthropic and OpenAI-compatible endpoints.
 */
export function createCloudTranslationProvider(): TranslationProvider {
  const provider = aiProvider$.getValue();
  const apiKey = aiApiKey$.getValue().trim();
  const baseUrl = aiBaseUrl$.getValue().trim();
  if (provider === 'anthropic') {
    return new AnthropicTranslationProvider({ baseUrl: baseUrl || undefined, apiKey });
  }
  return new OpenAICompatibleProvider({
    baseUrl: baseUrl || 'https://api.openai.com/v1',
    apiKey: apiKey || undefined
  });
}

export function cloudTranslationModel(): string {
  return aiModel$.getValue().trim();
}

export function cloudTranslationReady(): boolean {
  const apiKey = aiApiKey$.getValue().trim();
  const model = aiModel$.getValue().trim();
  return !!apiKey && !!model;
}
