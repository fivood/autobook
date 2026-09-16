/**
 * Translation-model capability scoring.
 *
 * The old default "pick the largest local model" is wrong for translation:
 * a big general chat model isn't necessarily a good translator, and a small
 * translation-specialized model usually beats it. Score order:
 *
 *   translation-specialized (Hy-MT2) > multilingual-general > largest-parameter
 *
 * Used by the workbench to pick a sensible default for the *draft* pass.
 * Review passes keep using the user's configured generic LLM.
 */

import type { ModelInfo } from 'translator-workbench';

/** Model name fragments that identify translation-specialized models. */
const TRANSLATION_SPECIALIZED = [
  /hy-mt2/i,
  /hy-mt2/i,
  /qwen-mt/i,
  /seamless/i,
  /nllb/i,
  /m2m/i,
  /madlad/i
];

/** Fragments for multilingual general-purpose chat models. */
const MULTILINGUAL_GENERAL = [
  /qwen/i,
  /gemma/i,
  /aya/i,
  /llama/i,
  /mistral/i
];

function matches(model: ModelInfo, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(model.id));
}

/**
 * Score a local model for the draft (translation) pass. Higher = better fit.
 * Translation-specialized wins regardless of size; then multilingual-general;
 * then fall back to parameter count (the old behavior).
 */
export function scoreDraftModel(model: ModelInfo): number {
  if (matches(model, TRANSLATION_SPECIALIZED)) return 1000;
  if (matches(model, MULTILINGUAL_GENERAL)) {
    return 500 + (parameterBillions(model) || 0);
  }
  return parameterBillions(model) || 0;
}

/** Parse "14.8B" → 14.8 from parameterSize. */
function parameterBillions(model: ModelInfo): number | null {
  if (!model.parameterSize) return null;
  const m = model.parameterSize.match(/[0-9]+(?:\.[0-9]+)?/);
  return m ? Number(m[0]) : null;
}

/** Best local model for the draft pass, or undefined if none are usable. */
export function pickDraftModel(models: ModelInfo[]): ModelInfo | undefined {
  if (!models.length) return undefined;
  return [...models].sort((a, b) => scoreDraftModel(b) - scoreDraftModel(a))[0];
}

/** Best local model for the review pass (generic chat, not translation). */
export function pickReviewModel(models: ModelInfo[]): ModelInfo | undefined {
  if (!models.length) return undefined;
  const usable = [...models].filter((m) => !matches(m, TRANSLATION_SPECIALIZED));
  const pool = usable.length ? usable : models;
  return [...pool].sort((a, b) => (parameterBillions(b) || 0) - (parameterBillions(a) || 0))[0];
}
