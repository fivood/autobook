/**
 * Local model discovery.
 *
 * Design rule: probe, never sell. AutoBook does not ask anyone to install a
 * runtime or download several gigabytes — it looks once for what is already
 * there and quietly enables the features that fit. A machine with no runtime
 * sees no banners, no modals and no nagging; the affected controls simply
 * report why they are unavailable when the user goes looking.
 *
 * The default model is "the largest one installed", on the assumption that a
 * user who pulled a big model did so because it is the one they actually use.
 * `aiLocalModel$` overrides it whenever they prefer something else.
 */

import { aiLocalBaseUrl$, aiLocalModel$ } from '$lib/data/store';
import { writableSubject } from '$lib/functions/svelte/store';

export interface LocalModelInfo {
  id: string;
  /** Bytes on disk. Drives the "largest installed" default. */
  size: number;
  family?: string;
  parameterSize?: string;
  quantization?: string;
}

export type LocalProbeStatus = 'unknown' | 'probing' | 'ready' | 'unavailable';

export interface LocalProbeState {
  status: LocalProbeStatus;
  models: LocalModelInfo[];
  /** Why the probe failed. Shown only in settings, never pushed at the user. */
  error: string;
  probedAt: number;
}

const INITIAL: LocalProbeState = { status: 'unknown', models: [], error: '', probedAt: 0 };

export const localProbe$ = writableSubject<LocalProbeState>(INITIAL);

/** Re-probing more often than this is pointless; the model list rarely changes. */
const PROBE_TTL_MS = 5 * 60_000;
const PROBE_TIMEOUT_MS = 2500;

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
    size?: number;
    details?: { family?: string; parameter_size?: string; quantization_level?: string };
  }>;
}

/**
 * Parameter counts arrive as strings like "14.8B" or "3B". Parsed to a number
 * so tasks can require a minimum size — a 1.5B model is fine for glossing a
 * word but should not be handed a chapter to translate.
 */
export function parseParameterBillions(parameterSize: string | undefined): number {
  if (!parameterSize) return 0;
  const match = /([\d.]+)\s*([BM])/i.exec(parameterSize);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  return match[2]?.toUpperCase() === 'M' ? value / 1000 : value;
}

/** Largest installed model wins — see the file header for why. */
export function pickDefaultLocalModel(models: readonly LocalModelInfo[]): string {
  let best: LocalModelInfo | undefined;
  for (const model of models) {
    if (!best || model.size > best.size) best = model;
  }
  return best?.id || '';
}

export async function probeLocalModels(force = false): Promise<LocalProbeState> {
  const current = localProbe$.getValue();
  if (
    !force &&
    current.status !== 'unknown' &&
    Date.now() - current.probedAt < PROBE_TTL_MS
  ) {
    return current;
  }
  if (current.status === 'probing') return current;

  localProbe$.next({ ...current, status: 'probing' });

  const baseUrl = (aiLocalBaseUrl$.getValue() || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as OllamaTagsResponse;
    const models: LocalModelInfo[] = (body.models || [])
      .map((entry) => ({
        id: entry.model || entry.name || '',
        size: typeof entry.size === 'number' ? entry.size : 0,
        family: entry.details?.family,
        parameterSize: entry.details?.parameter_size,
        quantization: entry.details?.quantization_level
      }))
      .filter((model) => !!model.id);

    const next: LocalProbeState = {
      status: models.length ? 'ready' : 'unavailable',
      models,
      error: models.length ? '' : 'runtime reachable but no models installed',
      probedAt: Date.now()
    };
    localProbe$.next(next);
    return next;
  } catch (error: any) {
    // A missing runtime is the common case, not an error worth surfacing.
    //
    // A running-but-unreachable runtime is the confusing case: this fetch is
    // cross-origin (app origin -> 127.0.0.1:11434), and Ollama only sends CORS
    // headers for origins listed in OLLAMA_ORIGINS. A rejected preflight and a
    // refused connection both surface as the same opaque TypeError, so the
    // message has to name both causes rather than guess.
    const isNetworkOpaque = error?.name === 'TypeError';
    const next: LocalProbeState = {
      status: 'unavailable',
      models: [],
      error:
        error?.name === 'AbortError'
          ? 'timeout'
          : isNetworkOpaque
            ? `unreachable — runtime not running, or its CORS allow-list (OLLAMA_ORIGINS) excludes ${
                typeof location !== 'undefined' ? location.origin : 'this app'
              }`
            : error?.message || String(error),
      probedAt: Date.now()
    };
    localProbe$.next(next);
    return next;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The model a task should use, or '' when local isn't usable. `minBillions`
 * lets a caller decline a model too small for the job rather than producing
 * bad output — glossing needs ~1.5B, literary translation wants 14B+.
 */
export function resolveLocalModel(minBillions = 0): string {
  const state = localProbe$.getValue();
  if (state.status !== 'ready' || !state.models.length) return '';

  const chosenId = aiLocalModel$.getValue();
  const chosen = chosenId ? state.models.find((model) => model.id === chosenId) : undefined;

  // An explicit choice is honoured even when it looks too small: the user may
  // know something the parameter string doesn't say, and silently substituting
  // a different model would be worse than a mediocre answer.
  if (chosen) return chosen.id;

  const eligible = minBillions
    ? state.models.filter((model) => parseParameterBillions(model.parameterSize) >= minBillions)
    : state.models;
  return pickDefaultLocalModel(eligible);
}
