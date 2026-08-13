<script lang="ts">
  import { browser } from '$app/environment';
  import {
    faComputer,
    faFileArrowDown,
    faFileArrowUp,
    faPlus,
    faSpinner
  } from '@fortawesome/free-solid-svg-icons';
  import {
    TrackerAutoPause,
    TrackerSkipThresholdAction
  } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import {
    optionsForToggle,
    type ToggleOption
  } from '$lib/components/button-toggle-group/toggle-option';
  import LogReportDialog from '$lib/components/log-report-dialog.svelte';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import SettingsThemeEditor from '$lib/components/settings/settings-theme-editor.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import SettingsCustomTheme from '$lib/components/settings/settings-custom-theme.svelte';
  import SettingsDimensionPopover from '$lib/components/settings/settings-dimension-popover.svelte';
  import SettingsFontSelector from '$lib/components/settings/settings-font-selector.svelte';
  import SettingsReadingGoals from '$lib/components/settings/settings-reading-goals.svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSync from '$lib/components/settings/settings-sync.svelte';
  import SettingsAi from '$lib/components/settings/settings-ai.svelte';
  import SettingsOcr from '$lib/components/settings/settings-ocr.svelte';
  import SettingsModels from '$lib/components/settings/settings-models.svelte';
  import SettingsDataPaths from '$lib/components/settings/settings-data-paths.svelte';
  import SettingsSectionHeader from '$lib/components/settings/settings-section-header.svelte';
  import SettingsUserFontDialog from '$lib/components/settings/settings-user-font-dialog.svelte';
  import { inputClasses } from '$lib/css-classes';
  import { BlurMode } from '$lib/data/blur-mode';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { confirmResetUiSettings } from '$lib/functions/reset-ui-settings';
  import { LocalFont } from '$lib/data/fonts';
  import { FuriganaStyle } from '$lib/data/furigana-style';
  import { ImportHTMLFixMode } from '$lib/data/import-html-fix-mode';
  import { MergeMode } from '$lib/data/merge-mode';
  import {
    customThemes$,
    database,
    fontFamilyGroupOne$,
    fontFamilyGroupTwo$,
    lastBookHasImages$,
    horizontalCustomReadingPosition$,
    textMarginMode$,
    textMarginValue$,
    theme$,
    ttsCustomAudioPath$,
    ttsCustomBody$,
    ttsCustomEndpoint$,
    ttsCustomHeaders$,
    ttsCustomMethod$,
    ttsCustomProxyUrl$,
    ttsCustomActivePreset$,
    ttsCustomPresetStates$,
    ttsAutoAdvanceSection$,
    ttsEngine$,
    kokoroAccepted$,
    kokoroLoadStatus$,
    kokoroModel$,
    kokoroVoiceId$,
    ttsEdgeProxyUrl$,
    type KokoroModelId,
    readerVoiceUri$,
    ttsEdgeVoiceId$,
    ttsSapiVoiceId$,
    ttsShortcut$,
    ttsStartStrategy$,
    verticalCustomReadingPosition$
  } from '$lib/data/store';
  import { getEdgeVoiceGroups, getEdgeVoiceIds } from '$lib/data/edge-voices';
  import { checkVoiceSelection } from '$lib/data/tts/voice-availability';
  import {
    getDefaultKokoroVoice,
    getKokoroVoiceGroups,
    getKokoroVoices
  } from '$lib/data/kokoro-voices';
  import { isTauri } from '$lib/data/env';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import type { TextMarginMode } from '$lib/data/text-margin-mode';
  import {
    availableThemes as availableThemesMap,
    type ThemeOption
  } from '$lib/data/theme-option';
  import type { VerticalTextOrientation } from '$lib/data/vertical-text-orientation';
  import { ViewMode } from '$lib/data/view-mode';
  import { t, tImmediate, locale$, LOCALES } from '$lib/i18n';
  import type { WritingMode } from '$lib/data/writing-mode';
  import { secondsToMinutes } from '$lib/functions/statistic-util';
  import { activateOnKeyup } from '$lib/functions/utils';
  import {
    ReplicationSaveBehavior,
    AutoReplicationType
  } from '$lib/functions/replication/replication-options';
  import Fa from 'svelte-fa';
  import { onDestroy } from 'svelte';
  import {
    CUSTOM_PRESETS,
    PRESET_CATEGORY_LABEL,
    PRESET_CATEGORY_ORDER,
    type CustomPreset,
    type PresetCategory
  } from '$lib/data/tts-presets';

  export let selectedTheme: string;

  export let viewMode: ViewMode;

  export let fontFamilyGroupOne: string;

  export let fontFamilyGroupTwo: string;

  export let fontWeight: number | null;

  export let fontSize: number;

  export let lineHeight: number;

  export let textIndentation: number;

  export let textMarginValue: number;

  export let blurImage: boolean;

  export let blurImageMode: string;

  export let hideFurigana: boolean;

  export let furiganaStyle: FuriganaStyle;

  export let writingMode: WritingMode;

  export let enableFontKerning: boolean;

  export let enableFontVPAL: boolean;

  export let verticalTextOrientation: VerticalTextOrientation;

  export let prioritizeReaderStyles: boolean;

  export let enableTextJustification: boolean;

  export let enableTextWrapPretty: boolean;

  export let textMarginMode: TextMarginMode;

  export let enableReaderWakeLock: boolean;

  export let showCharacterCounter: boolean;

  export let showPercentage: boolean;

  export let showFooterChapterCharacterCounter: boolean;

  export let showFooterChapterPercentage: boolean;

  export let secondDimensionMaxValue: number;

  export let firstDimensionMargin: number;

  export let swipeThreshold: number;

  export let disableWheelNavigation: boolean;

  export let autoPositionOnResize: boolean;

  export let avoidPageBreak: boolean;

  export let pauseTrackerOnCustomPointChange: boolean;

  export let customReadingPointEnabled: boolean;

  export let selectionToBookmarkEnabled: boolean;

  export let enableTapEdgeToFlip: boolean;

  export let pageColumns: number;

  export let storageQuota: string;

  export let persistentStorage: boolean;

  export let hideExternalReadHint: boolean;

  export let confirmClose: boolean;

  export let manualBookmark: boolean;

  export let autoBookmark: boolean;

  export let autoBookmarkTime: number;

  export let activeSettings: string;

  export let importHTMLFixMode: string;

  export let restrictImportFixToAnchor: boolean;

  export let cacheStorageData: boolean;

  export let autoReplication: string;

  export let replicationSaveBehavior: string;

  export let showExternalPlaceholder: boolean;

  export let keepLocalStatisticsOnDeletion: boolean;

  export let overwriteBookCompletion: boolean;

  export let startDayHoursForTracker: number;

  export let statisticsMergeMode: string;

  export let readingGoalsMergeMode: string;

  export let statisticsEnabled: boolean;

  export let trackerAutoPause: string;

  export let openTrackerOnCompletion: boolean;

  export let addCharactersOnCompletion: boolean;

  export let trackerAutoStartTime: number;

  export let trackerIdleTime: number;

  export let trackerForwardSkipThreshold: number;

  export let trackerBackwardSkipThreshold: number;

  export let trackerSkipThresholdAction: string;

  export let trackerPopupDetection: boolean;

  export let adjustStatisticsAfterIdleTime: boolean;

  $: availableThemes = (() => {
    // Custom themes shadow built-ins of the same id.
    const map = new Map(availableThemesMap);
    if (browser) {
      for (const [name, theme] of Object.entries($customThemes$)) {
        map.set(name, theme);
      }
    }
    return Array.from(map.entries()).map(([theme, option]) => ({ theme, option }));
  })();

  $: optionsForTheme = availableThemes.map(({ theme, option }) => ({
    id: theme,
    text: '中字',
    style: {
      color: option.fontColor,
      'background-color': option.backgroundColor
    },
    thickBorders: true,
    showIcons: true
  }));

  // Each language is labelled in its own script (中文 / English / 日本語) so it
  // stays findable when the UI is currently in a language you can't read —
  // which is exactly the state someone opening this setting is trying to fix.
  $: optionsForLocale = LOCALES.map((loc) => ({ id: loc, text: tImmediate('locale.' + loc) }));

  onDestroy(() => dialogManager.dialogs$.next([]));

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
    if (!allowed.includes($kokoroVoiceId$)) {
      $kokoroVoiceId$ = getDefaultKokoroVoice(kokoroModelId);
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
    $readerVoiceUri$,
    webVoices.map((v) => v.voiceURI)
  );
  $: sapiVoiceState = checkVoiceSelection(
    $ttsSapiVoiceId$,
    sapiVoices.map((v) => v.id)
  );
  $: edgeVoiceState = checkVoiceSelection($ttsEdgeVoiceId$, getEdgeVoiceIds());


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
        const audioOut = await tts.generate(previewText, { voice: $kokoroVoiceId$ });
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
          voiceId: $ttsSapiVoiceId$ || null,
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
          voice: $ttsEdgeVoiceId$ || null,
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

  function resetUiSettings() {
    confirmResetUiSettings();
  }

  let themeImportInput: HTMLInputElement | undefined;
  let inlineEditTheme: string | null = null;

  function handleNewTheme() {
    dialogManager.dialogs$.next([
      {
        component: SettingsCustomTheme,
        props: { existingThemes: optionsForTheme, selectedTheme: selectedTheme }
      }
    ]);
  }

  function exportCustomThemes() {
    const json = JSON.stringify($customThemes$, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'autobook-themes.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importCustomThemes(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('不是有效的主题文件');
      }

      const entries = Object.entries(parsed).filter(
        ([, value]) => value && typeof value === 'object' && !Array.isArray(value)
      );

      if (!entries.length) {
        throw new Error('文件中没有可导入的主题');
      }

      $customThemes$ = {
        ...$customThemes$,
        ...(Object.fromEntries(entries) as Record<string, ThemeOption>)
      };
    } catch (error: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: { title: '导入主题失败', message: error.message }
        }
      ]);
    }
  }

  $: optionsForFuriganaStyle = [
    { id: FuriganaStyle.Hide, text: $t('settings.value.furigana.hide') },
    { id: FuriganaStyle.Partial, text: $t('settings.value.furigana.partial') },
    { id: FuriganaStyle.Toggle, text: $t('settings.value.furigana.toggle') },
    { id: FuriganaStyle.Full, text: $t('settings.value.furigana.full') }
  ] as ToggleOption<FuriganaStyle>[];

  $: optionsForWritingMode = [
    { id: 'horizontal-tb', text: $t('settings.value.wm.horizontal') },
    { id: 'vertical-rl', text: $t('settings.value.wm.vertical') }
  ] as ToggleOption<WritingMode>[];

  $: optionsForVerticalTextOrientation = [
    { id: 'mixed', text: $t('settings.value.vto.mixed') },
    { id: 'upright', text: $t('settings.value.vto.upright') }
  ] as ToggleOption<VerticalTextOrientation>[];

  $: optionsForTextMarginMode = [
    { id: 'auto', text: $t('settings.value.textMargin.auto') },
    { id: 'manual', text: $t('settings.value.textMargin.manual') }
  ] as ToggleOption<TextMarginMode>[];

  $: optionsForViewMode = [
    { id: ViewMode.Continuous, text: $t('settings.value.viewMode.continuous') },
    { id: ViewMode.Paginated, text: $t('settings.value.viewMode.paginated') }
  ] as ToggleOption<ViewMode>[];

  $: optionsForBlurMode = [
    { id: BlurMode.ALL, text: $t('settings.value.blur.all') },
    { id: BlurMode.AFTER_TOC, text: $t('settings.value.blur.cover') },
    { id: BlurMode.NONE, text: $t('settings.value.blur.none') }
  ] as ToggleOption<BlurMode>[];

  // 书库存储源 toggle。Tauri 桌面上才显示：TAURI_FS 是默认真书库，
  // BROWSER 只留给从更早浏览器 IDB 升级过来的用户翻旧数据。
  $: storageSourceOptions = [
    { id: StorageKey.TAURI_FS, text: $t('settings.value.storageSource.fs') },
    { id: StorageKey.BROWSER, text: $t('settings.value.storageSource.browser') }
  ] as ToggleOption<StorageKey>[];
  let selectedStorageSource: StorageKey = $storageSource$;
  $: if (selectedStorageSource !== $storageSource$) {
    storageSource$.next(selectedStorageSource);
  }

  $: optionsForImportHTMLFixes = [
    { id: ImportHTMLFixMode.OFF, text: $t('settings.value.epubFix.off') },
    { id: ImportHTMLFixMode.STANDARD, text: $t('settings.value.epubFix.standard') },
    { id: ImportHTMLFixMode.EXTENDED, text: $t('settings.value.epubFix.extended') }
  ] as ToggleOption<ImportHTMLFixMode>[];

  $: optionsForAutoReplicationType = [
    { id: AutoReplicationType.Off, text: 'Off' },
    { id: AutoReplicationType.Up, text: $t('settings.value.autoRepl.up') },
    { id: AutoReplicationType.Down, text: $t('settings.value.autoRepl.down') },
    { id: AutoReplicationType.All, text: $t('settings.value.autoRepl.all') }
  ] as ToggleOption<AutoReplicationType>[];

  $: optionsForReplicationSaveBehavior = [
    { id: ReplicationSaveBehavior.NewOnly, text: $t('settings.value.mergeOnly') },
    { id: ReplicationSaveBehavior.Overwrite, text: $t('settings.value.overwrite') }
  ] as ToggleOption<ReplicationSaveBehavior>[];

  $: optionsForTrackerAutoPause = [
    { id: TrackerAutoPause.OFF, text: 'Off' },
    { id: TrackerAutoPause.MODERATE, text: $t('settings.value.autoPause.moderate') },
    { id: TrackerAutoPause.STRICT, text: $t('settings.value.autoPause.strict') }
  ] as ToggleOption<TrackerAutoPause>[];

  $: optionsForTrackerSkipThresholdAction = [
    { id: TrackerSkipThresholdAction.IGNORE, text: $t('settings.value.skipAction.ignore') },
    { id: TrackerSkipThresholdAction.PAUSE, text: $t('settings.value.skipAction.pause') }
  ] as ToggleOption<TrackerSkipThresholdAction>[];

  $: optionsForMergeMode = [
    { id: MergeMode.MERGE, text: $t('settings.value.merge') },
    { id: MergeMode.REPLACE, text: $t('settings.value.overwrite') }
  ] as ToggleOption<MergeMode>[];

  let showSpinner = false;
  let furiganaStyleTooltip = '';
  let importHTMLFixModeTooltip = '';
  let autoReplicationTypeTooltip = '';
  let trackerAutoPauseTooltip = '';

  $: if ($textMarginMode$ === 'auto') {
    $textMarginValue$ = 0;
  }

  $: verticalTextOrientationTooltip =
    verticalTextOrientation === 'mixed'
      ? $t('settings.tip.vto.mixed')
      : $t('settings.tip.vto.upright');
  $: autoBookmarkTooltip = $t('settings.tip.autoBookmark', { n: autoBookmarkTime });
  $: wakeLockSupported = browser && 'wakeLock' in navigator;
  $: verticalMode = writingMode === 'vertical-rl';
  $: fontCacheSupported = browser && 'caches' in window;
  $: switch (furiganaStyle) {
    case FuriganaStyle.Hide:
      furiganaStyleTooltip = $t('settings.tip.furigana.hide');
      break;
    case FuriganaStyle.Toggle:
      furiganaStyleTooltip = $t('settings.tip.furigana.toggle');
      break;
    case FuriganaStyle.Full:
      furiganaStyleTooltip = $t('settings.tip.furigana.full');
      break;
    default:
      furiganaStyleTooltip = $t('settings.tip.furigana.partial');
      break;
  }
  $: avoidPageBreakTooltip = avoidPageBreak
    ? $t('settings.tip.avoidBreak.on')
    : $t('settings.tip.avoidBreak.off');
  $: persistentStorageTooltip = persistentStorage
    ? $t('settings.tip.persistent.on')
    : $t('settings.tip.persistent.off');
  $: switch (importHTMLFixMode) {
    case ImportHTMLFixMode.OFF:
      importHTMLFixModeTooltip = $t('settings.tip.epubFix.off');
      break;
    case ImportHTMLFixMode.EXTENDED:
      importHTMLFixModeTooltip = $t('settings.tip.epubFix.extended');
      break;
    default:
      importHTMLFixModeTooltip = $t('settings.tip.epubFix.standard');
      break;
  }
  $: cacheStorageDataTooltip = cacheStorageData
    ? $t('settings.tip.cacheData.on')
    : $t('settings.tip.cacheData.off');
  $: replicationSaveBehaviorTooltip =
    replicationSaveBehavior === ReplicationSaveBehavior.Overwrite
      ? $t('settings.tip.replBehavior.overwrite')
      : $t('settings.tip.replBehavior.newOnly');
  $: switch (autoReplication) {
    case AutoReplicationType.Up:
      autoReplicationTypeTooltip = $t('settings.tip.autoRepl.up');
      break;
    case AutoReplicationType.Down:
      autoReplicationTypeTooltip = $t('settings.tip.autoRepl.down');
      break;
    case AutoReplicationType.All:
      autoReplicationTypeTooltip = $t('settings.tip.autoRepl.all');
      break;
    default:
      autoReplicationTypeTooltip = $t('settings.tip.autoRepl.off');
      break;
  }
  $: showExternalPlaceholderToolTip = showExternalPlaceholder
    ? $t('settings.tip.showPlaceholder.on')
    : $t('settings.tip.showPlaceholder.off');

  $: startOfDayHours = `${`${startDayHoursForTracker}`.padStart(2, '0')}:00`;

  $: trackerIdleTimeInMin = secondsToMinutes(trackerIdleTime);

  $: switch (trackerAutoPause) {
    case TrackerAutoPause.OFF:
      trackerAutoPauseTooltip = $t('settings.tip.autoPause.off');
      break;
    case TrackerAutoPause.STRICT:
      trackerAutoPauseTooltip = $t('settings.tip.autoPause.strict');
      break;
    default:
      trackerAutoPauseTooltip = $t('settings.tip.autoPause.moderate');
      break;
  }

