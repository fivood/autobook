/**
 * Language → task routing for the translation workbench.
 *
 * Pure function layer (no Svelte / Tauri / IndexedDB) that turns a
 * source/target language + input kind + quality mode into a concrete
 * route: which OCR pipeline, which draft-translation model, and whether a
 * review pass applies. Kept framework-free so it can be unit-tested and
 * reused by both the workbench UI and any future automation.
 *
 * Language codes are BCP-47, lower-cased (matches `sourceLanguageFromOcrLang`
 * and the `TranslationDocument.sourceLanguage` conventions used elsewhere).
 */

export type LanguageInputKind = 'text' | 'scanned-pdf' | 'comic';

export type QualityMode = 'fast' | 'balanced' | 'quality' | 'manual';

/** OCR model pipeline profile. `v5-korean` is a dedicated Korean pipeline. */
export type OcrProfileId = 'v6-small' | 'v6-tiny' | 'v5-mobile' | 'v5-korean';

export interface DraftRoute {
  provider: string;
  model: string;
  reason: string;
}

export interface LanguageTaskRoute {
  sourceLanguage: string;
  targetLanguage: string;
  /** Same-language (e.g. zh→zh): no translation, only OCR/index. */
  needsTranslation: boolean;
  ocr?: {
    profile: OcrProfileId;
    reason: string;
  };
  draftTranslation?: DraftRoute;
  review?: {
    provider: string;
    model: string;
  };
}

export interface RouteInput {
  sourceLanguage: string;
  targetLanguage: string;
  inputKind: LanguageInputKind;
  qualityMode: QualityMode;
  /** Whether a given OCR profile has its models installed. */
  installedOcr: Record<string, boolean>;
  /** Draft translation provider availability, keyed by provider id. */
  providers?: Record<string, { baseUrl: string; apiKey?: string }>;
  /** Configured generic-LLM model for the review pass (Claude/GPT/Ollama). */
  reviewModel?: string;
}

// ── Language classification ──────────────────────────────────────────────

export function normalizeLang(code: string): string {
  return (code || '').trim().toLowerCase().split('-')[0];
}

export function isChinese(lang: string): boolean {
  return normalizeLang(lang) === 'zh';
}

export function isKorean(lang: string): boolean {
  return normalizeLang(lang) === 'ko';
}

export function isJapanese(lang: string): boolean {
  return normalizeLang(lang) === 'ja';
}

