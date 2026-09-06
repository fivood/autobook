<script lang="ts">
  /**
   * OCR settings, split out of the AI tab so the two OCR surfaces (scanned
   * PDFs in the reader, comic translation) each get their own defaults, and
   * books can remember a per-book language on top of them.
   *
   * `ocrLang` on a book overrides the relevant default when set; these
   * controls are the *defaults* that per-book choices fall back on. The
   * "clear memory" control clears the per-book skip list, not this page's
   * settings.
   */
  import { inputClasses } from '$lib/css-classes';
  import {
    aiOcrCorrectEnabled$,
    ocrModelProfile$,
    pdfOcrLang$,
    pdfOcrPromptEnabled$,
    pdfOcrSkippedBookIds$,
    translateComicAutoOcr$,
    translateLamaEndpoint$,
    translateOcrLang$
  } from '$lib/data/store';
  import {
    OCR_MODEL_PROFILES,
    OCR_LANGUAGE_OPTIONS,
    isOcrLanguageSupported,
    normalizeOcrModelProfile,
    type OcrLanguage,
    type OcrModelProfile
  } from '$lib/functions/file-loaders/pdf/ocr-options';
  import { t } from '$lib/i18n';

  $: activeProfile = normalizeOcrModelProfile($ocrModelProfile$);
  $: activeProfileInfo = OCR_MODEL_PROFILES.find((profile) => profile.id === activeProfile)!;

  function onModelProfileChange(event: Event) {
    const profile = normalizeOcrModelProfile((event.currentTarget as HTMLSelectElement).value);
    ocrModelProfile$.next(profile);
    // Never leave a hidden invalid combination behind after changing model.
    if (!isOcrLanguageSupported($pdfOcrLang$, profile)) pdfOcrLang$.next('ch');
    if (!isOcrLanguageSupported($translateOcrLang$, profile)) translateOcrLang$.next('japan');
  }

  function optionLabel(labelKey: string, lang: OcrLanguage, profile: OcrModelProfile): string {
    const label = $t(labelKey);
    return isOcrLanguageSupported(lang, profile)
      ? label
      : `${label}（${$t('settings.ocr.unsupported')}）`;
  }

  function clearOcrMemory() {
    pdfOcrSkippedBookIds$.next('');
  }
</script>

<div class="grid gap-6">
  <section>
    <h4 class="mb-1 font-medium">{$t('settings.ocr.modelHeading')}</h4>
    <p class="mb-3 opacity-70 leading-relaxed">{$t('settings.ocr.modelDescription')}</p>
    <label class="block">
      <span class="text-xs opacity-70">{$t('settings.ocr.model')}</span>
      <select class={inputClasses} value={activeProfile} on:change={onModelProfileChange}>
        {#each OCR_MODEL_PROFILES as profile (profile.id)}
          <option value={profile.id}>{$t(profile.labelKey)}</option>
        {/each}
      </select>
      <span class="mt-1 block text-xs opacity-60">{$t(activeProfileInfo.hintKey)}</span>
    </label>
  </section>

  <section>
    <h4 class="mb-1 font-medium">{$t('settings.ocr.pdfHeading')}</h4>
    <p class="mb-3 opacity-70 leading-relaxed">{$t('settings.ocr.pdfDescription')}</p>

    <label class="mb-3 block">
      <span class="text-xs opacity-70">{$t('settings.ocr.pdfLang')}</span>
      <select class={inputClasses} bind:value={$pdfOcrLang$}>
        {#each OCR_LANGUAGE_OPTIONS as lang (lang.code)}
          <option value={lang.code} disabled={!isOcrLanguageSupported(lang.code, activeProfile)}>
            {optionLabel(lang.labelKey, lang.code, activeProfile)}
          </option>
        {/each}
      </select>
    </label>

    <label class="mb-3 flex items-center gap-2">
      <input type="checkbox" bind:checked={$pdfOcrPromptEnabled$} />
      <span class="text-xs opacity-70">{$t('settings.ocr.pdfPrompt')}</span>
    </label>

    <div class="flex items-center gap-3">
      <span class="text-xs opacity-70">{$t('settings.ocr.pdfMemory')}</span>
      <button
        class="settings-btn"
        on:click={clearOcrMemory}
        disabled={!$pdfOcrSkippedBookIds$}
      >
        {$t('settings.ocr.clearMemory', { n: $pdfOcrSkippedBookIds$ ? $pdfOcrSkippedBookIds$.split(',').filter(Boolean).length : 0 })}
      </button>
    </div>
  </section>

  <section>
    <h4 class="mb-1 font-medium">{$t('settings.ocr.comicHeading')}</h4>
    <p class="mb-3 opacity-70 leading-relaxed">{$t('settings.ocr.comicDescription')}</p>

    <label class="mb-3 block">
      <span class="text-xs opacity-70">{$t('settings.ocr.comicLang')}</span>
      <select class={inputClasses} bind:value={$translateOcrLang$}>
        {#each OCR_LANGUAGE_OPTIONS as lang (lang.code)}
          <option value={lang.code} disabled={!isOcrLanguageSupported(lang.code, activeProfile)}>
            {optionLabel(lang.labelKey, lang.code, activeProfile)}
          </option>
        {/each}
      </select>
    </label>

    <label class="mb-3 flex items-center gap-2">
      <input type="checkbox" bind:checked={$translateComicAutoOcr$} />
      <span class="text-xs opacity-70">{$t('settings.translate.comicAutoOcr')}</span>
    </label>

    <label class="mb-3 block">
      <span class="text-xs opacity-70">{$t('settings.ocr.lamaEndpoint')}</span>
      <input type="text" class={inputClasses} bind:value={$translateLamaEndpoint$} spellcheck="false" placeholder="http://127.0.0.1:8080" />
      <span class="mt-1 block text-xs opacity-60">{$t('settings.ocr.lamaHint')}</span>
    </label>
  </section>

  <section>
    <h4 class="mb-1 font-medium">{$t('settings.ocr.correctHeading')}</h4>
    <p class="mb-3 opacity-70 leading-relaxed">{$t('settings.ocr.correctDescription')}</p>

    <label class="flex items-center gap-2">
      <input type="checkbox" bind:checked={$aiOcrCorrectEnabled$} />
      <span class="text-xs opacity-70">{$t('settings.ai.ocrCorrectToggle')}</span>
    </label>
  </section>
</div>
