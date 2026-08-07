<script lang="ts">
  /**
   * One place for every model endpoint the app talks to.
   *
   * Before this, cloud AI config lived inside the reader's AI drawer (you had
   * to open a book to reach it), the local-runtime settings had no UI at all,
   * and the gloss toggle was read but never settable. Those are the same kind
   * of setting and belong together — a user deciding "what model does what"
   * should not have to know which feature happened to ship the control.
   *
   * TTS keeps its own section: its config is about voices and playback, not
   * about which LLM answers a request.
   */
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faRotateRight, faCheck, faCircleQuestion } from '@fortawesome/free-solid-svg-icons';
  import { inputClasses } from '$lib/css-classes';
  import {
    aiApiKey$,
    aiBaseUrl$,
    aiGlossEnabled$,
    aiLocalBaseUrl$,
    aiLocalModel$,
    aiModel$,
    aiProvider$,
    translateBatchSegments$,
    translateChunkChars$,
    translateDraftSource$,
    translateLocalModel$,
    translateMaxSourceChars$,
    translateReviewSource$,
    translateTargetLang$
  } from '$lib/data/store';
  import {
    localProbe$,
    parseParameterBillions,
    probeLocalModels,
    resolveLocalModel
  } from '$lib/data/ai/local-model';
  import { t } from '$lib/i18n';

  let probing = false;

  onMount(() => {
    probeLocalModels().catch(() => {
      // Failure is already folded into localProbe$; nothing to surface here.
    });
  });

  async function reprobe() {
    probing = true;
    try {
      await probeLocalModels(true);
    } finally {
      probing = false;
    }
  }

  function formatSize(bytes: number): string {
    if (!bytes) return '';
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }

  /**
   * resolveLocalModel reads localProbe$ / aiLocalModel$ through getValue(),
   * which Svelte's reactive tracker cannot see. The unused parameters exist
   * only to declare those dependencies at the call site — without them the
   * results freeze at their pre-probe values (the auto-pick label rendered
   * empty, and the per-feature lines never followed the dropdown).
   */
  function pickLocal(minBillions: number, _probe: unknown, _chosen: unknown): string {
    return resolveLocalModel(minBillions);
  }

  $: models = $localProbe$.models;
  $: autoPick = pickLocal(0, $localProbe$, $aiLocalModel$);
  // What each feature would actually use right now, so the effect of a change
  // is visible here instead of only at the point of use.
  $: glossModel = pickLocal(1.5, $localProbe$, $aiLocalModel$) || (($aiApiKey$ && $aiModel$) || '');
</script>

