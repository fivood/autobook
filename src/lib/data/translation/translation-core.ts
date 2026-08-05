import {
  EpubAdapter,
  HtmlAdapter,
  OllamaProvider,
  TextAdapter,
  type DocumentAdapter,
  type ModelInfo,
  type ProviderHealth,
  type TranslationDocument
} from 'translator-workbench';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import { aiLocalBaseUrl$ } from '$lib/data/store';
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
