<script lang="ts">
  import Fa from 'svelte-fa';
  import { faVolumeHigh, faVolumeXmark, faMinus, faPlus } from '@fortawesome/free-solid-svg-icons';
  import type { AutoReader } from '$lib/components/book-reader/types';
  import {
    readerRate$,
    readerVoiceUri$,
    ttsEngine$,
    ttsSapiVoiceId$,
    ttsStartStrategy$
  } from '$lib/data/store';
  import { onDestroy, onMount } from 'svelte';
  import type { Subscription } from 'rxjs';
  import { t } from '$lib/i18n';

  export let autoReader: AutoReader | undefined;
  /** Section-relative char count to seek to when no resume position applies. */
  export let seekCharCount = 0;
  /** Saved in-section position to resume from (wins over seekCharCount). */
  export let resumePosition: { para: number; offset: number } | undefined = undefined;

  let enabled = false;
  let sub: Subscription | undefined;
  let voices: SpeechSynthesisVoice[] = [];

  $: {
    sub?.unsubscribe();
    sub = autoReader?.wasReaderEnabled$.subscribe((v) => (enabled = v));
  }

  // Push the saved voice into the reader. Reactive so settings changes apply live.
  $: if (autoReader && $ttsEngine$ === 'sapi') {
    autoReader.voice = $ttsSapiVoiceId$
      ? ({ voiceURI: $ttsSapiVoiceId$ } as SpeechSynthesisVoice)
      : undefined;
  }
  // Custom engine: configuration is read directly from stores inside the
  // reader on each speak, so nothing to push from the FAB here.

  onMount(() => {
    const loadVoices = () => {
      const all = window.speechSynthesis.getVoices();
      const langPrefix = autoReader?.lang?.slice(0, 2);
      // Sort: current lang first, then zh/ja, then others
      if (langPrefix) {
        const current = all.filter((v) => v.lang.startsWith(langPrefix));
        const zh = all.filter((v) => !v.lang.startsWith(langPrefix) && v.lang.startsWith('zh'));
        const ja = all.filter((v) => !v.lang.startsWith(langPrefix) && v.lang.startsWith('ja'));
        const rest = all.filter(
          (v) =>
            !v.lang.startsWith(langPrefix) && !v.lang.startsWith('zh') && !v.lang.startsWith('ja')
        );
        voices = [...current, ...zh, ...ja, ...rest];
      } else {
        const zh = all.filter((v) => v.lang.startsWith('zh'));
        const ja = all.filter((v) => v.lang.startsWith('ja'));
        const rest = all.filter((v) => !v.lang.startsWith('zh') && !v.lang.startsWith('ja'));
        voices = [...zh, ...ja, ...rest];
      }

      const savedUri = $readerVoiceUri$;
      if (savedUri && autoReader) {
        const found = voices.find((v) => v.voiceURI === savedUri);
        if (found) {
          autoReader.voice = found;
          return;
        }
      }
      // If no saved voice or saved voice not found, auto-select based on lang
      if (autoReader) {
        autoReader.autoSelectVoice();
      }
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  });

  onDestroy(() => {
    sub?.unsubscribe();
  });

  // Web Speech voice is picked in 设置 → 阅读 now (the FAB's gear panel
  // is gone); react to the store so a change made there applies to a
  // reader opened later in the same session without reloading voices.
  $: if (autoReader && $ttsEngine$ !== 'sapi' && voices.length && $readerVoiceUri$) {
    const found = voices.find((v) => v.voiceURI === $readerVoiceUri$);
    if (found) autoReader.voice = found;
  }

  function toggle() {
    if (!enabled && autoReader) {
      autoReader.prepare();
      const strategy = $ttsStartStrategy$;

      // The reader knows its own contentEl, so let it figure out where the
      // selection maps to. /b's outer .book-content wrapper has different
      // text-node ordering than the inner container the reader extracts from,
      // which is why the FAB's old DOM walk gave the wrong char index.
      let seeked = false;
      if (strategy === 'selection') {
        seeked = autoReader.seekToSelection();
      }
      if (!seeked) {
        if (strategy === 'section-start') {
          autoReader.setPosition(0, 0);
        } else if (resumePosition) {
          // 'resume' strategy, or 'selection' fallback.
          autoReader.setPosition(resumePosition.para, resumePosition.offset);
        } else {
          autoReader.seekToExplored(seekCharCount);
        }
      }
    }
    autoReader?.toggle();
  }

  function setRate(next: number) {
    // 0.1 steps accumulate float dust (0.7000000000000001) — round back.
    const v = Math.round(Math.min(2, Math.max(0.5, next)) * 10) / 10;
    readerRate$.next(v);
    if (autoReader) {
      autoReader.rate = v;
    }
  }

  $: if (autoReader) {
    autoReader.rate = $readerRate$;
  }
</script>

{#if autoReader}
  <!-- The speaker shares the play button's row (same bottom anchor 64px,
       same h-9/h-12 sizes per state — aligned in EVERY state) and the
       rate pill OVERLAYS the typewriter speed pill's slot right under
       the play button: the two pills are mutually exclusive — TTS
       enabling turns the auto-scroller off, and AutoScrollFab hides its
       pill (incl. hover preview) whenever TTS is active. So this pill
       shows exactly when enabled, no hover preview.
       pointer-events-none on the container is load-bearing: its bbox
       (x24-128, y24-112) covers the play button and the shared pill
       slot, and this component mounts after AutoScrollFab — without it
       the container's empty area would eat clicks aimed at play.
       History: the old gear + settings panel sat below the speaker at
       bottom-6, exactly overlapping the typewriter's − speed button,
       and its hover-revealed gear ate clicks aimed at −. Voice
       selection moved to 设置 → 阅读; the FAB keeps only start/stop
       + rate. -->
  <div class="group pointer-events-none fixed bottom-6 right-6 z-30 flex flex-col items-end gap-2">
    <button
      type="button"
      title={enabled ? $t('tts.pause') : $t('tts.play')}
      on:click={toggle}
      class="pointer-events-auto relative mr-14 flex items-center justify-center rounded-full shadow-lg backdrop-blur transition-all duration-150"
      class:h-12={enabled}
      class:w-12={enabled}
      class:h-9={!enabled}
      class:w-9={!enabled}
      class:opacity-100={enabled}
      class:opacity-30={!enabled}
      class:group-hover:opacity-95={!enabled}
      class:group-hover:h-12={!enabled}
      class:group-hover:w-12={!enabled}
      style="background-color: var(--button-selected); color: var(--menu-foreground);"
    >
      <Fa icon={enabled ? faVolumeHigh : faVolumeXmark} size="lg" />
      <span class="sr-only">{enabled ? $t('tts.pauseAria') : $t('tts.playAria')}</span>
    </button>

    <div
      class="bg-menu text-menu flex items-center gap-1 rounded-full px-2 py-1 shadow backdrop-blur transition-all duration-150"
      class:opacity-0={!enabled}
      class:pointer-events-none={!enabled}
      class:pointer-events-auto={enabled}
    >
      <button
        type="button"
        title={$t('tts.rateSlower')}
        on:click={() => setRate($readerRate$ - 0.1)}
        class="hover-menu-inverted flex h-6 w-6 items-center justify-center rounded-full"
      >
        <Fa icon={faMinus} size="xs" />
      </button>
      <span class="min-w-[2rem] text-center text-[10px]">{$readerRate$}×</span>
      <button
        type="button"
        title={$t('tts.rateFaster')}
        on:click={() => setRate($readerRate$ + 0.1)}
        class="hover-menu-inverted flex h-6 w-6 items-center justify-center rounded-full"
      >
        <Fa icon={faPlus} size="xs" />
      </button>
    </div>
  </div>
{/if}
