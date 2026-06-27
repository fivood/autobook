<script lang="ts">
  import Fa from 'svelte-fa';
  import { faVolumeHigh, faVolumeXmark, faGears } from '@fortawesome/free-solid-svg-icons';
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

  export let autoReader: AutoReader | undefined;
  /** Section-relative char count to seek to when no resume position applies. */
  export let seekCharCount = 0;
  /** Saved in-section position to resume from (wins over seekCharCount). */
  export let resumePosition: { para: number; offset: number } | undefined = undefined;

  let enabled = false;
  let sub: Subscription | undefined;
  let showSettings = false;
  let voices: SpeechSynthesisVoice[] = [];
  let nativeVoices: { id: string; name: string; language: string }[] = [];

  async function loadNativeVoices() {
    nativeVoices = [];
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      nativeVoices = await invoke<typeof nativeVoices>('sapi_list_voices');
    } catch {
      nativeVoices = [];
    }
  }

  $: if ($ttsEngine$ === 'sapi') loadNativeVoices();

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
    document.addEventListener('click', handleDocClick, true);

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      document.removeEventListener('click', handleDocClick, true);
    };
  });

  onDestroy(() => {
    sub?.unsubscribe();
  });

  let settingsRoot: HTMLElement | undefined;
  function handleDocClick(ev: MouseEvent) {
    if (!showSettings) return;
    const t = ev.target as Node;
    if (settingsRoot && !settingsRoot.contains(t)) {
      showSettings = false;
    }
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

  function handleRateChange(ev: Event) {
    const v = +(ev.target as HTMLInputElement).value;
    readerRate$.next(v);
    if (autoReader) {
      autoReader.rate = v;
    }
  }

  function handleVoiceChange(ev: Event) {
    const uri = (ev.target as HTMLSelectElement).value;
    if ($ttsEngine$ === 'sapi') {
      ttsSapiVoiceId$.next(uri);
      if (autoReader) autoReader.voice = uri ? ({ voiceURI: uri } as SpeechSynthesisVoice) : undefined;
      return;
    }
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
  <div bind:this={settingsRoot} class="group fixed bottom-6 right-20 z-30 flex flex-col items-end gap-2">
    <button
      type="button"
      title={enabled ? '暂停朗读 (V)' : '开始朗读 (V)'}
      on:click={toggle}
      class="relative flex items-center justify-center rounded-full shadow-lg backdrop-blur transition-all duration-150"
      class:h-12={enabled || showSettings}
      class:w-12={enabled || showSettings}
      class:h-9={!enabled && !showSettings}
      class:w-9={!enabled && !showSettings}
      class:opacity-100={enabled || showSettings}
      class:opacity-30={!enabled && !showSettings}
      class:group-hover:opacity-95={!enabled && !showSettings}
      class:group-hover:h-12={!enabled && !showSettings}
      class:group-hover:w-12={!enabled && !showSettings}
      style="background-color: rgba(95, 126, 123, 0.92); color: #f0efe6;"
    >
      <Fa icon={enabled ? faVolumeHigh : faVolumeXmark} size="lg" />
      <span class="sr-only">{enabled ? '暂停' : '开始'}朗读</span>
    </button>

    <button
      type="button"
      title="语音设置"
      on:click={() => (showSettings = !showSettings)}
      class="flex h-9 w-9 items-center justify-center rounded-full shadow backdrop-blur transition-all duration-150"
      class:opacity-0={!enabled && !showSettings}
      class:pointer-events-none={!enabled && !showSettings}
      class:group-hover:opacity-100={!enabled && !showSettings}
      class:group-hover:pointer-events-auto={!enabled && !showSettings}
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
          <span>语音 ({$ttsEngine$ === 'sapi'
            ? '系统 SAPI'
            : $ttsEngine$ === 'custom'
              ? '自定义 HTTP'
              : $ttsEngine$ === 'kokoro'
                ? 'Kokoro 离线'
                : 'Web Speech'})</span>
          {#if $ttsEngine$ === 'sapi'}
            <select
              class="rounded bg-black/20 px-2 py-1 text-xs"
              value={$ttsSapiVoiceId$}
              on:change={handleVoiceChange}
            >
              <option value="">系统默认</option>
              {#each nativeVoices as voice (voice.id)}
                <option value={voice.id}>{voice.name} ({voice.language})</option>
              {/each}
            </select>
          {:else if $ttsEngine$ === 'custom'}
            <p class="text-xs opacity-80">使用「设置 → 自定义 HTTP TTS」里配的接口</p>
          {:else if $ttsEngine$ === 'kokoro'}
            <p class="text-xs opacity-80">音色在「设置 → 阅读 → Kokoro-82M」里选</p>
          {:else}
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
          {/if}
        </label>
      </div>
    {/if}
  </div>
{/if}
