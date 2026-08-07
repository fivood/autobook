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
    pdfOcrLang$,
    pdfOcrPromptEnabled$,
    pdfOcrSkippedBookIds$,
    translateComicAutoOcr$,
    translateOcrLang$
  } from '$lib/data/store';
  import { t } from '$lib/i18n';

  function clearOcrMemory() {
    pdfOcrSkippedBookIds$.next('');
  }
</script>

<div class="grid gap-6">
  <section>
    <h4 class="mb-1 font-medium">{$t('settings.ocr.pdfHeading')}</h4>
    <p class="mb-3 opacity-70 leading-relaxed">{$t('settings.ocr.pdfDescription')}</p>

    <label class="mb-3 block">
      <span class="text-xs opacity-70">{$t('settings.ocr.pdfLang')}</span>
      <select class={inputClasses} bind:value={$pdfOcrLang$}>
        <option value="ch">{$t('settings.ocr.pdfLang.ch')}</option>
        <option value="chinese_cht">{$t('settings.ocr.pdfLang.cht')}</option>
        <option value="japan">{$t('settings.ocr.pdfLang.japan')}</option>
        <option value="korean">{$t('settings.ocr.pdfLang.korean')}</option>
        <option value="en">{$t('settings.ocr.pdfLang.en')}</option>
      </select>
    </label>

    <label class="mb-3 flex items-center gap-2">
      <input type="checkbox" bind:checked={$pdfOcrPromptEnabled$} />
      <span class="text-xs opacity-70">{$t('settings.ocr.pdfPrompt')}</span>
    </label>

    <div class="flex items-center gap-3">
      <span class="text-xs opacity-70">{$t('settings.ocr.pdfMemory')}</span>
      <button
        class="rounded border border-current/40 px-3 py-1.5 text-xs hover-soft disabled:opacity-50"
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
        <option value="japan">{$t('settings.translate.ocrLang.japan')}</option>
        <option value="ch">{$t('settings.translate.ocrLang.ch')}</option>
        <option value="chinese_cht">{$t('settings.translate.ocrLang.cht')}</option>
        <option value="en">{$t('settings.translate.ocrLang.en')}</option>
        <option value="korean">{$t('settings.translate.ocrLang.korean')}</option>
        <option value="french">{$t('settings.translate.ocrLang.fr')}</option>
        <option value="german">{$t('settings.translate.ocrLang.de')}</option>
        <option value="es">{$t('settings.translate.ocrLang.es')}</option>
        <option value="it">{$t('settings.translate.ocrLang.it')}</option>
        <option value="pt">{$t('settings.translate.ocrLang.pt')}</option>
        <option value="nl">{$t('settings.translate.ocrLang.nl')}</option>
        <option value="pl">{$t('settings.translate.ocrLang.pl')}</option>
        <option value="tr">{$t('settings.translate.ocrLang.tr')}</option>
        <option value="vi">{$t('settings.translate.ocrLang.vi')}</option>
      </select>
    </label>

    <label class="mb-3 flex items-center gap-2">
      <input type="checkbox" bind:checked={$translateComicAutoOcr$} />
      <span class="text-xs opacity-70">{$t('settings.translate.comicAutoOcr')}</span>
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