<div class="text-sm">
  <!-- ── Local runtime ─────────────────────────────────────────────── -->
  <h4 class="mb-1 font-medium">{$t('settings.ai.localHeading')}</h4>
  <p class="mb-3 opacity-70 leading-relaxed">{$t('settings.ai.localDescription')}</p>

  <label class="mb-3 block">
    <span class="text-xs opacity-70">{$t('settings.ai.localBaseUrl')}</span>
    <input type="text" class={inputClasses} bind:value={$aiLocalBaseUrl$} spellcheck="false" />
  </label>

  <div class="mb-3 flex items-center gap-2">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-current/30 px-2 py-1 text-xs hover-soft disabled:opacity-50"
      disabled={probing}
      on:click={reprobe}
    >
      <Fa icon={faRotateRight} size="xs" spin={probing} />
      {probing ? $t('settings.ai.probing') : $t('settings.ai.reprobe')}
    </button>

    {#if $localProbe$.status === 'ready'}
      <span class="inline-flex items-center gap-1.5 text-xs" style="color:var(--link-color)">
        <Fa icon={faCheck} size="xs" />
        {$t('settings.ai.foundModels', { n: models.length })}
      </span>
    {:else if $localProbe$.status === 'unavailable'}
      <span class="inline-flex items-center gap-1.5 text-xs opacity-60" title={$localProbe$.error}>
        <Fa icon={faCircleQuestion} size="xs" />
        {$t('settings.ai.notDetected')}
      </span>
    {/if}
  </div>

  {#if $localProbe$.status === 'unavailable' && $localProbe$.error}
    <!-- A rejected CORS preflight and a runtime that is not running are the
         same opaque TypeError in the browser, so the raw reason is shown
         rather than guessed at. -->
    <p class="mb-3 rounded border border-current/20 p-2 text-xs opacity-70 leading-relaxed">
      {$localProbe$.error}
      <br />
      {$t('settings.ai.corsHint')}
    </p>
  {/if}

  {#if models.length}
    <label class="mb-3 block">
      <span class="text-xs opacity-70">{$t('settings.ai.localModel')}</span>
      <select class={inputClasses} bind:value={$aiLocalModel$}>
        <option value="">{$t('settings.ai.autoLargest', { model: autoPick })}</option>
        {#each models as m (m.id)}
          <option value={m.id}>
            {m.id}
            {m.parameterSize ? ` · ${m.parameterSize}` : ''}
            {m.size ? ` · ${formatSize(m.size)}` : ''}
          </option>
        {/each}
      </select>
    </label>
  {/if}

  <!-- ── Cloud endpoint ────────────────────────────────────────────── -->
  <h4 class="mb-1 mt-5 font-medium">{$t('settings.ai.cloudHeading')}</h4>
  <p class="mb-3 opacity-70 leading-relaxed">{$t('settings.ai.cloudDescription')}</p>

  <label class="mb-3 block">
    <span class="text-xs opacity-70">{$t('settings.ai.provider')}</span>
    <select class={inputClasses} bind:value={$aiProvider$}>
      <option value="anthropic">Anthropic</option>
      <option value="openai">{$t('ai.providerOpenaiLabel')}</option>
    </select>
  </label>

  <label class="mb-3 block">
    <span class="text-xs opacity-70">{$t('settings.ai.apiKey')}</span>
    <input type="password" class={inputClasses} bind:value={$aiApiKey$} spellcheck="false" />
  </label>

  <label class="mb-3 block">
    <span class="text-xs opacity-70">{$t('settings.ai.model')}</span>
    <input type="text" class={inputClasses} bind:value={$aiModel$} spellcheck="false" />
  </label>

  <label class="mb-3 block">
    <span class="text-xs opacity-70">{$t('settings.ai.baseUrl')}</span>
    <input type="text" class={inputClasses} bind:value={$aiBaseUrl$} spellcheck="false" />
  </label>

  <!-- ── Per-feature switches ──────────────────────────────────────── -->
  <h4 class="mb-1 mt-5 font-medium">{$t('settings.ai.featuresHeading')}</h4>
  <p class="mb-3 opacity-70 leading-relaxed">{$t('settings.ai.featuresDescription')}</p>

  <label class="mb-2 flex items-start gap-2">
    <input type="checkbox" class="mt-1" bind:checked={$aiGlossEnabled$} />
    <span>
      {$t('settings.ai.glossToggle')}
      <span class="block text-xs opacity-60">
        {glossModel
          ? $t('settings.ai.wouldUse', { model: glossModel })
          : $t('settings.ai.noEndpoint')}
      </span>
    </span>
  </label>

  {#if models.length && !models.some((m) => parseParameterBillions(m.parameterSize) >= 3)}
    <p class="mt-2 text-xs opacity-60">{$t('settings.ai.allModelsSmall')}</p>
  {/if}

  <p class="mt-4 text-xs opacity-50 leading-relaxed">{$t('settings.ai.spoilerNote')}</p>

  <!-- ── Translation workbench defaults ───────────────────────────── -->
  <h4 class="mb-1 mt-5 font-medium">{$t('settings.translate.heading')}</h4>
  <p class="mb-3 opacity-70 leading-relaxed">{$t('settings.translate.description')}</p>

  <label class="mb-3 block">
    <span class="text-xs opacity-70">{$t('settings.translate.targetLang')}</span>
    <input type="text" class={inputClasses} bind:value={$translateTargetLang$} spellcheck="false" />
  </label>

  <div class="mb-3 grid gap-3 sm:grid-cols-2">
    <label class="block">
      <span class="text-xs opacity-70">{$t('settings.translate.draftSource')}</span>
      <select class={inputClasses} bind:value={$translateDraftSource$}>
        <option value="local">{$t('translate.source.local')}</option>
        <option value="cloud">{$t('translate.source.cloud')}</option>
      </select>
    </label>
    <label class="block">
      <span class="text-xs opacity-70">{$t('settings.translate.reviewSource')}</span>
      <select class={inputClasses} bind:value={$translateReviewSource$}>
        <option value="local">{$t('translate.source.local')}</option>
        <option value="cloud">{$t('translate.source.cloud')}</option>
      </select>
    </label>
  </div>

  {#if models.length}
    <label class="mb-3 block">
      <span class="text-xs opacity-70">{$t('settings.translate.localModel')}</span>
      <select class={inputClasses} bind:value={$translateLocalModel$}>
        <option value="">{$t('settings.ai.autoLargest', { model: autoPick })}</option>
        {#each models as m (m.id)}
          <option value={m.id}>{m.id}</option>
        {/each}
      </select>
    </label>
  {/if}

  <label class="mb-3 block">
    <span class="text-xs opacity-70">{$t('settings.translate.chunkChars')}</span>
    <input type="number" class={inputClasses} min="4000" max="100000" step="1000" bind:value={$translateChunkChars$} />
  </label>

  <div class="mb-3 grid gap-3 sm:grid-cols-2">
    <label class="block">
      <span class="text-xs opacity-70">{$t('settings.translate.batchSegments')}</span>
      <input type="number" class={inputClasses} min="1" max="50" step="1" bind:value={$translateBatchSegments$} />
    </label>
    <label class="block">
      <span class="text-xs opacity-70">{$t('settings.translate.maxSourceChars')}</span>
      <input type="number" class={inputClasses} min="500" max="60000" step="500" bind:value={$translateMaxSourceChars$} />
    </label>
  </div>
</div>
