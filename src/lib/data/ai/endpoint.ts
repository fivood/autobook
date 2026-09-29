/**
 * Picks which model answers a given task.
 *
 * Two endpoints can be configured at once — a local runtime and a cloud key —
 * and they are good at different things. Rather than a global "AI provider"
 * setting, each task states what it needs and this resolves the rest:
 *
 *   - Short interactive work (glossing a word, naming a chapter) prefers local:
 *     the request is small, latency is fine, and the text never leaves the machine.
 *   - Bulk work (OCR correction over hundreds of pages) also prefers local,
 *     because per-token cost is what makes it viable at all.
 *   - Constraint-heavy work (the spoiler-safe assistant) should stay on the
 *     cloud model, which follows "do not use your training knowledge" far more
 *     reliably than a small local one.
 *
 * `minBillions` lets a task decline a model too small for it instead of
 * producing bad output.
 */

import {
  aiApiKey$,
  aiBaseUrl$,
  aiLocalBaseUrl$,
  aiModel$,
  aiProvider$
} from '$lib/data/store';
import type { AiClientOpts, AiProvider } from '$lib/data/ai/ai-client';
import { resolveLocalModel } from '$lib/data/ai/local-model';

export type AiTier = 'prefer-local' | 'prefer-cloud';

export interface ResolvedEndpoint {
  opts: AiClientOpts;
  /** Shown next to results so the reader knows what produced them. */
  label: string;
  isLocal: boolean;
}

function cloudOpts(): AiClientOpts | undefined {
  const apiKey = aiApiKey$.getValue();
  const model = aiModel$.getValue();
  if (!apiKey || !model) return undefined;
  return {
    provider: (aiProvider$.getValue() as AiProvider) || 'anthropic',
    apiKey,
    baseUrl: aiBaseUrl$.getValue(),
    model
  };
}

function localOpts(minBillions: number): AiClientOpts | undefined {
  const model = resolveLocalModel(minBillions);
  if (!model) return undefined;
  return {
    provider: 'ollama',
    // Local runtimes take no key; the field stays for interface uniformity.
    apiKey: '',
    baseUrl: aiLocalBaseUrl$.getValue(),
    model
  };
}

/**
 * Resolve an endpoint, or undefined when nothing usable is configured —
 * callers hide their entry point in that case rather than showing a disabled
 * control that nags about setup.
 */
export function resolveEndpoint(
  tier: AiTier = 'prefer-local',
  minBillions = 0
): ResolvedEndpoint | undefined {
  const local = localOpts(minBillions);
  const cloud = cloudOpts();
  const ordered = tier === 'prefer-local' ? [local, cloud] : [cloud, local];

  for (const opts of ordered) {
    if (opts) {
      return { opts, label: opts.model, isLocal: opts.provider === 'ollama' };
    }
  }
  return undefined;
}
