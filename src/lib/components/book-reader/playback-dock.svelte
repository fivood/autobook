<script lang="ts">
  import { browser } from '$app/environment';
  import Fa from 'svelte-fa';
  import {
    faForward,
    faICursor,
    faMinus,
    faPause,
    faPlus,
    faRotateRight,
    faVolumeHigh
  } from '@fortawesome/free-solid-svg-icons';
  import type { AutoReader, AutoScroller } from '$lib/components/book-reader/types';
  import {
    autoScrollStopAtChapter$,
    multiplier$,
    readerRate$,
    ttsVoiceByLang$
  } from '$lib/data/store';
  import { onDestroy, onMount } from 'svelte';
  import type { Subscription } from 'rxjs';
  import { t } from '$lib/i18n';

  export let autoScroller: AutoScroller | undefined;
  export let autoReader: AutoReader | undefined;
  /** /b's start / stop for the voice, shared with V and the tray so every
   *  route starts from the same place. */
  export let toggleTts: () => void;

  let typing = false;
  let speaking = false;
  /**
   * The engine that played last. Its speed stays out while it is paused, so
   * the speed for the next play can be set: pausing used to take the only
   * speed control away with it.
   */
  let lastEngine: 'tts' | 'typewriter' | undefined;
  let typingSub: Subscription | undefined;
  let speakingSub: Subscription | undefined;

  $: {
    typingSub?.unsubscribe();
    typingSub = autoScroller?.wasAutoScrollerEnabled$.subscribe((on) => {
      typing = on;
      if (on) lastEngine = 'typewriter';
    });
  }

  $: {
    speakingSub?.unsubscribe();
    speakingSub = autoReader?.wasReaderEnabled$.subscribe((on) => {
      speaking = on;
      if (on) lastEngine = 'tts';
    });
  }

  $: playing = typing || speaking;
  $: ttsPill = speaking ? 'on' : lastEngine === 'tts' ? 'paused' : 'off';
  $: typingPill = typing ? 'on' : lastEngine === 'typewriter' ? 'paused' : 'off';

  let recentlyMoved = true;
  let hovered = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  // Dim 1.2s after the last mouse move while either engine plays — the state
  // stays readable without sitting on the line being read or typed. It used
  // to apply to the typewriter only, and the voice's button stayed opaque.
  $: faded = playing && !recentlyMoved && !hovered;

  function nudge() {
    recentlyMoved = true;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (recentlyMoved = false), 1200);
  }

  // Voice resolution lives in the reader (autoSelectVoice reads the
  // per-language slot); this only re-runs it when the slots change, i.e.
  // while the settings drawer is open over the reader.
  $: if (autoReader && $ttsVoiceByLang$) autoReader.autoSelectVoice();

  $: if (autoReader) autoReader.rate = $readerRate$;

  onMount(() => {
    if (!browser) return;
    nudge();
    window.addEventListener('mousemove', nudge);
    // Chrome hands back an empty getVoices() until the engine warms up, so the
    // reader's first lookup had nothing to match — re-run it once they land.
    const rerunVoiceLookup = () => autoReader?.autoSelectVoice();
    rerunVoiceLookup();
    window.speechSynthesis.addEventListener('voiceschanged', rerunVoiceLookup);
    return () => {
      window.removeEventListener('mousemove', nudge);
      window.speechSynthesis.removeEventListener('voiceschanged', rerunVoiceLookup);
    };
  });

  onDestroy(() => {
    typingSub?.unsubscribe();
    speakingSub?.unsubscribe();
    if (idleTimer) clearTimeout(idleTimer);
  });

  function setRate(next: number) {
    // 0.1 steps accumulate float dust (0.7000000000000001) — round back.
    readerRate$.next(Math.round(Math.min(2, Math.max(0.5, next)) * 10) / 10);
  }

  function setMultiplier(next: number) {
    const v = Math.min(60, Math.max(1, next));
    multiplier$.next(v);
    if (autoScroller) autoScroller.multiplier = v;
  }
</script>