/** European languages bundled for translation (fr/de/es/it/pt/nl/pl/da/sv/no/cs/ro/hu). */
const EUROPEAN = new Set(['fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'da', 'sv', 'no', 'cs', 'ro', 'hu']);

export function isEuropean(lang: string): boolean {
  return EUROPEAN.has(normalizeLang(lang));
}

/** Secondary languages kept as OCR/translation options but not "European". */
const SECONDARY = new Set(['tr', 'vi']);

export function isSecondary(lang: string): boolean {
  return SECONDARY.has(normalizeLang(lang));
}

/**
 * A language AutoBook can OCR + translate to Chinese out of the box:
 * zh / en / ja / ko / European set / tr / vi.
 */
export function isSupportedSource(lang: string): boolean {
  const n = normalizeLang(lang);
  return isChinese(n) || isKorean(n) || isJapanese(n) || n === 'en' || isEuropean(n) || isSecondary(n);
}

// ── OCR profile selection ────────────────────────────────────────────────

/** OCR pipeline for a source language. Korean requires its own model. */
export function ocrProfileFor(lang: string, inputKind: LanguageInputKind): { profile: OcrProfileId; reason: string } {
  const n = normalizeLang(lang);
  // Korean has a dedicated v5 recognition model — never OCR Korean with the
  // shared CJK/Latin model (wrong text layer).
  if (isKorean(n)) {
    return {
      profile: 'v5-korean',
      reason: '韩文需要专用识别模型（PP-OCRv5 Korean rec）'
    };
  }
  if (inputKind === 'text') {
    return {
      profile: 'v6-small',
      reason: '文字书：共享 CJK + Latin 识别模型（v6）'
    };
  }
  // scanned-pdf / comic: same shared model, language only affects rec dict.
  return {
    profile: 'v6-small',
    reason: '扫描件/漫画：PP-OCRv6 Small 识别'
  };
}

// ── Draft translation model selection ────────────────────────────────────

export interface DraftModelInfo {
  provider: string;
  model: string;
  reason: string;
}

/**
 * Translation-specialized model preferred for the draft pass; generic LLMs
 * are for the review pass, not initial translation. Priority:
 *   translation-specialized (Hy-MT2 / Qwen-MT) > multilingual-general > largest-parameter
 */
export function draftModelFor(
  lang: string,
  targetLang: string,
  qualityMode: QualityMode,
  providers: RouteInput['providers']
): DraftModelInfo | undefined {
  const n = normalizeLang(lang);
  const tn = normalizeLang(targetLang);
  if (isChinese(n) && isChinese(tn)) return undefined; // same-language, no draft

  switch (qualityMode) {
    case 'fast':
      return {
        provider: 'hy-mt2',
        model: 'Hy-MT2-1.8B',
        reason: '快速档：Hy-MT2-1.8B 本地初译'
      };
    case 'quality':
      if (providers?.qwenMt?.baseUrl) {
        return {
          provider: 'qwen-mt',
          model: 'Qwen-MT-Plus',
          reason: '高质量档：Qwen-MT-Plus 云端初译（92 语言 + 术语/翻译记忆）'
        };
      }
      return {
        provider: 'hy-mt2',
        model: 'Hy-MT2-7B',
        reason: '高质量档：Hy-MT2-7B 本地初译'
      };
    case 'balanced':
    default:
      return {
        provider: 'hy-mt2',
        model: 'Hy-MT2-7B',
        reason: '均衡档（默认）：Hy-MT2-7B 本地初译'
      };
  }
}

/** Whether a review pass is warranted for this route. */
export function reviewModelFor(route: LanguageTaskRoute, input: RouteInput): string | undefined {
  if (!route.needsTranslation) return undefined;
  // Fast mode skips review; otherwise the generic-LLM configured for review.
  if (input.qualityMode === 'fast') return undefined;
  return input.reviewModel || undefined;
}

// ── Public router ────────────────────────────────────────────────────────

export function resolveLanguageRoute(input: RouteInput): LanguageTaskRoute {
  const { sourceLanguage, targetLanguage, inputKind, qualityMode } = input;
  const needsTranslation = normalizeLang(sourceLanguage) !== normalizeLang(targetLanguage);

  const route: LanguageTaskRoute = {
    sourceLanguage: normalizeLang(sourceLanguage),
    targetLanguage: normalizeLang(targetLanguage),
    needsTranslation
  };

  const ocr = ocrProfileFor(sourceLanguage, inputKind);
  route.ocr = ocr;

  if (needsTranslation) {
    const draft = draftModelFor(sourceLanguage, targetLanguage, qualityMode, input.providers);
    if (draft) route.draftTranslation = draft;
    const review = reviewModelFor(route, input);
    if (review) {
      route.review = { provider: 'generic-llm', model: review };
    }
  }

  return route;
}

/**
 * Validate a route before running a task:
 * - Korean OCR requires the v5-korean profile to be installed — if not,
 *   fail the task rather than silently falling back to CJK OCR.
 * - Draft translation requires the chosen provider to be configured.
 */
export function validateRoute(route: LanguageTaskRoute, input: RouteInput): { ok: boolean; error?: string } {
  if (route.ocr?.profile === 'v5-korean' && !input.installedOcr['v5-korean']) {
    return {
      ok: false,
      error: 'Korean PP-OCRv5 模型尚未安装。请先在设置中安装，不能使用其他语言的 OCR 模型识别韩文。'
    };
  }
  if (route.draftTranslation) {
    const p = input.providers?.[route.draftTranslation.provider];
    if (!p) {
      return {
        ok: false,
        error: `初译模型提供方「${route.draftTranslation.provider}」未配置。`
      };
    }
  }
  return { ok: true };
}
