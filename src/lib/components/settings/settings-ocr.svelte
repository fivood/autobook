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
  import SettingsSectionHeader from '$lib/components/settings/settings-section-header.svelte';
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

<div>
  <SettingsSectionHeader title={$t('settings.ocr.modelHeading')} hint={$t('settings.ocr.modelDescription')} />
  <div class="settings-fields">
    <label class="block">
      <span class="settings-field-label">{$t('settings.ocr.model')}</span>
      <select class={inputClasses} value={activeProfile} on:change={onModelProfileChange}>
        {#each OCR_MODEL_PROFILES as profile (profile.id)}
          <option value={profile.id}>{$t(profile.labelKey)}</option>
        {/each}
      </select>
      <span class="mt-1 block text-xs text-muted">{$t(activeProfileInfo.hintKey)}</span>
    </label>
  </div>

  <SettingsSectionHeader title={$t('settings.ocr.pdfHeading')} hint={$t('settings.ocr.pdfDescription')} />
  <div class="settings-fields">

    <label class="mb-3 block">
      <span class="settings-field-label">{$t('settings.ocr.pdfLang')}</span>
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
      <span>{$t('settings.ocr.pdfPrompt')}</span>
    </label>

    <div class="flex items-center gap-3">
      <span class="font-semibold">{$t('settings.ocr.pdfMemory')}</span>
      <button
        class="settings-btn"
        on:click={clearOcrMemory}
        disabled={!$pdfOcrSkippedBookIds$}
      >
        {$t('settings.ocr.clearMemory', { n: $pdfOcrSkippedBookIds$ ? $pdfOcrSkippedBookIds$.split(',').filter(Boolean).length : 0 })}
      </button>
    </div>
  </div>

  <SettingsSectionHeader title={$t('settings.ocr.comicHeading')} hint={$t('settings.ocr.comicDescription')} />
  <div class="settings-fields">

    <label class="mb-3 block">
      <span class="settings-field-label">{$t('settings.ocr.comicLang')}</span>
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
      <span>{$t('settings.translate.comicAutoOcr')}</span>
    </label>

    <label class="mb-3 block">
      <span class="settings-field-label">{$t('settings.ocr.lamaEndpoint')}</span>
      <input type="text" class={inputClasses} bind:value={$translateLamaEndpoint$} spellcheck="false" placeholder="http://127.0.0.1:8080" />
      <span class="mt-1 block text-xs text-muted">{$t('settings.ocr.lamaHint')}</span>
    </label>
  </div>

  <SettingsSectionHeader title={$t('settings.ocr.correctHeading')} hint={$t('settings.ocr.correctDescription')} />
  <div class="settings-fields">

    <label class="flex items-center gap-2">
      <input type="checkbox" bind:checked={$aiOcrCorrectEnabled$} />
      <span>{$t('settings.ai.ocrCorrectToggle')}</span>
    </label>
  </div>
</div>