{#if autoScroller || autoReader}
  <!-- One dock, one row per engine, each speed beside its own button. These
       were two components stacked on the same corner, dodging each other with
       pointer-events and a margin, and sharing one speed slot that a hidden
       flag handed back and forth — which is how starting the typewriter with
       Space left the voice's rate under the typewriter's button.

       pointer-events-none on the container keeps the empty parts of its box
       from eating clicks meant for the text below. Hovering or focusing any
       control still counts as hovering the container, which is what previews
       the hidden speeds; a hidden one stays pointer-events-none until then
       (CLAUDE.md: no invisible-but-clickable controls). Each speed pill sits
       flush against its button so the pointer can cross from one to the
       other without the preview dropping. -->
  <div
    class="group pointer-events-none fixed bottom-6 right-6 z-30 flex flex-col items-end gap-2 transition-opacity duration-300"
    class:opacity-20={faded}
    on:mouseenter={() => (hovered = true)}
    on:mouseleave={() => (hovered = false)}
    role="toolbar"
    tabindex="-1"
    aria-label={$t('playback.dockAria')}
  >
    <!-- 章止 stops whichever engine is playing, so it shows while either does. -->
    <button
      type="button"
      title={$autoScrollStopAtChapter$
        ? $t('typewriter.chapterStop.tooltipOn')
        : $t('typewriter.chapterStop.tooltipOff')}
      on:click={() => autoScrollStopAtChapter$.next(!$autoScrollStopAtChapter$)}
      class="dock-focus menu-surface mr-1.5 flex h-9 items-center gap-1 rounded-full px-3 text-sm backdrop-blur transition-opacity duration-150"
      class:opacity-0={!playing}
      class:pointer-events-none={!playing}
      class:pointer-events-auto={playing}
      class:group-hover:opacity-100={!playing}
      class:group-hover:pointer-events-auto={!playing}
      class:group-focus-within:opacity-100={!playing}
      class:group-focus-within:pointer-events-auto={!playing}
    >
      <Fa icon={$autoScrollStopAtChapter$ ? faRotateRight : faForward} />
      <span
        >{$autoScrollStopAtChapter$
          ? $t('typewriter.chapterStop.on')
          : $t('typewriter.chapterStop.off')}</span
      >
    </button>

    {#if autoReader}
      <div class="flex items-center">
        <div
          class="menu-surface flex items-center rounded-full p-1 backdrop-blur transition-opacity duration-150"
          class:opacity-0={ttsPill === 'off'}
          class:opacity-70={ttsPill === 'paused'}
          class:pointer-events-none={ttsPill === 'off'}
          class:pointer-events-auto={ttsPill !== 'off'}
          class:group-hover:opacity-100={ttsPill !== 'on'}
          class:group-hover:pointer-events-auto={ttsPill === 'off'}
          class:group-focus-within:opacity-100={ttsPill !== 'on'}
          class:group-focus-within:pointer-events-auto={ttsPill === 'off'}
        >
          <button
            type="button"
            title={$t('tts.rateSlower')}
            on:click={() => setRate($readerRate$ - 0.1)}
            class="dock-focus hover-menu-inverted flex h-8 w-8 items-center justify-center rounded-full"
          >
            <Fa icon={faMinus} size="xs" />
          </button>
          <span class="min-w-[2.75rem] text-center text-sm tabular-nums">{$readerRate$}×</span>
          <button
            type="button"
            title={$t('tts.rateFaster')}
            on:click={() => setRate($readerRate$ + 0.1)}
            class="dock-focus hover-menu-inverted flex h-8 w-8 items-center justify-center rounded-full"
          >
            <Fa icon={faPlus} size="xs" />
          </button>
        </div>
        <button
          type="button"
          title={speaking ? $t('tts.pause') : $t('tts.play')}
          on:click={toggleTts}
          class="dock-focus pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full"
        >
          <span
            class="flex items-center justify-center rounded-full shadow-lg backdrop-blur transition-all duration-150"
            class:h-12={speaking}
            class:w-12={speaking}
            class:h-9={!speaking}
            class:w-9={!speaking}
            class:opacity-30={!speaking}
            class:group-hover:opacity-95={!speaking}
            class:group-hover:h-12={!speaking}
            class:group-hover:w-12={!speaking}
            style="background-color: var(--button-selected); color: var(--menu-foreground);"
          >
            <Fa icon={speaking ? faPause : faVolumeHigh} size="lg" />
          </span>
          <span class="sr-only">{speaking ? $t('tts.pauseAria') : $t('tts.playAria')}</span>
        </button>
      </div>
    {/if}

    {#if autoScroller}
      <div class="flex items-center">
        <div
          class="menu-surface flex items-center rounded-full p-1 backdrop-blur transition-opacity duration-150"
          class:opacity-0={typingPill === 'off'}
          class:opacity-70={typingPill === 'paused'}
          class:pointer-events-none={typingPill === 'off'}
          class:pointer-events-auto={typingPill !== 'off'}
          class:group-hover:opacity-100={typingPill !== 'on'}
          class:group-hover:pointer-events-auto={typingPill === 'off'}
          class:group-focus-within:opacity-100={typingPill !== 'on'}
          class:group-focus-within:pointer-events-auto={typingPill === 'off'}
        >
          <button
            type="button"
            title={$t('typewriter.slower')}
            on:click={() => setMultiplier($multiplier$ - 1)}
            class="dock-focus hover-menu-inverted flex h-8 w-8 items-center justify-center rounded-full"
          >
            <Fa icon={faMinus} size="xs" />
          </button>
          <span class="min-w-[2.75rem] text-center text-sm tabular-nums"
            >{$t('typewriter.speedUnit', { n: $multiplier$ })}</span
          >
          <button
            type="button"
            title={$t('typewriter.faster')}
            on:click={() => setMultiplier($multiplier$ + 1)}
            class="dock-focus hover-menu-inverted flex h-8 w-8 items-center justify-center rounded-full"
          >
            <Fa icon={faPlus} size="xs" />
          </button>
        </div>
        <button
          type="button"
          title={typing ? $t('typewriter.pause') : $t('typewriter.play')}
          on:click={() => autoScroller?.toggle()}
          class="dock-focus pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full"
        >
          <span
            class="flex items-center justify-center rounded-full shadow-lg backdrop-blur transition-all duration-150"
            class:h-12={typing}
            class:w-12={typing}
            class:h-9={!typing}
            class:w-9={!typing}
            class:opacity-30={!typing}
            class:group-hover:opacity-95={!typing}
            class:group-hover:h-12={!typing}
            class:group-hover:w-12={!typing}
            style="background-color: var(--button-selected); color: var(--menu-foreground);"
          >
            <!-- Idle, each button says which engine it is (▶ said only
                 "play", next to a speaker that said "what"). A text caret, not
                 a keyboard: the shortcut help in the opposite corner is the
                 keyboard. -->
            <Fa icon={typing ? faPause : faICursor} size="lg" />
          </span>
          <span class="sr-only">{typing ? $t('typewriter.pauseAria') : $t('typewriter.playAria')}</span>
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Keyboard focus has to show on a control that is otherwise at 30%
     opacity; the ring takes the reader's own text colour. */
  .dock-focus:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
</style>
