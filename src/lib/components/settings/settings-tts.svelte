<script lang="ts">
  import { browser } from '$app/environment';
  import { onDestroy } from 'svelte';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import { optionsForToggle } from '$lib/components/button-toggle-group/toggle-option';
  import Ripple from '$lib/components/ripple.svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSectionHeader from '$lib/components/settings/settings-section-header.svelte';
  import { isTauri } from '$lib/data/env';
  import { getEdgeVoiceGroups, getEdgeVoiceIds } from '$lib/data/edge-voices';
  import {
    getDefaultKokoroVoice,
    getKokoroVoiceGroups,
    getKokoroVoices
  } from '$lib/data/kokoro-voices';
  import {
    kokoroAccepted$,
    kokoroLoadStatus$,
    kokoroModel$,
    kokoroVoiceId$,
    readerVoiceUri$,
    ttsAutoAdvanceSection$,
    ttsCustomActivePreset$,
    ttsCustomAudioPath$,
    ttsCustomBody$,
    ttsCustomEndpoint$,
    ttsCustomHeaders$,
    ttsCustomMethod$,
    ttsCustomPresetStates$,
    ttsCustomProxyUrl$,
    ttsEdgeProxyUrl$,
    ttsEdgeVoiceId$,
    ttsEngine$,
    ttsSapiVoiceId$,
    ttsShortcut$,
    ttsStartStrategy$,
    ttsVoiceByLang$,
    type KokoroModelId
  } from '$lib/data/store';
  import { checkVoiceSelection } from '$lib/data/tts/voice-availability';
  import {
    TTS_LANGS,
    langSlotOf,
    pickVoice,
    setVoiceForLang,
    type TtsLang
  } from '$lib/data/tts/voice-by-lang';
  import {
    CUSTOM_PRESETS,
    PRESET_CATEGORY_LABEL,
    PRESET_CATEGORY_ORDER,
    TTS_STYLE_PRESETS,
    type CustomPreset,
    type PresetCategory
  } from '$lib/data/tts-presets';
  import { t, tImmediate } from '$lib/i18n';

  /** The reader's settings drawer already names itself in its own title bar,
   * and the section header's 1.6rem heading + divider reads as a second title
   * inside a 28rem panel. Off there, on in the full settings page. */
  export let showSectionHeader = true;

  /** The open book's language tag, when this panel is shown inside the reader.
   * It only picks which slot the panel starts on — every slot stays editable,
   * so you can set up the Japanese voice while reading a Chinese book. */
  export let bookLanguage: string | undefined = undefined;

  let activeLang: TtsLang = langSlotOf(bookLanguage);

  $: voiceLangOptions = TTS_LANGS.map((id) => ({ id, text: $t(`settings.tts.lang.${id}`) }));

  // The engine stores below are the pre-slot values; they stand in for any
  // slot the user has not set, which is what keeps upgrades silent.
  $: webVoice = pickVoice($ttsVoiceByLang$, 'web', activeLang, $readerVoiceUri$);
  $: sapiVoice = pickVoice($ttsVoiceByLang$, 'sapi', activeLang, $ttsSapiVoiceId$);
  $: edgeVoice = pickVoice($ttsVoiceByLang$, 'edge', activeLang, $ttsEdgeVoiceId$);
  $: kokoroVoice = pickVoice($ttsVoiceByLang$, 'kokoro', activeLang, $kokoroVoiceId$);

  /** Clearing a slot has to clear the legacy store with it — otherwise the
   * slot falls back to it and "系统默认" silently snaps to the old voice. */
  function pickVoiceFor(
    engine: string,
    legacy: { next: (v: string) => void },
    voiceId: string
  ) {
    setVoiceForLang(engine, activeLang, voiceId);
    if (!voiceId) legacy.next('');
  }

  let sapiVoices: { id: string; name: string; language: string }[] = [];
  let sapiVoicesError = '';

  async function loadSapiVoices() {
    sapiVoicesError = '';
    if (!isTauri() || $ttsEngine$ !== 'sapi') {
      sapiVoices = [];
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      sapiVoices = await invoke<{ id: string; name: string; language: string }[]>(
        'sapi_list_voices'
      );
    } catch (err: any) {
      sapiVoicesError = err?.message ?? String(err);
      sapiVoices = [];
    }
  }

  $: if ($ttsEngine$ === 'sapi') loadSapiVoices();

  // Keep the saved Kokoro voice valid whenever the model switches. v1.0 and
  // v1.1-zh ship disjoint voice sets, so a v1.0 default (af_heart) would
  // trip a hard error inside kokoro.generate on v1.1-zh, and vice versa.
  $: kokoroModelId = $kokoroModel$ as KokoroModelId;
  $: kokoroVoiceGroups = getKokoroVoiceGroups(kokoroModelId);
  const edgeVoiceGroups = getEdgeVoiceGroups();
  $: if (kokoroModelId) {
    const allowed = getKokoroVoices(kokoroModelId).map((v) => v.id);
    if (!allowed.includes(kokoroVoice)) {
      pickVoiceFor('kokoro', kokoroVoiceId$, getDefaultKokoroVoice(kokoroModelId));
    }
  }

  // Web Speech voice list. Lived in the reader FAB's gear panel until
  // the panel was replaced by a bare −/+ rate pill; settings is the
  // only picker now. getVoices() can be empty until the engine warms
  // up, hence the voiceschanged re-read.
  let webVoices: SpeechSynthesisVoice[] = [];

  function loadWebVoices() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const all = window.speechSynthesis.getVoices();
    const zh = all.filter((v) => v.lang.startsWith('zh'));
    const ja = all.filter((v) => v.lang.startsWith('ja'));
    const rest = all.filter((v) => !v.lang.startsWith('zh') && !v.lang.startsWith('ja'));
    webVoices = [...zh, ...ja, ...rest];
    if (!all.length) {
      window.speechSynthesis.addEventListener('voiceschanged', loadWebVoices, { once: true });
    }
  }

  $: if ($ttsEngine$ === 'web') loadWebVoices();

  // A saved voice can outlive the voice itself — an uninstalled Windows voice
  // pack, settings carried to another machine, a retired Edge neural voice.
  // Report it instead of letting <select> render blank; see
  // voice-availability.ts for why the id is not cleared.
  $: webVoiceState = checkVoiceSelection(
    webVoice,
    webVoices.map((v) => v.voiceURI)
  );
  $: sapiVoiceState = checkVoiceSelection(
    sapiVoice,
    sapiVoices.map((v) => v.id)
  );
  $: edgeVoiceState = checkVoiceSelection(edgeVoice, getEdgeVoiceIds());


  /** Snapshot the live fields into the map under the given preset id. */
  function saveCurrentPreset(presetId: string) {
    const map = { ...$ttsCustomPresetStates$ };
    map[presetId] = {
      endpoint: $ttsCustomEndpoint$,
      method: $ttsCustomMethod$,
      headers: $ttsCustomHeaders$,
      body: $ttsCustomBody$,
      audioPath: $ttsCustomAudioPath$,
      proxyUrl: $ttsCustomProxyUrl$
    };
    ttsCustomPresetStates$.next(map);
  }

  function loadPresetIntoFields(presetId: string) {
    const saved = $ttsCustomPresetStates$[presetId];
    const fallback = CUSTOM_PRESETS[presetId] ?? CUSTOM_PRESETS.manual;
    const target = saved ?? fallback;
    ttsCustomMethod$.next(target.method);
    ttsCustomEndpoint$.next(target.endpoint);
    ttsCustomHeaders$.next(target.headers);
    ttsCustomBody$.next(target.body);
    ttsCustomAudioPath$.next(target.audioPath || '');
    ttsCustomProxyUrl$.next(target.proxyUrl || '');
  }

  /** Save current edits to the outgoing preset's slot, then switch. */
  function switchCustomPreset(newId: string) {
    const old = $ttsCustomActivePreset$;
    if (old === newId) return;
    saveCurrentPreset(old);
    ttsCustomActivePreset$.next(newId);
    loadPresetIntoFields(newId);
  }

  function resetActivePresetToDefaults() {
    const id = $ttsCustomActivePreset$;
    const def = CUSTOM_PRESETS[id];
    if (!def) return;
    ttsCustomMethod$.next(def.method);
    ttsCustomEndpoint$.next(def.endpoint);
    ttsCustomHeaders$.next(def.headers);
    ttsCustomBody$.next(def.body);
    ttsCustomAudioPath$.next(def.audioPath || '');
    ttsCustomProxyUrl$.next(def.proxyUrl || '');
  }

  function getBodyValue(body: string, path: string): unknown {
    try {
      const json = JSON.parse(body);
      return navigateJson(json, path);
    } catch {
      return undefined;
    }
  }

  function setBodyValue(body: string, path: string, value: unknown): string {
    try {
      const json = JSON.parse(body);
      const parts = path.split('.');
      let cur: any = json;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (part === '') continue;
        if (cur[part] === undefined || cur[part] === null) {
          cur[part] = {};
        }
        cur = cur[part];
      }
      const last = parts[parts.length - 1];
      if (last) cur[last] = value;
      return JSON.stringify(json, null, 2);
    } catch {
      return body;
    }
  }

  function setXmlVoice(body: string, voice: string): string {
    return body.replace(/name=['"][^'"]*['"]/, `name='${voice}'`);
  }

  function navigateJson(root: any, path: string): unknown {
    let cur = root;
    for (const part of path.split('.')) {
      if (part === '') continue;
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[part];
    }
    return cur;
  }

  /** Preset entries grouped by category, in the declared order — for the
   *  picker's `<optgroup>`s. Local presets come first (no signup), then free
   *  cloud, then paid, then manual. */
  const presetGroups: { category: PresetCategory; label: string; items: [string, CustomPreset][] }[] =
    PRESET_CATEGORY_ORDER.map((category) => ({
      category,
      label: PRESET_CATEGORY_LABEL[category],
      items: Object.entries(CUSTOM_PRESETS).filter(([, p]) => p.category === category)
    })).filter((g) => g.items.length > 0);

  $: activePresetDef = CUSTOM_PRESETS[$ttsCustomActivePreset$] ?? CUSTOM_PRESETS.manual;
  $: presetVoices = activePresetDef.voices ?? [];
  $: currentVoice = (() => {
    if (!activePresetDef.voices) return '';
    if (activePresetDef.voiceFormat === 'url') {
      if (!activePresetDef.voiceUrlPattern) return '';
      const regex = new RegExp(activePresetDef.voiceUrlPattern);
      const match = $ttsCustomEndpoint$.match(regex);
      return match?.[0] ?? '';
    }
    if (!activePresetDef.voicePath) return '';
    if (activePresetDef.voiceFormat === 'xml') {
      const match = $ttsCustomBody$.match(/name=['"]([^'"]*)['"]/);
      return match?.[1] ?? '';
    }
    return String(getBodyValue($ttsCustomBody$, activePresetDef.voicePath) ?? '');
  })();

  function onVoiceChange(voice: string) {
    if (activePresetDef.voiceFormat === 'url') {
      if (!activePresetDef.voiceUrlPattern) return;
      const regex = new RegExp(activePresetDef.voiceUrlPattern);
      ttsCustomEndpoint$.next($ttsCustomEndpoint$.replace(regex, voice));
      return;
    }
    if (!activePresetDef.voicePath) return;
    if (activePresetDef.voiceFormat === 'xml') {
      ttsCustomBody$.next(setXmlVoice($ttsCustomBody$, voice));
    } else {
      ttsCustomBody$.next(setBodyValue($ttsCustomBody$, activePresetDef.voicePath, voice));
    }
  }

  // Reading style — same swap-a-field-in-the-body trick as the voice picker,
  // for the presets whose model takes a natural-language tone prompt.
  $: currentStyle = activePresetDef.stylePath
    ? String(getBodyValue($ttsCustomBody$, activePresetDef.stylePath) ?? '')
    : '';
  $: styleIsCustom = !TTS_STYLE_PRESETS.some((s) => s.value === currentStyle);

  function onStyleChange(style: string) {
    if (!activePresetDef.stylePath || !style) return;
    ttsCustomBody$.next(setBodyValue($ttsCustomBody$, activePresetDef.stylePath, style));
  }

  // Seed the manual slot from legacy single-store values on first load — so
  // upgrading users don't lose what they typed in pre-1.3.1.
  if (browser && Object.keys($ttsCustomPresetStates$).length === 0) {
    if (
      $ttsCustomEndpoint$ ||
      $ttsCustomBody$ ||
      $ttsCustomAudioPath$ ||
      $ttsCustomHeaders$ !== CUSTOM_PRESETS.manual.headers
    ) {
      saveCurrentPreset('manual');
    }
  }

  // Auto-persist live edits back into the active preset's slot.
  let presetSaveDebounce: ReturnType<typeof setTimeout> | undefined;
  $: if (browser && $ttsCustomActivePreset$) {
    // touch all six so this $: reruns on any edit
    const _touch = [
      $ttsCustomEndpoint$,
      $ttsCustomMethod$,
      $ttsCustomHeaders$,
      $ttsCustomBody$,
      $ttsCustomAudioPath$,
      $ttsCustomProxyUrl$
    ];
    void _touch;
    if (presetSaveDebounce) clearTimeout(presetSaveDebounce);
    presetSaveDebounce = setTimeout(() => saveCurrentPreset($ttsCustomActivePreset$), 250);
  }

  function onPresetSelectChange(ev: Event) {
    const target = ev.currentTarget as HTMLSelectElement;
    switchCustomPreset(target.value);
  }

  /** Open a URL in the user's default browser (Tauri shell), or a new
   * tab in the web build. Used by the TTS preset "获取 API key" buttons. */
  async function openExternal(url: string) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
    } catch {
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
  }

  // --- TTS shortcut recorder ---
  let recordingShortcut = false;
  function startRecordShortcut() {
    recordingShortcut = true;
  }
  function onShortcutKeydown(ev: KeyboardEvent) {
    if (!recordingShortcut) return;
    ev.preventDefault();
    ev.stopPropagation();
    const key = ev.key;
    // Skip pure-modifier keypresses — wait for the actual key.
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return;
    const parts: string[] = [];
    if (ev.ctrlKey) parts.push('ctrl');
    if (ev.altKey) parts.push('alt');
    if (ev.shiftKey) parts.push('shift');
    if (ev.metaKey) parts.push('meta');
    const k = key === ' ' ? 'space' : key.length === 1 ? key.toLowerCase() : key.toLowerCase();
    parts.push(k);
    ttsShortcut$.next(parts.join('+'));
    recordingShortcut = false;
  }

  // --- Custom HTTP TTS visual masking ---
  let revealCustomSecrets = false;

  let previewState: 'idle' | 'loading' | 'playing' | 'error' = 'idle';
  let previewMessage = '';
  let previewAudio: HTMLAudioElement | undefined;
  $: previewText = $t('settings.tts.previewText');

  async function kokoroEnsureLoad() {
    try {
      const { ensureKokoroLoaded } = await import('$lib/components/book-reader/auto-reader-kokoro');
      await ensureKokoroLoaded();
    } catch {
      /* error already surfaced via kokoroLoadStatus$ */
    }
  }

  /** Retry after a stall. The stuck promise still sits in the module cache;
   *  drop it first so ensureKokoroLoaded actually restarts from_pretrained. */
  async function kokoroRetryLoad() {
    const { invalidateKokoroSessionCache } = await import(
      '$lib/components/book-reader/auto-reader-kokoro'
    );
    invalidateKokoroSessionCache($kokoroModel$);
    kokoroLoadStatus$.next({ phase: 'idle', message: '', loaded: 0, total: 0 });
    await kokoroEnsureLoad();
  }

  /** Delete the cached model shards from browser Cache Storage. Confirmed
   *  via dialog because a bad click here is a 320 MB re-download. */
  async function kokoroDeleteCache() {
    const modelId = $kokoroModel$;
    const ok = confirm(
      `确认删除本地缓存的 Kokoro ${modelId} 模型？（约 ${modelId === 'v1.1-zh' ? '320' : '80'} MB，之后需重新下载才能再用）`
    );
    if (!ok) return;
    const { deleteKokoroCache } = await import(
      '$lib/components/book-reader/auto-reader-kokoro'
    );
    await deleteKokoroCache(modelId);
    kokoroLoadStatus$.next({ phase: 'idle', message: '', loaded: 0, total: 0 });
    kokoroAccepted$.next(false);
  }

  // Auto-verify: when the user lands on kokoro engine and has previously
  // accepted the download, kick a load. If the shards are already in Cache
  // Storage this resolves fast and flips phase to 'ready' — closing the
  // "reopened app, is it still there?" question without user action.
  $: if (browser && $ttsEngine$ === 'kokoro' && $kokoroAccepted$ && $kokoroLoadStatus$.phase === 'idle') {
    kokoroEnsureLoad();
  }

  // Stall detector — fetch() hangs (network drop, proxy timeout) don't throw;
  // without this the UI sits at "68%" forever. Tick every 3s while loading so
  // the derived `kokoroStallSeconds` re-computes.
  let kokoroStallNowTick = Date.now();
  let kokoroStallTimer: ReturnType<typeof setInterval> | undefined;
  $: {
    if ($kokoroLoadStatus$.phase === 'loading' && !kokoroStallTimer) {
      kokoroStallTimer = setInterval(() => (kokoroStallNowTick = Date.now()), 3000);
    } else if ($kokoroLoadStatus$.phase !== 'loading' && kokoroStallTimer) {
      clearInterval(kokoroStallTimer);
      kokoroStallTimer = undefined;
    }
  }
  onDestroy(() => {
    if (kokoroStallTimer) clearInterval(kokoroStallTimer);
    // This panel now unmounts on every tab switch (it used to live inside
    // settings-content and stay alive for the whole page), so the 250ms
    // preset debounce and a running preview would otherwise be orphaned
    // mid-flight — flush one, stop the other.
    if (presetSaveDebounce) {
      clearTimeout(presetSaveDebounce);
      saveCurrentPreset($ttsCustomActivePreset$);
    }
    previewAudio?.pause();
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  });
  $: kokoroStallSeconds =
    $kokoroLoadStatus$.phase === 'loading' && $kokoroLoadStatus$.lastProgressAt
      ? Math.max(0, Math.floor((kokoroStallNowTick - $kokoroLoadStatus$.lastProgressAt) / 1000))
      : 0;
  $: kokoroIsStalled = kokoroStallSeconds >= 30;

  async function previewVoice() {
    previewMessage = '';
    if (previewAudio) {
      previewAudio.pause();
      previewAudio = undefined;
    }
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();

    if ($ttsEngine$ === 'web') {
      const utt = new SpeechSynthesisUtterance(previewText);
      utt.lang = 'zh-CN';
      utt.rate = 1;
      previewState = 'playing';
      utt.onend = () => (previewState = 'idle');
      utt.onerror = () => {
        previewState = 'error';
        previewMessage = tImmediate('settings.tts.webSpeechFailed');
      };
      window.speechSynthesis.speak(utt);
      return;
    }

    if ($ttsEngine$ === 'kokoro') {
      if (!$kokoroAccepted$) {
        previewState = 'error';
        previewMessage = tImmediate('settings.tts.kokoroDownloadFirst');
        return;
      }
      previewState = 'loading';
      try {
        const { ensureKokoroLoaded, loadKokoroTtsClass } = await import('$lib/components/book-reader/auto-reader-kokoro');
        await ensureKokoroLoaded();
        const KokoroTTS = await loadKokoroTtsClass();
        const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
          dtype: 'q8',
          device: 'wasm'
        });
        const audioOut = await tts.generate(previewText, { voice: kokoroVoice });
        const blob: Blob =
          typeof audioOut?.toBlob === 'function'
            ? audioOut.toBlob()
            : new Blob([audioOut?.audio?.buffer || audioOut], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        previewAudio = new Audio(url);
        previewAudio.onended = () => {
          previewState = 'idle';
          URL.revokeObjectURL(url);
        };
        previewAudio.onerror = () => {
          previewState = 'error';
          previewMessage = tImmediate('settings.tts.audioPlayFailed');
          URL.revokeObjectURL(url);
        };
        previewState = 'playing';
        await previewAudio.play();
      } catch (err: any) {
        previewState = 'error';
        previewMessage = `${tImmediate('settings.tts.kokoroSynthFailed')}: ${err?.message || err}`;
      }
      return;
    }

    if (!isTauri()) return;
    previewState = 'loading';
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      if ($ttsEngine$ === 'sapi') {
        const b64 = await invoke<string>('sapi_speak', {
          text: previewText,
          voiceId: sapiVoice || null,
          rate: 1
        });
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/wav' }));
        previewAudio = new Audio(url);
        previewAudio.onended = () => {
          previewState = 'idle';
          URL.revokeObjectURL(url);
        };
        previewAudio.onerror = () => {
          previewState = 'error';
          previewMessage = tImmediate('settings.tts.audioPlayFailed');
          URL.revokeObjectURL(url);
        };
        previewState = 'playing';
        await previewAudio.play();
      } else if ($ttsEngine$ === 'edge') {
        const b64 = await invoke<string>('edge_tts_synthesize', {
          text: previewText,
          voice: edgeVoice || null,
          rate: 1,
          proxyUrl: $ttsEdgeProxyUrl$ || null
        });
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/mpeg' }));
        previewAudio = new Audio(url);
        previewAudio.onended = () => {
          previewState = 'idle';
          URL.revokeObjectURL(url);
        };
        previewAudio.onerror = () => {
          previewState = 'error';
          previewMessage = tImmediate('settings.tts.audioPlayFailed');
          URL.revokeObjectURL(url);
        };
        previewState = 'playing';
        await previewAudio.play();
      } else if ($ttsEngine$ === 'custom') {
        let headersObj: Record<string, string> = {};
        try {
          const parsed = JSON.parse($ttsCustomHeaders$ || '{}');
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            headersObj = Object.fromEntries(
              Object.entries(parsed).map(([k, v]) => [k, String(v)])
            );
          }
        } catch (err: any) {
          previewState = 'error';
          previewMessage = `${tImmediate('settings.tts.headersInvalid')}: ${err.message}`;
          return;
        }
        const b64 = await invoke<string>('custom_tts_synthesize', {
          endpoint: $ttsCustomEndpoint$,
          method: $ttsCustomMethod$ || 'POST',
          headers: headersObj,
          bodyTemplate: $ttsCustomBody$ || '',
          audioPath: $ttsCustomAudioPath$ || null,
          proxyUrl: $ttsCustomProxyUrl$ || null,
          text: previewText
        });
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/mpeg' }));
        previewAudio = new Audio(url);
        previewAudio.onended = () => {
          previewState = 'idle';
          URL.revokeObjectURL(url);
        };
        previewAudio.onerror = () => {
          previewState = 'error';
          previewMessage = tImmediate('settings.tts.audioPlayFailed');
          URL.revokeObjectURL(url);
        };
        previewState = 'playing';
        await previewAudio.play();
      } else {
        // Unknown engine — bail so the UI doesn't stay in 'loading'.
        previewState = 'idle';
      }
    } catch (err: any) {
      previewState = 'error';
      previewMessage = err?.message ?? String(err);
    }
  }