</script>

<div class="grid grid-cols-1 items-center sm:grid-cols-2 sm:gap-6 lg:md:gap-8 lg:grid-cols-3">
  {#if activeSettings === 'Appearance'}
    <div class="lg:col-span-3">
      <SettingsItemGroup title={$t('locale.label')}>
        <ButtonToggleGroup options={optionsForLocale} bind:selectedOptionId={$locale$} />
      </SettingsItemGroup>
    </div>
    <div class="lg:col-span-3">
      <SettingsItemGroup title={$t('settings.section.theme')}>
        <ButtonToggleGroup
          options={optionsForTheme}
          bind:selectedOptionId={selectedTheme}
          on:edit={({ detail }) => (inlineEditTheme = detail)}
          on:delete={({ detail }) => {
            $theme$ = optionsForTheme[optionsForTheme.length - 2]?.id || 'light-theme';
            delete $customThemes$[detail];
            $customThemes$ = { ...$customThemes$ };
            if (inlineEditTheme === detail) inlineEditTheme = null;
          }}
        >
          {#if browser}
            <div class="flex">
              <button
                title="新建主题"
                class="m-1 rounded-md border-2 border-gray-400 p-2 text-lg"
                on:click={handleNewTheme}
              >
                <Fa icon={faPlus} class="mx-2" />
                <Ripple />
              </button>
              <button
                title="导出自定义主题"
                class="m-1 rounded-md border-2 border-gray-400 p-2 text-lg"
                disabled={!Object.keys($customThemes$).length}
                class:opacity-40={!Object.keys($customThemes$).length}
                on:click={exportCustomThemes}
              >
                <Fa icon={faFileArrowUp} class="mx-2" />
                <Ripple />
              </button>
              <button
                title="导入自定义主题"
                class="m-1 rounded-md border-2 border-gray-400 p-2 text-lg"
                on:click={() => themeImportInput?.click()}
              >
                <Fa icon={faFileArrowDown} class="mx-2" />
                <Ripple />
              </button>
              <input
                type="file"
                accept="application/json,.json"
                class="hidden"
                bind:this={themeImportInput}
                on:change={importCustomThemes}
              />
            </div>
          {/if}
        </ButtonToggleGroup>
        {#if inlineEditTheme}
          {#key inlineEditTheme}
            <SettingsThemeEditor
              themeId={inlineEditTheme}
              on:close={() => (inlineEditTheme = null)}
              on:saved={() => (inlineEditTheme = null)}
              on:deleted={() => (inlineEditTheme = null)}
            />
          {/key}
        {:else}
          <p class="mt-2 text-xs opacity-60">点击主题按钮旁的笔形图标可直接在下方编辑配色，无需弹窗。</p>
        {/if}
      </SettingsItemGroup>
    </div>

    <SettingsSectionHeader title={$t('settings.section.fontsTypography')} />
    <SettingsItemGroup title={$t('settings.item.fontGroup1')}>
      <div slot="header" class="flex items-center">
        <SettingsFontSelector
          availableFonts={[
            LocalFont.NOTOSANSSC,
            LocalFont.NOTOSERIFJP,
            LocalFont.KZUDMINCHO,
            LocalFont.SERIF
          ]}
          bind:fontValue={fontFamilyGroupOne}
        />
        {#if fontCacheSupported}
          <div
            tabindex="0"
            role="button"
            title="打开自定义字体对话框"
            on:click={() =>
              dialogManager.dialogs$.next([
                {
                  component: SettingsUserFontDialog,
                  props: { fontFamily: fontFamilyGroupOne$ }
                }
              ])}
            on:keyup={activateOnKeyup}
          >
            <Fa icon={faComputer} />
          </div>
        {/if}
      </div>
      <input
        type="text"
        class={inputClasses}
        placeholder="Noto Sans SC"
        bind:value={fontFamilyGroupOne}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.fontGroup2')}>
      <div slot="header" class="flex items-center">
        <SettingsFontSelector
          availableFonts={[LocalFont.NOTOSANSSC, LocalFont.NOTOSANSJP, LocalFont.KZUDGOTHIC, LocalFont.SANSSERIF]}
          bind:fontValue={fontFamilyGroupTwo}
        />
        {#if fontCacheSupported}
          <div
            tabindex="0"
            role="button"
            on:click={() =>
              dialogManager.dialogs$.next([
                {
                  component: SettingsUserFontDialog,
                  props: { fontFamily: fontFamilyGroupTwo$ }
                }
              ])}
            on:keyup={activateOnKeyup}
          >
            <Fa icon={faComputer} />
          </div>
        {/if}
      </div>
      <input
        type="text"
        class={inputClasses}
        placeholder="Noto Sans SC"
        bind:value={fontFamilyGroupTwo}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.fontSize')}>
      <input type="number" class={inputClasses} step="1" min="1" bind:value={fontSize} />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.lineHeight')}>
      <input
        type="number"
        class={inputClasses}
        step="0.05"
        min="1"
        bind:value={lineHeight}
        on:change={() => {
          if (!lineHeight || lineHeight < 1) {
            lineHeight = 1.65;
          }
        }}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.fontWeight')} tooltip={$t('settings.tip.fontWeight')}>
      <input
        type="number"
        placeholder="默认"
        class={inputClasses}
        step="100"
        min="100"
        max="1000"
        bind:value={fontWeight}
        on:change={() => {
          if (fontWeight === null) return;
          if (fontWeight < 100) fontWeight = 100;
          else if (fontWeight > 1000) fontWeight = 1000;
        }}
      />
    </SettingsItemGroup>
    <SettingsSectionHeader title={$t('settings.section.paragraphs')} />
    <SettingsItemGroup title={$t('settings.item.paraIndent')} tooltip={$t('settings.tip.paraIndent')}>
      <input
        type="number"
        class={inputClasses}
        step=".5"
        min="0"
        bind:value={textIndentation}
        on:blur={() => {
          const newValue = Number.parseFloat(`${textIndentation ?? 0}`);
          if (isNaN(newValue) || newValue < 1) textIndentation = 0;
        }}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.paraSpacingMode')} tooltip={$t('settings.tip.paraSpacingMode')}>
      <ButtonToggleGroup
        options={optionsForTextMarginMode}
        bind:selectedOptionId={textMarginMode}
      />
    </SettingsItemGroup>
    {#if textMarginMode === 'manual'}
      <SettingsItemGroup title={$t('settings.item.paraSpacing')} tooltip={$t('settings.tip.paraSpacing')}>
        <input
          type="number"
          class={inputClasses}
          step=".5"
          min="0"
          bind:value={textMarginValue}
          on:blur={() => {
            const newValue = Number.parseFloat(`${textMarginValue ?? 0}`);
            if (isNaN(newValue) || newValue < 1) textMarginValue = 0;
          }}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup title={$t('settings.item.justify')} tooltip={$t('settings.tip.justify')}>
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={enableTextJustification}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.prettyWrap')} tooltip={$t('settings.tip.prettyWrap')}>
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableTextWrapPretty} />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.writingDirection')}>
      <ButtonToggleGroup options={optionsForWritingMode} bind:selectedOptionId={writingMode} />
    </SettingsItemGroup>
    {#if verticalMode}
      <SettingsItemGroup title={$t('settings.item.enableKerning')} tooltip={$t('settings.tip.enableKerning')}>
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableFontKerning} />
      </SettingsItemGroup>
      <SettingsItemGroup title={$t('settings.item.enableVpal')} tooltip={$t('settings.tip.enableVpal')}>
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableFontVPAL} />
      </SettingsItemGroup>
      <SettingsItemGroup title={$t('settings.item.textOrientation')} tooltip={verticalTextOrientationTooltip}>
        <ButtonToggleGroup
          options={optionsForVerticalTextOrientation}
          bind:selectedOptionId={verticalTextOrientation}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsSectionHeader title={$t('settings.section.furigana')} />
    <SettingsItemGroup title={$t('settings.item.hideFurigana')}>
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={hideFurigana} />
    </SettingsItemGroup>
    {#if hideFurigana}
      <SettingsItemGroup title={$t('settings.item.furiganaStyle')} tooltip={furiganaStyleTooltip}>
        <ButtonToggleGroup
          options={optionsForFuriganaStyle}
          bind:selectedOptionId={furiganaStyle}
        />
      </SettingsItemGroup>
    {/if}
  {:else if activeSettings === 'Reader'}
    <SettingsSectionHeader title={$t('settings.section.viewMode')} hint={$t('settings.section.viewModeHint')} />
    <div class="h-full">
      <SettingsItemGroup title={$t('settings.item.readerView')}>
        <ButtonToggleGroup options={optionsForViewMode} bind:selectedOptionId={viewMode} />
      </SettingsItemGroup>
    </div>


    <!-- 视图模式专属 -->
    <SettingsSectionHeader title={$t(viewMode === ViewMode.Continuous ? 'settings.section.readerBehavior.continuous' : 'settings.section.readerBehavior.paginated')} hint={$t(viewMode === ViewMode.Continuous ? 'settings.section.readerBehavior.continuousHint' : 'settings.section.readerBehavior.paginatedHint')} />
    {#if viewMode === ViewMode.Continuous}
      <SettingsItemGroup
        title="自定义阅读点"
        tooltip={'开启后可在阅读器中设置固定起算点，进度和书签从该点开始计算'}
      >
        <div class="flex items-center">
          <ButtonToggleGroup
            options={optionsForToggle}
            bind:selectedOptionId={customReadingPointEnabled}
          />
          {#if customReadingPointEnabled}
            <div
              tabindex="0"
              role="button"
              class="ml-4 hover:underline"
              on:click={() => {
                verticalCustomReadingPosition$.next(100);
                horizontalCustomReadingPosition$.next(0);
              }}
              on:keyup={activateOnKeyup}
            >
              重置阅读点
            </div>
          {/if}
        </div>
      </SettingsItemGroup>
      <SettingsItemGroup title={$t('settings.item.autoRepositionOnResize')}>
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={autoPositionOnResize}
        />
      </SettingsItemGroup>
    {:else}
      <SettingsItemGroup title={$t('settings.item.avoidPaginationBreak')} tooltip={avoidPageBreakTooltip}>
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={avoidPageBreak} />
      </SettingsItemGroup>
      <SettingsItemGroup
        title="选中即书签"
        tooltip={'开启后，书签会落在当前/上次选中文本附近段落，而不是页首'}
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={selectionToBookmarkEnabled}
        />
      </SettingsItemGroup>
      <SettingsItemGroup title={$t('settings.item.tapToTurnPage')} tooltip={$t('settings.tip.tapToTurnPage')}>
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableTapEdgeToFlip} />
      </SettingsItemGroup>
      {#if !verticalMode}
        <SettingsItemGroup title={$t('settings.item.columnCount')} tooltip={$t('settings.tip.columnCount')}>
          <input type="number" class={inputClasses} step="1" min="0" bind:value={pageColumns} />
        </SettingsItemGroup>
      {/if}
      <SettingsItemGroup title={$t('settings.item.swipeThreshold')} tooltip={$t('settings.tip.swipeThreshold')}>
        <input
          type="number"
          step="1"
          min="10"
          class={inputClasses}
          bind:value={swipeThreshold}
          on:blur={() => {
            if (swipeThreshold < 10 || typeof swipeThreshold !== 'number') swipeThreshold = 10;
          }}
        />
      </SettingsItemGroup>
      <SettingsItemGroup title={$t('settings.item.disableWheelPageTurn')}>
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={disableWheelNavigation}
        />
      </SettingsItemGroup>
    {/if}

    <SettingsSectionHeader title={$t('settings.section.readerArea')} hint={$t('settings.section.readerAreaHint')} />
    <SettingsItemGroup title={verticalMode ? $t('settings.item.readerPaddingH') : $t('settings.item.readerPaddingV')}>
      <SettingsDimensionPopover
        slot="header"
        isFirstDimension
        isVertical={verticalMode}
        bind:dimensionValue={firstDimensionMargin}
      />
      <input
        type="number"
        class={inputClasses}
        step="1"
        min="0"
        bind:value={firstDimensionMargin}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={verticalMode ? $t('settings.item.readerMaxHeight') : $t('settings.item.readerMaxWidth')}>
      <SettingsDimensionPopover
        slot="header"
        isVertical={verticalMode}
        bind:dimensionValue={secondDimensionMaxValue}
      />
      <input
        type="number"
        class={inputClasses}
        step="1"
        min="0"
        bind:value={secondDimensionMaxValue}
      />
    </SettingsItemGroup>

    <SettingsSectionHeader title={$t('settings.section.bookmarks')} hint={$t('settings.section.bookmarksHint')} />
    <SettingsItemGroup title={$t('settings.item.autoBookmark')} tooltip={autoBookmarkTooltip}>
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={autoBookmark} />
    </SettingsItemGroup>
    {#if autoBookmark}
      <SettingsItemGroup title={$t('settings.item.autoBookmarkDelay')} tooltip={$t('settings.tip.autoBookmarkDelay')}>
        <input
          type="number"
          step="1"
          min="1"
          class={inputClasses}
          bind:value={autoBookmarkTime}
          on:blur={() => {
            if (autoBookmarkTime < 1 || typeof autoBookmarkTime !== 'number') autoBookmarkTime = 3;
          }}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup
      title={$t('settings.item.manualOnlyBookmark')}
      tooltip={$t('settings.tip.manualOnlyBookmark')}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={manualBookmark} />
    </SettingsItemGroup>

    <SettingsSectionHeader title={$t('settings.section.footerDisplay')} hint={$t('settings.section.footerDisplayHint')} />
    <SettingsItemGroup title={$t('settings.item.showCharacters')}>
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={showCharacterCounter} />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.showPercent')}>
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={showPercentage} />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.footerChapterChars')}>
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={showFooterChapterCharacterCounter}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.footerChapterPercent')}>
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={showFooterChapterPercentage}
      />
    </SettingsItemGroup>

    <SettingsSectionHeader title={$t('settings.section.imagesReadingPoint')} hint={$t('settings.section.imagesReadingPointHint')} />
    {#if $lastBookHasImages$}
      <SettingsItemGroup
        title={$t('settings.item.blurImages')}
        tooltip={$t('settings.tip.blurImages')}
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={blurImage} />
      </SettingsItemGroup>
      {#if blurImage}
        <SettingsItemGroup title={$t('settings.item.blurScope')} tooltip={$t('settings.tip.blurScope')}>
          <ButtonToggleGroup options={optionsForBlurMode} bind:selectedOptionId={blurImageMode} />
        </SettingsItemGroup>
      {/if}
    {/if}
    {#if statisticsEnabled}
      <SettingsItemGroup
        title={$t('settings.item.customReadingPointPause')}
        tooltip={$t('settings.tip.customReadingPointPause')}
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={pauseTrackerOnCustomPointChange}
        />
      </SettingsItemGroup>
    {/if}

    <SettingsSectionHeader title={$t('settings.section.miscReader')} hint={$t('settings.section.miscReaderHint')} />
    {#if wakeLockSupported}
      <SettingsItemGroup
        title={$t('settings.item.keepAwake')}
        tooltip={$t('settings.tip.keepAwake')}
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableReaderWakeLock} />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup
      title={$t('settings.item.confirmClose')}
      tooltip={$t('settings.tip.confirmClose')}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={confirmClose} />
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t('settings.item.preferReaderStyle')}
      tooltip={$t('settings.tip.preferReaderStyle')}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={prioritizeReaderStyles} />
    </SettingsItemGroup>

    <!-- end legacy hidden block -->
  {:else if activeSettings === 'TTS'}
    <SettingsSectionHeader title={$t('settings.section.tts')} hint={$t('settings.section.ttsHint')} />
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
            class="settings-input px-3 py-1 text-sm disabled:opacity-40"
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
          <p class="text-red-500 text-xs">{previewMessage}</p>
        {/if}
      </div>
    </SettingsItemGroup>

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
          class="rounded border-2 px-3 py-1 text-sm min-w-[8rem] text-center font-mono"
          class:border-red-500={recordingShortcut}
          class:border-gray-400={!recordingShortcut}
          on:click={startRecordShortcut}
          on:keydown={onShortcutKeydown}
        >
          {recordingShortcut ? $t('settings.tts.pressKey') : $ttsShortcut$ || $t('settings.tts.disabledLabel')}
          <Ripple />
        </button>
        <button
          class="settings-input px-3 py-1 text-sm"
          on:click={() => {
            recordingShortcut = false;
            ttsShortcut$.next('ctrl+alt+p');
          }}
        >{$t('common.reset')}<Ripple /></button>
        <button
          class="settings-input px-3 py-1 text-sm"
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
                  class="settings-input mt-2 inline-flex items-center gap-1 px-3 py-1 text-sm"
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
                  <button class="settings-input ml-2 px-2 py-0.5 text-xs" on:click={kokoroRetryLoad}>{$t('common.retry')}</button>
                </div>
              {/if}
            {:else if $kokoroLoadStatus$.phase === 'errored'}
              <p class="text-red-500 text-xs">{$t('settings.tts.kokoro.downloadFailed')}：{$kokoroLoadStatus$.message}</p>
              <button class="settings-input px-3 py-1 text-sm" on:click={kokoroRetryLoad}>{$t('common.retry')}</button>
            {:else if $kokoroLoadStatus$.phase === 'ready'}
              <div class="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs">
                <span style="color:rgb(34,197,94)">✓ {$t('settings.tts.kokoro.ready', { modelId: $kokoroLoadStatus$.modelId ?? $kokoroModel$ })}</span>
                <button class="settings-input px-2 py-0.5 text-xs" on:click={kokoroDeleteCache}>{$t('settings.tts.kokoro.delete')}</button>
              </div>
            {/if}

            {#if $kokoroAccepted$}
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs opacity-70">{$t('settings.tts.voice')}</span>
                <select class="settings-input px-2 py-1 text-sm max-w-xs" bind:value={$kokoroVoiceId$}>
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
                bind:value={$ttsEdgeVoiceId$}
              >
                {#if edgeVoiceState === 'missing'}
                  <option value={$ttsEdgeVoiceId$}>
                    {$t('settings.tts.voiceCustomOption', { id: $ttsEdgeVoiceId$ })}
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
                bind:value={$ttsEdgeVoiceId$}
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
            <p class="text-red-500 text-sm">{sapiVoicesError}</p>
          {:else if !sapiVoices.length}
            <p class="text-sm opacity-60">{$t('settings.tts.noVoices')}</p>
          {:else}
            <select class="settings-input px-2 py-1 text-sm max-w-xs" bind:value={$ttsSapiVoiceId$}>
              <option value="">{$t('settings.tts.sysDefault')}</option>
              {#if sapiVoiceState === 'missing'}
                <option value={$ttsSapiVoiceId$}>
                  {$t('settings.tts.voiceMissingOption', { id: $ttsSapiVoiceId$ })}
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
            <select class="settings-input px-2 py-1 text-sm max-w-xs" bind:value={$readerVoiceUri$}>
              <option value="">{$t('settings.value.systemDefault')}</option>
              {#if webVoiceState === 'missing'}
                <!-- Keeps the select from rendering blank, and keeps the saved
                     id selectable so it survives a trip through this page. -->
                <option value={$readerVoiceUri$}>
                  {$t('settings.tts.voiceMissingOption', { id: $readerVoiceUri$ })}
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
                  class="settings-input px-2 py-1 text-xs"
                  title={$t('settings.ttsCustom.restoreTemplateTip')}
                  on:click={resetActivePresetToDefaults}
                >{$t('settings.ttsCustom.restoreTemplate')}<Ripple /></button>
                <button
                  class="settings-input px-2 py-1 text-xs"
                  on:click={() => (revealCustomSecrets = !revealCustomSecrets)}
                >{revealCustomSecrets ? $t('settings.ttsCustom.hideContent') : $t('settings.ttsCustom.showContent')}<Ripple /></button>
                {#if activePreset.helpUrl}
                  <button
                    type="button"
                    class="settings-input px-2 py-1 text-xs"
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

  {:else if activeSettings === 'AI'}
    <SettingsSectionHeader title={$t('settings.section.ai')} hint={$t('settings.section.aiHint')} />
    <div class="lg:col-span-3">
      <SettingsModels />
    </div>
    <div class="lg:col-span-3">
      <SettingsAi />
    </div>

  {:else if activeSettings === 'OCR'}
    <SettingsSectionHeader title={$t('settings.section.ocr')} hint={$t('settings.section.ocrHint')} />
    <div class="lg:col-span-3">
      <SettingsOcr />
    </div>

  {:else if activeSettings === 'Data'}
    <SettingsSectionHeader title={$t('settings.section.storageBackup')} hint={$t('settings.section.storageBackupHint')} />
    <div class="lg:col-span-3">
      <SettingsItemGroup title={$t('settings.item.syncStats')} tooltip="把每天的阅读时长同步到云端，桌面 + 手机 PWA 都能看到合并的数据">
        <SettingsSync />
      </SettingsItemGroup>
    </div>
    <div class="lg:col-span-3">
      <SettingsItemGroup title={$t('settings.item.localDataPaths')} tooltip={$t('settings.tip.localDataPaths')}>
        <SettingsDataPaths />
      </SettingsItemGroup>
    </div>
    {#if isTauri()}
      <SettingsItemGroup title={$t('settings.item.storageSource')} tooltip={$t('settings.tip.storageSource')}>
        <ButtonToggleGroup
          options={storageSourceOptions}
          bind:selectedOptionId={selectedStorageSource}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup title={$t('settings.item.persistentStorage')} tooltip={persistentStorageTooltip}>
      <div class="flex items-center">
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={persistentStorage} />
        {#if storageQuota}
          <div class="ml-4">{storageQuota}</div>
        {/if}
      </div>
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t('settings.item.resetUi')}
      tooltip={$t('settings.tip.resetUi')}
    >
      <button
        class="m-1 rounded-md border-2 border-gray-400 p-2 text-red-600"
        on:click={resetUiSettings}
      >
        {$t('settings.button.resetAndReload')}
        <Ripple />
      </button>
    </SettingsItemGroup>

    <SettingsSectionHeader title={$t('settings.section.importExport')} hint={$t('settings.section.importExportHint')} />
    <SettingsItemGroup title={$t('settings.item.epubFix')} tooltip={importHTMLFixModeTooltip}>
      <ButtonToggleGroup
        options={optionsForImportHTMLFixes}
        bind:selectedOptionId={importHTMLFixMode}
      />
    </SettingsItemGroup>
    {#if importHTMLFixMode !== ImportHTMLFixMode.OFF}
      <SettingsItemGroup
        title={$t('settings.item.linkOnly')}
        tooltip={$t('settings.tip.linkOnly')}
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={restrictImportFixToAnchor}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup title={$t('settings.item.autoImportExport')} tooltip={autoReplicationTypeTooltip}>
      <ButtonToggleGroup
        options={optionsForAutoReplicationType}
        bind:selectedOptionId={autoReplication}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.importExportStrategy')} tooltip={replicationSaveBehaviorTooltip}>
      <ButtonToggleGroup
        options={optionsForReplicationSaveBehavior}
        bind:selectedOptionId={replicationSaveBehavior}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.cacheData')} tooltip={cacheStorageDataTooltip}>
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={cacheStorageData} />
    </SettingsItemGroup>

    <SettingsSectionHeader title={$t('settings.section.readerBehaviorData')} hint={$t('settings.section.readerBehaviorDataHint')} />
    <SettingsItemGroup
      title={$t('settings.item.hideExternalHint')}
      tooltip={$t('settings.item.hideExternalHint')}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={hideExternalReadHint} />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.showPlaceholderCards')} tooltip={showExternalPlaceholderToolTip}>
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={showExternalPlaceholder}
      />
    </SettingsItemGroup>

    <SettingsSectionHeader title={$t('settings.section.diagnostics')} hint={$t('settings.section.diagnosticsHint')} />
    <SettingsItemGroup title={$t('settings.item.diagnosticLog')} tooltip={$t('settings.tip.diagnosticLog')}>
      <button
        class="m-1 rounded-md border-2 border-gray-400 p-2"
        on:click={() =>
          dialogManager.dialogs$.next([
            {
              component: LogReportDialog,
              props: {
                title: tImmediate('settings.button.exportDiagnostics'),
                message: tImmediate('settings.tip.exportDiagnosticsMsg')
              }
            }
          ])}
      >
        {$t('settings.button.exportDiagnostics')}
        <Ripple />
      </button>
    </SettingsItemGroup>
  {:else}
    <SettingsSectionHeader title={$t('settings.section.statsBasics')} hint={$t('settings.section.statsBasicsHint')} />
    <SettingsItemGroup
      title={$t('settings.item.keepDataOnDelete')}
      tooltip={$t('settings.tip.keepDataOnDelete')}
    >
      <div class="flex items-center">
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={keepLocalStatisticsOnDeletion}
        />
        <div
          tabindex="0"
          role="button"
          class="ml-4 hover:underline"
          on:click={() => {
            showSpinner = true;
            database
              .clearZombieStatistics()
              .catch(({ message }) =>
                dialogManager.dialogs$.next([
                  {
                    component: MessageDialog,
                    props: {
                      title: tImmediate('common.error'),
                      message: `${tImmediate('settings.tip.clearZombieError')}: ${message}`
                    }
                  }
                ])
              )
              .finally(() => (showSpinner = false));
          }}
          on:keyup={() => {}}
        >
          {$t('settings.button.clearZombieStats')}
        </div>
      </div>
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t('settings.item.overwriteBookCompletion')}
      tooltip={$t('settings.tip.overwriteBookCompletion')}
    >
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={overwriteBookCompletion}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t('settings.item.startOfDayHour', { n: startOfDayHours })}
      tooltip={$t('settings.tip.startOfDayHour')}
    >
      <input
        type="range"
        step="1"
        min="0"
        max="23"
        class={inputClasses}
        bind:value={startDayHoursForTracker}
      />
    </SettingsItemGroup>
    <SettingsSectionHeader title={$t('settings.section.statsSync')} hint={$t('settings.section.statsSyncHint')} />
    <SettingsItemGroup
      title={$t('settings.item.statsMergeMode')}
      tooltip={$t('settings.tip.statsMergeMode')}
    >
      <ButtonToggleGroup
        options={optionsForMergeMode}
        bind:selectedOptionId={statisticsMergeMode}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t('settings.item.readingGoalMergeMode')}
      tooltip={$t('settings.tip.readingGoalMergeMode')}
    >
      <ButtonToggleGroup
        options={optionsForMergeMode}
        bind:selectedOptionId={readingGoalsMergeMode}
      />
    </SettingsItemGroup>
    <SettingsSectionHeader title={$t('settings.section.statsTracking')} hint={$t('settings.section.statsTrackingHint')} />
    <SettingsItemGroup
      title={$t('settings.item.enableStats')}
      tooltip={$t('settings.tip.enableStats')}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={statisticsEnabled} />
    </SettingsItemGroup>
    {#if statisticsEnabled}
      <SettingsSectionHeader title={$t('settings.section.trackerBehavior')} hint={$t('settings.section.trackerBehaviorHint')} />
      <SettingsItemGroup title={$t('settings.item.statsAutoPause')} tooltip={trackerAutoPauseTooltip}>
        <ButtonToggleGroup
          options={optionsForTrackerAutoPause}
          bind:selectedOptionId={trackerAutoPause}
        />
      </SettingsItemGroup>
      <SettingsItemGroup title={$t('settings.item.statsOnComplete')}>
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={openTrackerOnCompletion}
        />
      </SettingsItemGroup>
      <SettingsItemGroup
        title={$t('settings.item.updateOnComplete')}
        tooltip={$t('settings.tip.updateOnComplete')}
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={addCharactersOnCompletion}
        />
      </SettingsItemGroup>
      <SettingsSectionHeader title={$t('settings.section.autoThreshold')} hint={$t('settings.section.autoThresholdHint')} />
      <SettingsItemGroup
        title={$t('settings.item.autoStartSec')}
        tooltip={$t('settings.tip.autoStartSec')}
      >
        <input
          type="number"
          class={inputClasses}
          step="1"
          min="0"
          bind:value={trackerAutoStartTime}
          on:blur={() => {
            const newValue = Number.parseFloat(`${trackerAutoStartTime ?? 0}`);

            if (isNaN(newValue) || newValue < 1) {
              trackerAutoStartTime = 0;
            }
          }}
        />
      </SettingsItemGroup>
      <SettingsItemGroup
        title="空闲时间 (分钟)"
        tooltip={'无页面交互达到此分钟数后统计自动暂停（0 = 关闭，最大 12 小时）'}
      >
        <input
          type="number"
          class={inputClasses}
          step="0.5"
          min="0"
          bind:value={trackerIdleTimeInMin}
          on:blur={() => {
            if (!trackerIdleTimeInMin || trackerIdleTimeInMin < 0) {
              trackerIdleTime = 0;
            } else if (trackerIdleTimeInMin > 43200) {
              trackerIdleTime = 900;
            } else {
              trackerIdleTime = Math.floor(trackerIdleTimeInMin * 60);
            }
          }}
        />
      </SettingsItemGroup>
      <SettingsSectionHeader title="跳过检测" hint="单次采样字数突变（跳读 / 后退）的判定阈值与动作" />
      <SettingsItemGroup
        title="正向跳过阈值"
        tooltip={'两次采样间正向字数增量超过此阈值触发相应动作（0 = 关闭）'}
      >
        <input
          type="number"
          class={inputClasses}
          step="1"
          min="0"
          bind:value={trackerForwardSkipThreshold}
          on:blur={() => {
            if (trackerForwardSkipThreshold === 0) {
              trackerForwardSkipThreshold = 0;
            } else if (!trackerForwardSkipThreshold || trackerForwardSkipThreshold < 0) {
              trackerForwardSkipThreshold = 2700;
            }
          }}
        />
      </SettingsItemGroup>
      <SettingsItemGroup
        title="反向跳过阈值"
        tooltip={'两次采样间负向字数差超过此阈值触发相应动作（0 = 关闭）'}
      >
        <input
          type="number"
          class={inputClasses}
          step="1"
          bind:value={trackerBackwardSkipThreshold}
          on:blur={() => {
            if (trackerBackwardSkipThreshold < 0) {
              trackerBackwardSkipThreshold = Math.abs(trackerBackwardSkipThreshold);
            } else if (trackerBackwardSkipThreshold === 0) {
              trackerBackwardSkipThreshold = 0;
            } else if (!trackerBackwardSkipThreshold) {
              trackerBackwardSkipThreshold = 2700;
            }
          }}
        />
      </SettingsItemGroup>
      {#if trackerForwardSkipThreshold || trackerBackwardSkipThreshold}
        <SettingsItemGroup
          title="阈值动作"
          tooltip={'达到阈值时执行的动作'}
        >
          <ButtonToggleGroup
            options={optionsForTrackerSkipThresholdAction}
            bind:selectedOptionId={trackerSkipThresholdAction}
          />
        </SettingsItemGroup>
      {/if}
      {#if trackerAutoPause !== TrackerAutoPause.OFF}
        <SettingsItemGroup
          title="词典检测"
          tooltip={'开启后，检测到 Yomitan / jpdb-browser-reader 打开时跳过自动暂停（Yomitan 需关闭 Secure Container）'}
        >
          <ButtonToggleGroup
            options={optionsForToggle}
            bind:selectedOptionId={trackerPopupDetection}
          />
        </SettingsItemGroup>
      {/if}
      {#if trackerIdleTime > 0}
        <SettingsItemGroup
          title="空闲时回滚统计"
          tooltip={'开启后，会从本次会话中扣除空闲时间以回滚统计'}
        >
          <ButtonToggleGroup
            options={optionsForToggle}
            bind:selectedOptionId={adjustStatisticsAfterIdleTime}
          />
        </SettingsItemGroup>
      {/if}
      <SettingsSectionHeader title="阅读目标" hint="按日 / 周设定的字数与时长目标" />
      <div class="lg:col-span-3">
        <SettingsReadingGoals on:spinner={({ detail }) => (showSpinner = detail)} />
      </div>
    {/if}
  {/if}
  {#if showSpinner}
    <div class="tap-highlight-transparent fixed inset-0 bg-black/[.2]" />
    <div class="fixed inset-0 flex h-full w-full items-center justify-center text-7xl">
      <Fa icon={faSpinner} spin />
    </div>
  {/if}
</div>

<style>
  .secret-masked {
    -webkit-text-security: disc;
  }
</style>
