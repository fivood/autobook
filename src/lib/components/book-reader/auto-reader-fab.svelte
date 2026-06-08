<script lang="ts">
  import Fa from 'svelte-fa';
  import { faVolumeHigh, faVolumeXmark, faGears } from '@fortawesome/free-solid-svg-icons';
  import type { AutoReader } from '$lib/components/book-reader/types';
  import { readerRate$, readerVoiceUri$ } from '$lib/data/store';
  import { onDestroy, onMount } from 'svelte';
  import type { Subscription } from 'rxjs';

  export let autoReader: AutoReader | undefined;
  export let exploredCharCount = 0;

  let enabled = false;
  let sub: Subscription | undefined;
  let showSettings = false;
  let voices: SpeechSynthesisVoice[] = [];

  $: {
    sub?.unsubscribe();
    sub = autoReader?.wasReaderEnabled$.subscribe((v) => (enabled = v));
  }

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
    window.speechSynthesis.onvoiceschanged = loadVoices;
  });

  onDestroy(() => {
    sub?.unsubscribe();
  });

  function toggle() {
    if (!enabled) {
      autoReader?.prepare();
      autoReader?.seekToExplored(exploredCharCount);
    }
    autoReader?.toggle();
  }

  function handleRateChange(ev: Event) {
    const v = +(ev.target as HTMLInputElement).value;
    readerRate$.next(v);
    if (autoReader) {
      autoReader.rate = v;
    }
  }

  function handleVoiceChange(ev: Event) {
    const uri = (ev.target as HTMLSelectElement).value;
    readerVoiceUri$.next(uri);
    const found = voices.find((v) => v.voiceURI === uri);
    if (autoReader && found) {
      autoReader.voice = found;
    }
  }

  $: if (autoReader) {
    autoReader.rate = $readerRate$;
  }
</script>

{#if autoReader}
  <div class="fixed bottom-6 right-20 z-30 flex flex-col items-end gap-2">
    <button
      type="button"
      title={enabled ? '暂停朗读 (V)' : '开始朗读 (V)'}
      on:click={toggle}
      class="relative flex h-12 w-12 items-center justify-center rounded-full shadow-lg backdrop-blur"
      class:opacity-90={!enabled}
      class:opacity-100={enabled}
      style="background-color: rgba(95, 126, 123, 0.92); color: #f0efe6;"
    >
      <Fa icon={enabled ? faVolumeHigh : faVolumeXmark} size="lg" />
      <span class="sr-only">{enabled ? '暂停' : '开始'}朗读</span>
    </button>

    <button
      type="button"
      title="语音设置"
      on:click={() => (showSettings = !showSettings)}
      class="flex h-9 w-9 items-center justify-center rounded-full shadow backdrop-blur"
      style="background-color: rgba(195, 193, 175, 0.9); color: #405a5c;"
    >
      <Fa icon={faGears} />
    </button>

    {#if showSettings}
      <div
        class="flex flex-col gap-2 rounded-lg p-3 shadow-lg"
        style="background-color: rgba(43, 90, 105, 0.95); color: #f0efe6;"
      >
        <label class="flex items-center gap-2 text-xs">
          <span>语速</span>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={$readerRate$}
            on:input={handleRateChange}
          />
          <span>{$readerRate$}×</span>
        </label>

        <label class="flex flex-col gap-1 text-xs">
          <span>语音</span>
          <select
            class="rounded bg-black/20 px-2 py-1 text-xs"
            value={$readerVoiceUri$}
            on:change={handleVoiceChange}
          >
            <option value="">系统默认</option>
            {#each voices as voice}
              <option value={voice.voiceURI}>
                {voice.name} ({voice.lang})
              </option>
            {/each}
          </select>
        </label>
      </div>
    {/if}
  </div>
{/if}