</script>

{#if showSectionHeader}
  <SettingsSectionHeader title={$t('settings.section.tts')} hint={$t('settings.section.ttsHint')} />
{/if}
<SettingsItemGroup
  title={$t('settings.item.ttsEngine')}
  tooltip={$t('settings.tip.ttsEngine')}
>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2 flex-wrap">
      <select
        class="settings-input px-2 py-1 text-sm max-w-[14rem] truncate"
        bind:value={$ttsEngine$}
      >
        <option value="web">{$t('settings.value.ttsEngine.web')}</option>
        <option value="sapi">{$t('settings.value.ttsEngine.sapi')}</option>
        <option value="edge">{$t('settings.value.ttsEngine.edge')}</option>
        <option value="kokoro">{$t('settings.value.ttsEngine.kokoro')}</option>
        <option value="custom">{$t('settings.value.ttsEngine.custom')}</option>
      </select>
      <button
        class="settings-btn"
        disabled={previewState === 'loading' || previewState === 'playing'}
        on:click={previewVoice}
      >
        {previewState === 'loading'
          ? $t('settings.tts.loading')
          : previewState === 'playing'
            ? $t('settings.tts.playing')
            : $t('settings.tts.preview')}
        <Ripple />
      </button>
    </div>
    {#if previewState === 'error'}
      <p class="text-danger text-xs">{previewMessage}</p>
    {/if}
  </div>
</SettingsItemGroup>

{#if $ttsEngine$ !== 'custom'}
  <SettingsItemGroup
    title={$t('settings.item.voiceLang')}
    tooltip={$t('settings.tip.voiceLang')}
  >
    <ButtonToggleGroup options={voiceLangOptions} bind:selectedOptionId={activeLang} />
  </SettingsItemGroup>
{/if}

<SettingsItemGroup
  title={$t('settings.item.readingStart')}
  tooltip={$t('settings.tip.readingStart')}
>
  <select
    class="settings-input px-2 py-1 text-sm max-w-[12rem]"
    bind:value={$ttsStartStrategy$}
  >
    <option value="selection">{$t('settings.value.ttsStart.selection')}</option>
    <option value="resume">{$t('settings.value.ttsStart.resume')}</option>
    <option value="section-start">{$t('settings.value.ttsStart.sectionStart')}</option>
  </select>
</SettingsItemGroup>

<SettingsItemGroup
  title={$t('settings.item.autoContinue')}
  tooltip={$t('settings.tip.autoContinue')}
>
  <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$ttsAutoAdvanceSection$} />
</SettingsItemGroup>

<SettingsItemGroup
  title={$t('settings.item.ttsShortcut')}
  tooltip={$t('settings.tip.ttsShortcut')}
>
  <div class="flex items-center gap-2 flex-wrap">
    <button
      type="button"
      class="settings-btn min-w-[8rem] font-mono"
      class:border-danger={recordingShortcut}
      on:click={startRecordShortcut}
      on:keydown={onShortcutKeydown}
    >
      {recordingShortcut ? $t('settings.tts.pressKey') : $ttsShortcut$ || $t('settings.tts.disabledLabel')}
      <Ripple />
    </button>
    <button
      class="settings-btn"
      on:click={() => {
        recordingShortcut = false;
        ttsShortcut$.next('ctrl+alt+p');
      }}
    >{$t('common.reset')}<Ripple /></button>
    <button
      class="settings-btn"
      on:click={() => {
        recordingShortcut = false;
        ttsShortcut$.next('');
      }}
    >{$t('common.disable')}<Ripple /></button>
  </div>
</SettingsItemGroup>

{#if $ttsEngine$ === 'kokoro'}
  <div class="lg:col-span-3">
    <SettingsItemGroup
      title={$t('settings.tts.kokoro.title')}
      tooltip={$t('settings.tts.kokoro.tooltip')}
    >
      <div class="space-y-3 text-sm">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs opacity-70">模型</span>
          <select
            class="settings-input px-2 py-1 text-sm"
            bind:value={$kokoroModel$}
          >
            <option value="v1.1-zh">v1.1-zh · 中文首选 (40+ 中文音色，约 320 MB)</option>
            <option value="v1.0">v1.0 · 英语原版 (28 英语音色，约 80 MB)</option>
          </select>
        </div>

        {#if !$kokoroAccepted$}
          <div class="rounded-md border border-current/20 p-3 text-xs leading-relaxed">
            <p>{@html $t('settings.tts.kokoro.consent')}</p>
            <p class="mt-1 opacity-70">{@html $t('settings.tts.kokoro.privacy')}</p>
            <button
              class="settings-btn mt-2"
              on:click={() => {
                $kokoroAccepted$ = true;
                kokoroEnsureLoad();
              }}
            >{$t('settings.tts.kokoro.downloadEnable')}</button>
          </div>
        {:else if $kokoroLoadStatus$.phase === 'loading'}
          <div class="text-xs">
            {$kokoroLoadStatus$.message}
            {#if $kokoroLoadStatus$.total}
              · {Math.round(($kokoroLoadStatus$.loaded / $kokoroLoadStatus$.total) * 100)}%
              ({(($kokoroLoadStatus$.loaded || 0) / 1024 / 1024).toFixed(1)} /
              {(($kokoroLoadStatus$.total || 0) / 1024 / 1024).toFixed(1)} MB)
            {/if}
          </div>
          {#if kokoroIsStalled}
            <div class="text-xs mt-1" style="color:var(--danger-color)">
              ⚠ {$t('settings.tts.kokoro.stall', { seconds: kokoroStallSeconds })}
              <button class="settings-btn settings-btn-icon ml-2" on:click={kokoroRetryLoad}>{$t('common.retry')}</button>
            </div>
          {/if}
        {:else if $kokoroLoadStatus$.phase === 'errored'}
          <p class="text-danger text-xs">{$t('settings.tts.kokoro.downloadFailed')}：{$kokoroLoadStatus$.message}</p>
          <button class="settings-btn" on:click={kokoroRetryLoad}>{$t('common.retry')}</button>
        {:else if $kokoroLoadStatus$.phase === 'ready'}
          <div class="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs">
            <span style="color:rgb(34,197,94)">✓ {$t('settings.tts.kokoro.ready', { modelId: $kokoroLoadStatus$.modelId ?? $kokoroModel$ })}</span>
            <button class="settings-btn settings-btn-icon" on:click={kokoroDeleteCache}>{$t('settings.tts.kokoro.delete')}</button>
          </div>
        {/if}

        {#if $kokoroAccepted$}
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs opacity-70">{$t('settings.tts.voice')}</span>
            <select
              class="settings-input px-2 py-1 text-sm max-w-xs"
              value={kokoroVoice}
              on:change={(e) => pickVoiceFor('kokoro', kokoroVoiceId$, e.currentTarget.value)}
            >
              {#each kokoroVoiceGroups as g (g.group)}
                <optgroup label={g.group}>
                  {#each g.voices as v (v.id)}
                    <option value={v.id}>{v.label}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
          </div>
          <p class="text-xs opacity-60">
            中文听书优选 v1.1-zh；中文音色为编号命名（zf_/zm_），无描述性名称。
          </p>
          <p class="text-xs opacity-60">{$t('settings.tts.kokoro.cacheNote')}</p>
        {/if}
      </div>
    </SettingsItemGroup>
  </div>
{/if}

{#if $ttsEngine$ === 'edge'}
  <div class="lg:col-span-3">
    <SettingsItemGroup
      title="Edge TTS 语音（微软免费）"
      tooltip="走微软 Edge 浏览器内置「大声朗读」使用的免费 WSS 端点。中文晓晓/云扬质量对标 Azure Neural TTS，需能连 speech.platform.bing.com。"
    >
      <div class="space-y-2 text-sm">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs opacity-70">音色</span>
          <select
            class="settings-input px-2 py-1 text-sm max-w-xs"
            value={edgeVoice}
            on:change={(e) => pickVoiceFor('edge', ttsEdgeVoiceId$, e.currentTarget.value)}
          >
            {#if edgeVoiceState === 'missing'}
              <option value={edgeVoice}>
                {$t('settings.tts.voiceCustomOption', { id: edgeVoice })}
              </option>
            {/if}
            {#each edgeVoiceGroups as g (g.group)}
              <optgroup label={g.group}>
                {#each g.voices as v (v.id)}
                  <option value={v.id}>{v.label}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <!-- The catalog is a curated subset of 300+ voices and Microsoft
               retires entries, so there has to be a way to name one
               directly — without this, a voice outside the list is
               unreachable and an already-saved one renders as a blank
               select with no way back. -->
          <span class="text-xs opacity-70">{$t('settings.tts.edgeCustomVoice')}</span>
          <input
            type="text"
            class="settings-input px-2 py-1 text-sm w-72"
            placeholder="zh-CN-XiaoxiaoNeural"
            spellcheck="false"
            value={edgeVoice}
            on:input={(e) => pickVoiceFor('edge', ttsEdgeVoiceId$, e.currentTarget.value)}
          />
        </div>
        <p class="text-xs opacity-60">{$t('settings.tts.edgeCustomVoiceHint')}</p>
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs opacity-70">代理</span>
          <input
            type="text"
            class="settings-input px-2 py-1 text-sm w-72"
            placeholder="留空 = 跟随系统代理；direct = 强制直连"
            bind:value={$ttsEdgeProxyUrl$}
          />
        </div>
        <p class="text-xs opacity-60">
          国内需代理才能连 speech.platform.bing.com。留空会自动读取系统代理；报
          <code>tls handshake eof</code> 时在此手填，如 <code>http://127.0.0.1:7897</code>。
        </p>
        <p class="text-xs opacity-60">
          <strong>已配好代理仍失败</strong>，多半是代理软件内部把该域名判给了直连：主流 Clash 规则集会把
          <code>bing.com</code> 归到「Ⓜ️ Microsoft」分组，而该分组默认选中「全球直连」。
          把该分组改选为可用节点，或单独加一条
          <code>DOMAIN-SUFFIX,speech.platform.bing.com,&lt;你的节点分组&gt;</code>
          —— 后者只放行朗读，Windows Update / Office 仍走直连。
        </p>
      </div>
    </SettingsItemGroup>
  </div>
{/if}

{#if $ttsEngine$ === 'sapi'}
  <div class="lg:col-span-3">
    <SettingsItemGroup
      title={$t('settings.item.systemTtsVoice')}
      tooltip={$t('settings.tip.systemTtsVoice')}
    >
      {#if sapiVoicesError}
        <p class="text-danger text-sm">{sapiVoicesError}</p>
      {:else if !sapiVoices.length}
        <p class="text-sm opacity-60">{$t('settings.tts.noVoices')}</p>
      {:else}
        <select
          class="settings-input px-2 py-1 text-sm max-w-xs"
          value={sapiVoice}
          on:change={(e) => pickVoiceFor('sapi', ttsSapiVoiceId$, e.currentTarget.value)}
        >
          <option value="">{$t('settings.tts.sysDefault')}</option>
          {#if sapiVoiceState === 'missing'}
            <option value={sapiVoice}>
              {$t('settings.tts.voiceMissingOption', { id: sapiVoice })}
            </option>
          {/if}
          {#each sapiVoices as voice (voice.id)}
            <option value={voice.id}>{voice.name} ({voice.language})</option>
          {/each}
        </select>
        {#if sapiVoiceState === 'missing'}
          <p class="mt-1 text-xs" style="color:var(--danger-color);">
            {$t('settings.tts.voiceMissingHintSapi')}
          </p>
        {/if}
      {/if}
    </SettingsItemGroup>
  </div>
{/if}

{#if $ttsEngine$ === 'web'}
  <div class="lg:col-span-3">
    <SettingsItemGroup
      title={$t('settings.tts.webVoices.title')}
      tooltip={$t('settings.tts.webVoices.tooltip')}
    >
      {#if !webVoices.length}
        <p class="text-sm opacity-60">{$t('settings.tts.noVoices')}</p>
      {:else}
        <select
          class="settings-input px-2 py-1 text-sm max-w-xs"
          value={webVoice}
          on:change={(e) => pickVoiceFor('web', readerVoiceUri$, e.currentTarget.value)}
        >
          <option value="">{$t('settings.value.systemDefault')}</option>
          {#if webVoiceState === 'missing'}
            <!-- Keeps the select from rendering blank, and keeps the saved
                 id selectable so it survives a trip through this page. -->
            <option value={webVoice}>
              {$t('settings.tts.voiceMissingOption', { id: webVoice })}
            </option>
          {/if}
          {#each webVoices as voice (voice.voiceURI)}
            <option value={voice.voiceURI}>{voice.name} ({voice.lang})</option>
          {/each}
        </select>
        {#if webVoiceState === 'missing'}
          <p class="mt-1 text-xs" style="color:var(--danger-color);">
            {$t('settings.tts.voiceMissingHint')}
          </p>
        {/if}
      {/if}
    </SettingsItemGroup>
  </div>
{/if}

{#if $ttsEngine$ === 'custom'}
  <div class="lg:col-span-3">
    <SettingsItemGroup
      title={$t('settings.item.customHttpTts')}
      tooltip={$t('settings.tip.customHttpTtsFull')}
    >
      <p class="text-xs opacity-70 mb-2">
        {$t('settings.ttsCustom.hint')}
      </p>
      {@const activePreset = CUSTOM_PRESETS[$ttsCustomActivePreset$] ?? CUSTOM_PRESETS.manual}
      <div class="grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-x-3 gap-y-2 items-start">
        <span class="text-xs opacity-80 pt-2">{$t('settings.ttsCustom.preset')}</span>
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center gap-2 flex-wrap">
            <select
              class="settings-input px-2 py-1 text-sm"
              value={$ttsCustomActivePreset$}
              on:change={onPresetSelectChange}
            >
              {#each presetGroups as g (g.category)}
                <optgroup label={g.label}>
                  {#each g.items as [id, preset] (id)}
                    <option value={id}>{preset.label}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
            <button
              class="settings-btn"
              title={$t('settings.ttsCustom.restoreTemplateTip')}
              on:click={resetActivePresetToDefaults}
            >{$t('settings.ttsCustom.restoreTemplate')}<Ripple /></button>
            <button
              class="settings-btn"
              on:click={() => (revealCustomSecrets = !revealCustomSecrets)}
            >{revealCustomSecrets ? $t('settings.ttsCustom.hideContent') : $t('settings.ttsCustom.showContent')}<Ripple /></button>
            {#if activePreset.helpUrl}
              <button
                type="button"
                class="settings-btn"
                on:click={() => openExternal(activePreset.helpUrl || '')}
              >{$t('settings.ttsCustom.getApiKey')}</button>
            {/if}
          </div>
          {#if activePreset.helpHint}
            <p class="text-xs opacity-65 leading-snug">{activePreset.helpHint}</p>
          {/if}
        </div>

        {#if presetVoices.length}
          <span class="text-xs opacity-80 pt-2">{$t('settings.tts.voice')}</span>
          <select
            class="settings-input px-2 py-1 text-sm"
            value={currentVoice}
            on:change={(e) => onVoiceChange(e.currentTarget.value)}
          >
            <option value="">-- {$t('settings.ttsCustom.pickVoice')} --</option>
            {#each presetVoices as voice (voice.value)}
              <option value={voice.value}>{voice.label}</option>
            {/each}
          </select>
        {/if}

        {#if activePresetDef.stylePath}
          <span class="text-xs opacity-80 pt-2">{$t('settings.ttsCustom.style')}</span>
          <div class="flex flex-col gap-1">
            <select
              class="settings-input px-2 py-1 text-sm"
              value={styleIsCustom ? '' : currentStyle}
              on:change={(e) => onStyleChange(e.currentTarget.value)}
            >
              {#if styleIsCustom}
                <option value="">-- {$t('settings.ttsCustom.styleCustom')} --</option>
              {/if}
              {#each TTS_STYLE_PRESETS as style (style.value)}
                <option value={style.value}>{style.label}</option>
              {/each}
            </select>
            <p class="text-xs opacity-65 leading-snug">{$t('settings.ttsCustom.styleHint')}</p>
          </div>
        {/if}

        <span class="text-xs opacity-80 pt-2">{$t('settings.ttsCustom.method')}</span>
        <select class="settings-input px-2 py-1 text-sm w-24" bind:value={$ttsCustomMethod$}>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="GET">GET</option>
        </select>

        <span class="text-xs opacity-80 pt-2">{$t('settings.ttsCustom.endpoint')}</span>
        <input
          type="text"
          class="settings-input px-2 py-1 text-sm"
          class:secret-masked={!revealCustomSecrets}
          placeholder="https://api.openai.com/v1/audio/speech"
          bind:value={$ttsCustomEndpoint$}
        />

        <span class="text-xs opacity-80 pt-2">{$t('settings.ttsCustom.headers')}</span>
        <textarea
          class="settings-input px-2 py-1 text-xs font-mono"
          class:secret-masked={!revealCustomSecrets}
          rows="4"
          bind:value={$ttsCustomHeaders$}
        ></textarea>

        <span class="text-xs opacity-80 pt-2">{$t('settings.ttsCustom.body')}</span>
        <textarea
          class="settings-input px-2 py-1 text-xs font-mono"
          class:secret-masked={!revealCustomSecrets}
          rows="8"
          bind:value={$ttsCustomBody$}
        ></textarea>

        <span class="text-xs opacity-80 pt-2">{$t('settings.ttsCustom.audioPath')}</span>
        <input
          type="text"
          class="settings-input px-2 py-1 text-sm font-mono"
          placeholder={$t('settings.ttsCustom.audioPathPh')}
          bind:value={$ttsCustomAudioPath$}
        />

        <span class="text-xs opacity-80 pt-2">{$t('settings.ttsCustom.proxy')}</span>
        <input
          type="text"
          class="settings-input px-2 py-1 text-sm font-mono"
          class:secret-masked={!revealCustomSecrets}
          placeholder={$t('settings.ttsCustom.proxyPh')}
          bind:value={$ttsCustomProxyUrl$}
        />
      </div>
    </SettingsItemGroup>
  </div>
{/if}

<style>
  .secret-masked {
    -webkit-text-security: disc;
  }
</style>
