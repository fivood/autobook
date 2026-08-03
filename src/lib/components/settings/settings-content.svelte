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
  import { getEdgeVoiceGroups } from '$lib/data/edge-voices';
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
  import { t, tImmediate } from '$lib/i18n';
  import type { WritingMode } from '$lib/data/writing-mode';
  import { secondsToMinutes } from '$lib/functions/statistic-util';
  import { dummyFn } from '$lib/functions/utils';
  import {
    ReplicationSaveBehavior,
    AutoReplicationType
  } from '$lib/functions/replication/replication-options';
  import Fa from 'svelte-fa';
  import { onDestroy } from 'svelte';

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

  export let ocrPromptEnabled: boolean;

  export let ocrSkippedBooks: string;

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

  /** Grouping key for the preset dropdown — sorted by how "hands-off" the
   *  choice is (nothing to sign up for → free tier → paid → manual). */
  type PresetCategory = 'local' | 'cloudFree' | 'cloudPaid' | 'manual';

  interface CustomPreset {
    label: string;
    /** Section this preset appears under in the picker. */
    category: PresetCategory;
    method: string;
    endpoint: string;
    headers: string;
    body: string;
    audioPath?: string;
    proxyUrl?: string;
    /** Optional curated voice list shown as a dropdown. */
    voices?: { value: string; label: string }[];
    /** Dot-path to the voice field inside the body JSON, e.g. "voice.name". */
    voicePath?: string;
    /** How the voice value is embedded. JSON = replace field; xml = replace SSML name attribute; url = replace endpoint URL segment. */
    voiceFormat?: 'json' | 'xml' | 'url';
    /** Regex matching the part of the endpoint URL to replace when voiceFormat='url'. */
    voiceUrlPattern?: string;
    /** Direct link to the provider's API key console page. */
    helpUrl?: string;
    /** One-line plain-language hint shown under the preset row. */
    helpHint?: string;
  }

  const PRESET_CATEGORY_LABEL: Record<PresetCategory, string> = {
    local: '本地免费（自建服务器，完全离线）',
    cloudFree: '云端免费 / 有免费额度',
    cloudPaid: '云端付费',
    manual: '手动配置'
  };
  const PRESET_CATEGORY_ORDER: PresetCategory[] = ['local', 'cloudFree', 'cloudPaid', 'manual'];

  const CUSTOM_PRESETS: Record<string, CustomPreset> = {
    mimo: {
      label: 'MiMo-V2.5-TTS（小米，国内直连，限时免费）',
      category: 'cloudFree',
      method: 'POST',
      endpoint: 'https://api.xiaomimimo.com/v1/chat/completions',
      headers: JSON.stringify(
        { 'Content-Type': 'application/json', 'api-key': 'YOUR_API_KEY' },
        null,
        2
      ),
      body: JSON.stringify(
        {
          model: 'mimo-v2.5-tts',
          messages: [
            { role: 'user', content: '清晰、稳定、平和的朗读语气，适合长时间听书。' },
            { role: 'assistant', content: '{text}' }
          ],
          audio: { format: 'wav', voice: '茉莉' },
          stream: false
        },
        null,
        2
      ),
      audioPath: 'choices.0.message.audio.data',
      voices: [
        { value: '茉莉', label: '茉莉（默认）' }
      ],
      voicePath: 'audio.voice',
      helpUrl: 'https://api.xiaomimimo.com',
      helpHint: '小米 MiMo TTS 限时免费阶段（中文听书白嫖首选）；不绑卡，注册即用'
    },
    deepinfraQwen3: {
      label: 'DeepInfra Qwen3-TTS（免费额度，中文极强，OpenAI 兼容）',
      category: 'cloudFree',
      method: 'POST',
      endpoint: 'https://api.deepinfra.com/v1/audio/speech',
      headers: JSON.stringify(
        { 'Content-Type': 'application/json', Authorization: 'Bearer YOUR_DEEPINFRA_TOKEN' },
        null,
        2
      ),
      body: JSON.stringify(
        {
          model: 'Qwen/Qwen3-TTS',
          input: '{text}',
          voice: 'Vivian',
          response_format: 'mp3',
          speed: 1.0
        },
        null,
        2
      ),
      voices: [
        { value: 'Vivian', label: 'Vivian（女，中文）' },
        { value: 'Serena', label: 'Serena（女，中文）' },
        { value: 'Ono_Anna', label: 'Ono_Anna（女，日语）' },
        { value: 'Sohee', label: 'Sohee（女，韩语）' },
        { value: 'Uncle_Fu', label: 'Uncle_Fu（老者男）' },
        { value: 'Dylan', label: 'Dylan（男）' },
        { value: 'Eric', label: 'Eric（男）' },
        { value: 'Ryan', label: 'Ryan（男）' },
        { value: 'Aiden', label: 'Aiden（男）' }
      ],
      voicePath: 'voice',
      helpUrl: 'https://deepinfra.com/dash/api_keys',
      helpHint:
        '阿里 Qwen3-TTS 官方托管，OpenAI 兼容接口。新账号有免费额度，无需绑卡试用；10 语言（含中/日/韩），中文极佳。国外服务，需梯子。'
    },
    siliconflow: {
      label: '硅基流动 SiliconFlow（国内直连，按字符付费）',
      category: 'cloudPaid',
      method: 'POST',
      endpoint: 'https://api.siliconflow.cn/v1/audio/speech',
      headers: JSON.stringify(
        { 'Content-Type': 'application/json', Authorization: 'Bearer YOUR_API_KEY' },
        null,
        2
      ),
      body: JSON.stringify(
        {
          model: 'FunAudioLLM/CosyVoice2-0.5B',
          input: '{text}',
          voice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
          response_format: 'mp3',
          speed: 1.0
        },
        null,
        2
      ),
      voices: [
        { value: 'FunAudioLLM/CosyVoice2-0.5B:alex', label: 'CosyVoice2 · alex（男）' },
        { value: 'FunAudioLLM/CosyVoice2-0.5B:anna', label: 'CosyVoice2 · anna（女）' },
        { value: 'FunAudioLLM/CosyVoice2-0.5B:bella', label: 'CosyVoice2 · bella（女）' },
        { value: 'FunAudioLLM/CosyVoice2-0.5B:benjamin', label: 'CosyVoice2 · benjamin（男）' },
        { value: 'FunAudioLLM/CosyVoice2-0.5B:charles', label: 'CosyVoice2 · charles（男）' },
        { value: 'FunAudioLLM/CosyVoice2-0.5B:claire', label: 'CosyVoice2 · claire（女）' },
        { value: 'FunAudioLLM/CosyVoice2-0.5B:david', label: 'CosyVoice2 · david（男）' },
        { value: 'FunAudioLLM/CosyVoice2-0.5B:diana', label: 'CosyVoice2 · diana（女）多语' },
        { value: 'RVC-Boss/GPT-SoVITS:default', label: 'GPT-SoVITS · 默认' },
        { value: 'fishaudio/fish-speech-1.5:default', label: 'Fish-Speech 1.5 · 默认' }
      ],
      voicePath: 'voice',
      helpUrl: 'https://cloud.siliconflow.cn/account/ak',
      helpHint: 'OpenAI 兼容接口，国内直连不用梯子。按字符计费（CosyVoice2 约 ¥105/100 万字符），部分模型有限免，新用户没有 14 元赠送了（2025 中起取消）'
    },
    aliyunQwen: {
      label: 'Aliyun DashScope Qwen3-TTS-Flash（国内直连，有免费额度）',
      category: 'cloudFree',
      method: 'POST',
      endpoint:
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      headers: JSON.stringify(
        { 'Content-Type': 'application/json', Authorization: 'Bearer YOUR_DASHSCOPE_API_KEY' },
        null,
        2
      ),
      body: JSON.stringify(
        {
          model: 'qwen3-tts-flash',
          input: { text: '{text}', voice: 'Cherry' },
          parameters: { language_type: 'Chinese' }
        },
        null,
        2
      ),
      audioPath: 'url:output.audio.url',
      voices: [
        { value: 'Cherry', label: 'Cherry（女）' },
        { value: 'Serena', label: 'Serena（女）' },
        { value: 'Ethan', label: 'Ethan（男）' },
        { value: 'Chelsie', label: 'Chelsie（女）' }
      ],
      voicePath: 'input.voice',
      helpUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
      helpHint: '阿里云百炼控制台（dashscope 已迁到 bailian） → 模型广场开通 Qwen-TTS → 右上角拿 API key'
    },
    volcengine: {
      label: '火山引擎 大模型 TTS（按字符付费）',
      category: 'cloudPaid',
      method: 'POST',
      endpoint: 'https://openspeech.bytedance.com/api/v1/tts',
      headers: JSON.stringify(
        { 'Content-Type': 'application/json', Authorization: 'Bearer; YOUR_TOKEN' },
        null,
        2
      ),
      body: JSON.stringify(
        {
          app: { appid: 'YOUR_APPID', token: 'YOUR_TOKEN', cluster: 'volcano_tts' },
          user: { uid: 'autobook' },
          audio: { voice_type: 'BV700_streaming', encoding: 'mp3', speed_ratio: 1.0 },
          request: { reqid: 'autobook', text: '{text}', operation: 'query' }
        },
        null,
        2
      ),
      voices: [
        { value: 'BV700_streaming', label: 'BV700（默认）' },
        { value: 'BV701_streaming', label: 'BV701' },
        { value: 'BV702_streaming', label: 'BV702' },
        { value: 'BV703_streaming', label: 'BV703' }
      ],
      voicePath: 'audio.voice_type',
      helpUrl: 'https://console.volcengine.com/speech/app',
      helpHint: '火山引擎控制台 → 语音合成 → 应用列表，appid + token 全在「应用详情」'
    },
    googleCloud: {
      label: 'Google Cloud TTS（每月 100 万字符免费，性价比之王）',
      category: 'cloudFree',
      method: 'POST',
      endpoint:
        'https://texttospeech.googleapis.com/v1/text:synthesize?key=YOUR_API_KEY',
      headers: JSON.stringify(
        { 'Content-Type': 'application/json' },
        null,
        2
      ),
      body: JSON.stringify(
        {
          input: { text: '{text}' },
          voice: { languageCode: 'cmn-CN', name: 'cmn-CN-Chirp3-HD-Kore' },
          audioConfig: { audioEncoding: 'MP3' }
        },
        null,
        2
      ),
      audioPath: 'audioContent',
      voices: [
        { value: 'cmn-CN-Chirp3-HD-Kore', label: 'Kore（女）' },
        { value: 'cmn-CN-Chirp3-HD-Aoede', label: 'Aoede（女）' },
        { value: 'cmn-CN-Chirp3-HD-Callirrhoe', label: 'Callirrhoe（女）' },
        { value: 'cmn-CN-Chirp3-HD-Charon', label: 'Charon（男）' },
        { value: 'cmn-CN-Chirp3-HD-Orus', label: 'Orus（男）' },
        { value: 'cmn-CN-Chirp3-HD-Puck', label: 'Puck（男）' },
        { value: 'cmn-CN-Wavenet-A', label: 'WaveNet A（女）' },
        { value: 'cmn-CN-Wavenet-B', label: 'WaveNet B（男）' },
        { value: 'cmn-CN-Wavenet-C', label: 'WaveNet C（男）' },
        { value: 'cmn-CN-Wavenet-D', label: 'WaveNet D（女）' },
        { value: 'cmn-CN-Standard-A', label: 'Standard A（女）' },
        { value: 'cmn-CN-Standard-B', label: 'Standard B（男）' }
      ],
      voicePath: 'voice.name',
      helpUrl: 'https://console.cloud.google.com/apis/credentials',
      helpHint: '启用 Cloud Text-to-Speech API + 创建 API 密钥；国外服务，需梯子'
    },
    geminiTts: {
      label: 'Gemini 2.5 Flash TTS（每月 100 万字符免费，实验）',
      category: 'cloudFree',
      method: 'POST',
      endpoint:
        'https://texttospeech.googleapis.com/v1/text:synthesize?key=YOUR_API_KEY',
      headers: JSON.stringify(
        { 'Content-Type': 'application/json' },
        null,
        2
      ),
      body: JSON.stringify(
        {
          input: {
            text: '{text}',
            prompt: '清晰、稳定、平和的朗读语气，适合长时间听书。'
          },
          voice: {
            languageCode: 'cmn-CN',
            name: 'Kore',
            modelName: 'gemini-2.5-flash-tts'
          },
          audioConfig: { audioEncoding: 'MP3' }
        },
        null,
        2
      ),
      audioPath: 'audioContent',
      voices: [
        { value: 'Kore', label: 'Kore（女）' },
        { value: 'Aoede', label: 'Aoede（女）' },
        { value: 'Callirrhoe', label: 'Callirrhoe（女）' },
        { value: 'Charon', label: 'Charon（男）' },
        { value: 'Orus', label: 'Orus（男）' },
        { value: 'Puck', label: 'Puck（男）' }
      ],
      voicePath: 'voice.name',
      helpUrl: 'https://aistudio.google.com/apikey',
      helpHint: '每月前 100 万字符免费；模型还在 Preview 阶段，可能限流'
    },
    openai: {
      label: 'OpenAI gpt-4o-mini-tts（2025 新，$0.015/min，13 音色可控指令）',
      category: 'cloudPaid',
      method: 'POST',
      endpoint: 'https://api.openai.com/v1/audio/speech',
      headers: JSON.stringify(
        { 'Content-Type': 'application/json', Authorization: 'Bearer YOUR_API_KEY' },
        null,
        2
      ),
      body: JSON.stringify(
        {
          model: 'gpt-4o-mini-tts',
          voice: 'marin',
          input: '{text}',
          instructions: '清晰、稳定、平和的朗读语气，适合长时间听书。'
        },
        null,
        2
      ),
      voices: [
        // Recommended for quality-focused use (per OpenAI 2026 docs)
        { value: 'marin', label: 'Marin ★ (2025 新，推荐)' },
        { value: 'cedar', label: 'Cedar ★ (2025 新，推荐)' },
        // Added March 2025
        { value: 'ballad', label: 'Ballad (2025 新)' },
        { value: 'verse', label: 'Verse (2025 新)' },
        { value: 'coral', label: 'Coral' },
        { value: 'sage', label: 'Sage' },
        { value: 'ash', label: 'Ash' },
        // Original 6 (still available on gpt-4o-mini-tts)
        { value: 'alloy', label: 'Alloy' },
        { value: 'echo', label: 'Echo' },
        { value: 'fable', label: 'Fable' },
        { value: 'onyx', label: 'Onyx' },
        { value: 'nova', label: 'Nova' },
        { value: 'shimmer', label: 'Shimmer' }
      ],
      voicePath: 'voice',
      helpUrl: 'https://platform.openai.com/api-keys',
      helpHint:
        'gpt-4o-mini-tts 比老 tts-1 便宜且好，支持中文；instructions 字段可用自然语言控制语气/情绪。约 $0.015/min，需绑卡。'
    },
    azure: {
      label: 'Azure Speech（每月 50 万字符免费，配置繁琐）',
      category: 'cloudFree',
      method: 'POST',
      endpoint: 'https://YOUR_REGION.tts.speech.microsoft.com/cognitiveservices/v1',
      headers: JSON.stringify(
        {
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
          'Ocp-Apim-Subscription-Key': 'YOUR_SUBSCRIPTION_KEY'
        },
        null,
        2
      ),
      body: `<speak version='1.0' xml:lang='zh-CN'><voice name='zh-CN-XiaoxiaoNeural'>{text}</voice></speak>`,
      voices: [
        { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女）' },
        { value: 'zh-CN-YunyangNeural', label: '云扬（男）' },
        { value: 'zh-CN-YunxiNeural', label: '云希（男）' },
        { value: 'zh-CN-XiaoyiNeural', label: '小艺（女）' },
        { value: 'zh-CN-YunjianNeural', label: '云健（男）' }
      ],
      voicePath: 'voice',
      voiceFormat: 'xml',
      helpUrl: 'https://portal.azure.com',
      helpHint: '①注册 Azure（绑卡）→ ②创建 Speech 资源 → ③拿订阅 key + region → ④替换 endpoint 里 YOUR_REGION。每月 50 万字符免费，晓晓/云扬质量顶级'
    },
    elevenlabs: {
      label: 'ElevenLabs（仅英语推荐，试用免费 1 万字符）',
      category: 'cloudPaid',
      method: 'POST',
      endpoint:
        'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=mp3_44100_128',
      headers: JSON.stringify(
        { 'Content-Type': 'application/json', 'xi-api-key': 'YOUR_API_KEY' },
        null,
        2
      ),
      body: JSON.stringify(
        {
          text: '{text}',
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        },
        null,
        2
      ),
      voices: [
        { value: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' },
        { value: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi' },
        { value: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella' },
        { value: 'ErXwobaYiN019PkySvjV', label: 'Antoni' },
        { value: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli' },
        { value: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh' }
      ],
      voiceFormat: 'url',
      voiceUrlPattern: '(?<=/text-to-speech/)[^/?]+',
      helpUrl: 'https://elevenlabs.io/app/settings/api-keys',
      helpHint: '每月免费 1 万字符（试用）；中文一般、英语顶级；按字符贵'
    },
    localQwentts: {
      label: '本地 Qwen3-TTS（qwentts.cpp，llama.cpp 系）',
      category: 'local',
      method: 'POST',
      endpoint: 'http://localhost:8080/v1/audio/speech',
      headers: JSON.stringify({ 'Content-Type': 'application/json' }, null, 2),
      body: JSON.stringify(
        { model: 'qwen3-tts', input: '{text}', voice: 'Vivian', response_format: 'wav' },
        null,
        2
      ),
      voices: [
        { value: 'Vivian', label: 'Vivian（女，中文）' },
        { value: 'Serena', label: 'Serena（女，中文）' },
        { value: 'Uncle_Fu', label: 'Uncle_Fu（老者男）' },
        { value: 'Dylan', label: 'Dylan（男）' },
        { value: 'Eric', label: 'Eric（男）' },
        { value: 'Aiden', label: 'Aiden（男）' }
      ],
      voicePath: 'voice',
      helpUrl: 'https://github.com/ServeurpersoCom/qwentts.cpp',
      helpHint:
        '完全离线本地。装 qwentts.cpp（C++/GGML，CPU/CUDA/Vulkan 加速）启 llama-server，即可用 Qwen3-TTS 音质白嫖。改端口/主机自适应。'
    },
    localGptSovits: {
      label: '本地 GPT-SoVITS（声音克隆神器）',
      category: 'local',
      method: 'POST',
      endpoint: 'http://localhost:9880/tts',
      headers: JSON.stringify({ 'Content-Type': 'application/json' }, null, 2),
      body: JSON.stringify(
        {
          text: '{text}',
          text_lang: 'zh',
          ref_audio_path: 'YOUR_REF_AUDIO.wav',
          prompt_text: 'YOUR_PROMPT_TEXT',
          prompt_lang: 'zh',
          text_split_method: 'cut5',
          batch_size: 1,
          media_type: 'wav',
          streaming_mode: false
        },
        null,
        2
      ),
      helpUrl: 'https://github.com/RVC-Boss/GPT-SoVITS',
      helpHint:
        '完全离线本地。启 GPT-SoVITS 官方 api_v2.py 服务，填参考音频路径即可用你自己的声音朗读。中文一等公民。'
    },
    localPiper: {
      label: '本地 Piper TTS（超轻量 CPU-only）',
      category: 'local',
      method: 'POST',
      endpoint: 'http://localhost:5000/api/tts',
      headers: JSON.stringify({ 'Content-Type': 'application/json' }, null, 2),
      body: JSON.stringify({ text: '{text}' }, null, 2),
      helpUrl: 'https://github.com/rhasspy/piper',
      helpHint:
        '完全离线本地。Piper 是纯 CPU、几十 MB 的 ONNX 小模型，用 rhasspy/wyoming-piper 或 piper-http 起 HTTP 端。质量一般但极快，中文有社区训练版可用。'
    },
    manual: {
      label: '手动配置（自由接入）',
      category: 'manual',
      method: 'POST',
      endpoint: '',
      headers: '{\n  "Content-Type": "application/json"\n}',
      body: '',
      audioPath: '',
      proxyUrl: '',
      helpHint: '没在上面的列表里？自己填 endpoint / headers / body / audioPath。{text} 占位符会替换成当前句子。'
    },
  };

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
        props: { existingThemes: optionsForTheme }
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
            on:keyup={dummyFn}
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
            on:keyup={dummyFn}
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

    {#if false}<!-- TTS section moved to its own tab in 1.12.3; see {:else if activeSettings === 'TTS'} below -->
      <SettingsSectionHeader title="TTS 朗读" hint="桌面端分页模式专属。包含引擎、起点、快捷键和自定义 HTTP TTS" />
      <SettingsItemGroup
        title="朗读引擎"
        tooltip="推荐：系统 TTS（SAPI）+ Windows 11 自然语音（设置→辅助功能→讲述人→添加自然语音），音质接近云端神经网络且完全离线。Web Speech 是浏览器内建作兜底。Edge 在线音色为实验功能，微软持续升级反爬，大概率连不上，不建议依赖。切换后请重开书生效。"
      >
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2 flex-wrap">
            <select
              class="rounded bg-background-color border-b-2 border-gray-400/50 px-2 py-1 text-sm max-w-[14rem] truncate"
              bind:value={$ttsEngine$}
            >
              <option value="web">Web Speech（浏览器）</option>
              <option value="sapi">系统 TTS（SAPI）</option>
              <option value="edge">Edge TTS（微软免费，300+ 音色，零配置）</option>
              <option value="kokoro">Kokoro-82M（内置离线）</option>
              <option value="custom">自定义 HTTP TTS</option>
            </select>
            <button
              class="rounded-md border-2 border-gray-400 px-3 py-1 text-sm disabled:opacity-40"
              disabled={previewState === 'loading' || previewState === 'playing'}
              on:click={previewVoice}
            >
              {previewState === 'loading'
                ? '加载中…'
                : previewState === 'playing'
                  ? '播放中…'
                  : '试听'}
              <Ripple />
            </button>
          </div>
          {#if previewState === 'error'}
            <p class="text-red-500 text-xs">{previewMessage}</p>
          {/if}
        </div>
      </SettingsItemGroup>

      <SettingsItemGroup
        title="朗读起点"
        tooltip="按播放按钮（或 V 快捷键）时从哪里开始读。选区：用当前选中文字或光标位置（无选区时降级到上次保存位置）；上次位置：从上次暂停的字位置续读；章节开头：从当前章节第一段开始。"
      >
        <select
          class="rounded bg-background-color border-b-2 border-gray-400/50 px-2 py-1 text-sm max-w-[12rem]"
          bind:value={$ttsStartStrategy$}
        >
          <option value="selection">选区 / 光标位置（默认）</option>
          <option value="resume">上次保存位置</option>
          <option value="section-start">章节开头</option>
        </select>
      </SettingsItemGroup>

      <SettingsItemGroup
        title="章末自动续读"
        tooltip="读到本章最后一段时，是否自动翻到下一章继续。关闭则停在章末。"
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={$ttsAutoAdvanceSection$}
        />
      </SettingsItemGroup>

      <SettingsItemGroup
        title="朗读全局快捷键"
        tooltip="任意窗口前台时按下都能切换朗读。点「录制」然后按下你想要的组合键（如 Ctrl+Alt+P）即可；注册冲突时不报错只是按下无反应。"
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
            {recordingShortcut ? '按下按键…' : $ttsShortcut$ || '(已禁用)'}
            <Ripple />
          </button>
          <button
            class="rounded-md border-2 border-gray-400 px-3 py-1 text-sm"
            on:click={() => {
              recordingShortcut = false;
              ttsShortcut$.next('ctrl+alt+p');
            }}
          >
            重置
            <Ripple />
          </button>
          <button
            class="rounded-md border-2 border-gray-400 px-3 py-1 text-sm"
            on:click={() => {
              recordingShortcut = false;
              ttsShortcut$.next('');
            }}
          >
            禁用
            <Ripple />
          </button>
        </div>
      </SettingsItemGroup>

      {#if $ttsEngine$ === 'kokoro'}
        <div class="lg:col-span-3">
          <SettingsItemGroup
            title="Kokoro-82M 离线 TTS"
            tooltip="开源神经网络 TTS，82M 参数（模型型号名，非磁盘大小）。首次启用从 Hugging Face 下载模型到本机 IndexedDB 缓存，之后完全离线。两个变体：v1.0 只有英语音色（约 80MB）；v1.1-zh 有 40+ 中文音色（男女）+ 3 个新英语音色（约 320MB）。"
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
                  <p>
                    启用 Kokoro 需下载模型（首次，之后离线）。当前选择：<code>{$kokoroModel$ === 'v1.1-zh' ? 'onnx-community/Kokoro-82M-v1.1-zh-ONNX' : 'onnx-community/Kokoro-82M-v1.0-ONNX'}</code>
                  </p>
                  <p class="mt-1 opacity-70">下载后用 IndexedDB 缓存，不上传任何阅读内容。切换模型会各自下载各自的一份。</p>
                  <button
                    class="settings-input mt-2 inline-flex items-center gap-1 px-3 py-1 text-sm"
                    on:click={() => {
                      $kokoroAccepted$ = true;
                      kokoroEnsureLoad();
                    }}
                  >下载并启用</button>
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
                    ⚠ 已 {kokoroStallSeconds}s 无进展，可能网络已中断
                    <button class="settings-input ml-2 px-2 py-0.5 text-xs" on:click={kokoroRetryLoad}>重试下载</button>
                  </div>
                {/if}
              {:else if $kokoroLoadStatus$.phase === 'errored'}
                <p class="text-red-500 text-xs">下载失败：{$kokoroLoadStatus$.message}</p>
                <button
                  class="settings-input px-3 py-1 text-sm"
                  on:click={kokoroRetryLoad}
                >重试</button>
              {:else if $kokoroLoadStatus$.phase === 'ready'}
                <div class="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span style="color:rgb(34,197,94)">✓ 模型已就绪 · {$kokoroLoadStatus$.modelId ?? $kokoroModel$}</span>
                  <button class="settings-input px-2 py-0.5 text-xs" on:click={kokoroDeleteCache}>删除本地模型</button>
                </div>
              {/if}

              {#if $kokoroAccepted$}
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-xs opacity-70">音色</span>
                  <select
                    class="settings-input px-2 py-1 text-sm max-w-xs"
                    bind:value={$kokoroVoiceId$}
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
                  中文听书优选 v1.1-zh；中文音色为编号命名（zf_/zm_），无描述性名称，可用「试听」按钮快速筛选。
                </p>
                <p class="text-xs opacity-60">缓存在浏览器 Cache Storage；不再需要时可用上方「删除本地模型」按钮释放磁盘</p>
              {/if}
            </div>
          </SettingsItemGroup>
        </div>
      {/if}

      {#if $ttsEngine$ === 'edge'}
        <div class="lg:col-span-3">
          <SettingsItemGroup
            title="Edge TTS 语音（微软免费）"
            tooltip="走微软 Edge 浏览器内置「大声朗读」使用的免费 WSS 端点，不需要账号、不需要付费。300+ 神经网络音色（含中/英/日/韩/粤/台），中文晓晓/云扬质量对标 Azure Neural TTS。走网络，需能连 speech.platform.bing.com。"
          >
            <div class="space-y-2 text-sm">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs opacity-70">音色</span>
                <select
                  class="settings-input px-2 py-1 text-sm max-w-xs"
                  bind:value={$ttsEdgeVoiceId$}
                >
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
                <span class="text-xs opacity-70">或自定义音色 ID</span>
                <input
                  type="text"
                  class="settings-input px-2 py-1 text-sm w-72"
                  placeholder="如 zh-CN-XiaozhenNeural"
                  bind:value={$ttsEdgeVoiceId$}
                />
              </div>
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
                国内需代理才能连 speech.platform.bing.com。留空会自动读取系统代理，通常无需填写；报
                <code>tls handshake eof</code> 时在此手填，如 <code>http://127.0.0.1:7897</code>（暂不支持 socks5，请用混合端口的 http 入口）。
              </p>
              <p class="text-xs opacity-60">
                完整音色清单：<code>https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4</code>
              </p>
            </div>
          </SettingsItemGroup>
        </div>
      {/if}

      {#if $ttsEngine$ === 'sapi'}
        <div class="lg:col-span-3">
          <SettingsItemGroup
            title="系统 TTS 语音"
            tooltip="注：Windows 11 设置里的「Natural 自然语音」是 Narrator 专属，应用层（包括本 app）调不到。要高质量本地 TTS 暂时无解，建议改用自定义 HTTP TTS 接 OpenAI / Azure 等付费 API。下面是系统暴露给应用的 SAPI 5 老音色，质量基础。"
          >
            {#if sapiVoicesError}
              <p class="text-red-500 text-sm">{sapiVoicesError}</p>
            {:else if !sapiVoices.length}
              <p class="text-sm opacity-60">{$t('settings.tts.noVoices')}</p>
            {:else}
              <select
                class="rounded bg-background-color border-b-2 border-gray-400/50 px-2 py-1 text-sm max-w-xs"
                bind:value={$ttsSapiVoiceId$}
              >
                <option value="">{$t('settings.tts.sysDefault')}</option>
                {#each sapiVoices as voice (voice.id)}
                  <option value={voice.id}>{voice.name} ({voice.language})</option>
                {/each}
              </select>
            {/if}
          </SettingsItemGroup>
        </div>
      {/if}

      {#if $ttsEngine$ === 'web'}
        <div class="lg:col-span-3">
          <SettingsItemGroup
            title="Web Speech 语音"
            tooltip="WebView2 (Edge) 暴露的浏览器语音。中文 / 日语音色排在最前。"
          >
            {#if !webVoices.length}
              <p class="text-sm opacity-60">{$t('settings.tts.noVoices')}</p>
            {:else}
              <select
                class="rounded bg-background-color border-b-2 border-gray-400/50 px-2 py-1 text-sm max-w-xs"
                bind:value={$readerVoiceUri$}
              >
                <option value="">{$t('settings.value.systemDefault')}</option>
                {#each webVoices as voice (voice.voiceURI)}
                  <option value={voice.voiceURI}>{voice.name} ({voice.lang})</option>
                {/each}
              </select>
            {/if}
          </SettingsItemGroup>
        </div>
      {/if}

      {#if $ttsEngine$ === 'custom'}
        <div class="lg:col-span-3">
          <SettingsItemGroup
            title="自定义 HTTP TTS"
            tooltip={'把任意 TTS API 接进来。{text} 会被替换为当前句子并 JSON 转义。响应是音频字节（OpenAI/ElevenLabs/Azure）「音频路径」留空；响应是 JSON 包 base64 音频（MiMo 等）则填出 base64 字段的 dot-path，如 choices.0.message.audio.data。'}
          >
            <p class="text-xs opacity-70 mb-2">
              提示：Google Cloud TTS（含 Chirp3-HD）每月前 100 万字符免费；Gemini TTS 按 token 计费、无免费额度。Chirp3-HD
              不支持 speakingRate / pitch / SSML，需要这些参数请切回 WaveNet / Neural2。代理 URL 仅影响本应用的
              TTS 请求。
            </p>
            <div class="grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-x-3 gap-y-2 items-start">
              <span class="text-xs opacity-80 pt-2">服务预设</span>
              <div class="flex items-center gap-2 flex-wrap">
                <select
                  class="rounded bg-background-color border-b-2 border-gray-400/50 px-2 py-1 text-sm"
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
                  class="rounded-md border-2 border-gray-400 px-2 py-1 text-xs"
                  title="把当前预设的字段重置为默认模板（不影响其他预设保存的 key）"
                  on:click={resetActivePresetToDefaults}
                >
                  恢复模板
                  <Ripple />
                </button>
                <button
                  class="rounded-md border-2 border-gray-400 px-2 py-1 text-xs"
                  on:click={() => (revealCustomSecrets = !revealCustomSecrets)}
                >
                  {revealCustomSecrets ? '隐藏内容' : '显示内容'}
                  <Ripple />
                </button>
              </div>

              {#if presetVoices.length}
                <span class="text-xs opacity-80 pt-2">音色</span>
                <select
                  class="rounded bg-background-color border-b-2 border-gray-400/50 px-2 py-1 text-sm"
                  value={currentVoice}
                  on:change={(e) => onVoiceChange(e.currentTarget.value)}
                >
                  <option value="">-- 请选择音色 --</option>
                  {#each presetVoices as voice (voice.value)}
                    <option value={voice.value}>{voice.label}</option>
                  {/each}
                </select>
              {/if}

              <span class="text-xs opacity-80 pt-2">请求方法</span>
              <select
                class="rounded bg-background-color border-b-2 border-gray-400/50 px-2 py-1 text-sm w-24"
                bind:value={$ttsCustomMethod$}
              >
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="GET">GET</option>
              </select>

              <span class="text-xs opacity-80 pt-2">端点 URL</span>
              <input
                type="text"
                class="rounded bg-background-color border-b-2 border-gray-400/50 px-2 py-1 text-sm"
                class:secret-masked={!revealCustomSecrets}
                placeholder="https://api.openai.com/v1/audio/speech"
                bind:value={$ttsCustomEndpoint$}
              />

              <span class="text-xs opacity-80 pt-2">请求头（JSON）</span>
              <textarea
                class="rounded bg-background-color border-b-2 border-gray-400/50 px-2 py-1 text-xs font-mono"
                class:secret-masked={!revealCustomSecrets}
                rows="4"
                bind:value={$ttsCustomHeaders$}
              ></textarea>

              <span class="text-xs opacity-80 pt-2">请求体模板</span>
              <textarea
                class="rounded bg-background-color border-b-2 border-gray-400/50 px-2 py-1 text-xs font-mono"
                class:secret-masked={!revealCustomSecrets}
                rows="8"
                bind:value={$ttsCustomBody$}
              ></textarea>

              <span class="text-xs opacity-80 pt-2">音频路径</span>
              <input
                type="text"
                class="rounded bg-background-color border-b-2 border-gray-400/50 px-2 py-1 text-sm font-mono"
                placeholder="留空 = 响应是裸音频字节；JSON 里 base64 字段填 dot-path；JSON 里是音频 URL 填 url:dot-path"
                bind:value={$ttsCustomAudioPath$}
              />

              <span class="text-xs opacity-80 pt-2">代理 URL</span>
              <input
                type="text"
                class="rounded bg-background-color border-b-2 border-gray-400/50 px-2 py-1 text-sm font-mono"
                class:secret-masked={!revealCustomSecrets}
                placeholder="留空 = 不走代理；例 http://127.0.0.1:7890 或 socks5://127.0.0.1:7891"
                bind:value={$ttsCustomProxyUrl$}
              />
            </div>
          </SettingsItemGroup>
        </div>
      {/if}

    {/if}

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
              on:keyup={dummyFn}
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

    <!-- 旧 Reader 残留（不再使用） -->
    <div class="hidden">
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
            on:keyup={dummyFn}
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
            on:keyup={dummyFn}
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
    <SettingsItemGroup
      title={$t('settings.item.fontWeight')}
      tooltip={$t('settings.tip.fontWeight')}
    >
      <input
        type="number"
        placeholder="默认"
        class={inputClasses}
        step="100"
        min="100"
        max="1000"
        bind:value={fontWeight}
        on:change={() => {
          if (fontWeight === null) {
            return;
          }

          if (fontWeight < 100) {
            fontWeight = 100;
          } else if (fontWeight > 1000) {
            fontWeight = 1000;
          }
        }}
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
    <SettingsItemGroup
      title={$t('settings.item.paraIndent')}
      tooltip={$t('settings.tip.paraIndent')}
    >
      <input
        type="number"
        class={inputClasses}
        step=".5"
        min="0"
        bind:value={textIndentation}
        on:blur={() => {
          const newValue = Number.parseFloat(`${textIndentation ?? 0}`);

          if (isNaN(newValue) || newValue < 1) {
            textIndentation = 0;
          }
        }}
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

            if (isNaN(newValue) || newValue < 1) {
              textMarginValue = 0;
            }
          }}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup
      title={verticalMode ? $t('settings.item.readerPaddingH') : $t('settings.item.readerPaddingV')}
    >
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
    <SettingsItemGroup
      title={$t('settings.item.swipeThreshold')}
      tooltip={$t('settings.tip.swipeThreshold')}
    >
      <input
        type="number"
        step="1"
        min="10"
        class={inputClasses}
        bind:value={swipeThreshold}
        on:blur={() => {
          if (swipeThreshold < 10 || typeof swipeThreshold !== 'number') {
            swipeThreshold = 10;
          }
        }}
      />
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
            if (autoBookmarkTime < 1 || typeof autoBookmarkTime !== 'number') {
              autoBookmarkTime = 3;
            }
          }}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup title={$t('settings.item.writingDirection')}>
      <ButtonToggleGroup options={optionsForWritingMode} bind:selectedOptionId={writingMode} />
    </SettingsItemGroup>
    {#if verticalMode}
      <SettingsItemGroup
        title={$t('settings.item.enableKerning')}
        tooltip={$t('settings.tip.enableKerning')}
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableFontKerning} />
      </SettingsItemGroup>
      <SettingsItemGroup
        title={$t('settings.item.enableVpal')}
        tooltip={$t('settings.tip.enableVpal')}
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableFontVPAL} />
      </SettingsItemGroup>
      <SettingsItemGroup title={$t('settings.item.textOrientation')} tooltip={verticalTextOrientationTooltip}>
        <ButtonToggleGroup
          options={optionsForVerticalTextOrientation}
          bind:selectedOptionId={verticalTextOrientation}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup
      title={$t('settings.item.preferReaderStyle')}
      tooltip={$t('settings.tip.preferReaderStyle')}
    >
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={prioritizeReaderStyles}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t('settings.item.justify')}
      tooltip={$t('settings.tip.justify')}
    >
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={enableTextJustification}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t('settings.item.prettyWrap')}
      tooltip={$t('settings.tip.prettyWrap')}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableTextWrapPretty} />
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t('settings.item.paraSpacingMode')}
      tooltip={$t('settings.tip.paraSpacingMode')}
    >
      <ButtonToggleGroup
        options={optionsForTextMarginMode}
        bind:selectedOptionId={textMarginMode}
      />
    </SettingsItemGroup>
    {#if wakeLockSupported}
      <SettingsItemGroup
        title={$t('settings.item.keepAwake')}
        tooltip={$t('settings.tip.keepAwake')}
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={enableReaderWakeLock}
        />
      </SettingsItemGroup>
    {/if}
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
    <SettingsItemGroup title={$t('settings.item.disableWheelPageTurn')}>
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={disableWheelNavigation}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t('settings.item.confirmClose')}
      tooltip={$t('settings.tip.confirmClose')}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={confirmClose} />
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t('settings.item.manualOnlyBookmark')}
      tooltip={$t('settings.tip.manualOnlyBookmark')}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={manualBookmark} />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.autoBookmark')} tooltip={autoBookmarkTooltip}>
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={autoBookmark} />
    </SettingsItemGroup>
    {#if $lastBookHasImages$}
      <SettingsItemGroup
        title={$t('settings.item.blurImages')}
        tooltip={$t('settings.tip.blurImages')}
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={blurImage} />
      </SettingsItemGroup>
      {#if blurImage}
        <SettingsItemGroup
          title={$t('settings.item.blurScope')}
          tooltip="模糊范围：全部 / 仅封面外（保留封面，封底+正文图片都模糊）/ 不模糊"
        >
          <ButtonToggleGroup options={optionsForBlurMode} bind:selectedOptionId={blurImageMode} />
        </SettingsItemGroup>
      {/if}
    {/if}
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
              on:keyup={dummyFn}
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
      <SettingsItemGroup
        title={$t('settings.item.tapToTurnPage')}
        tooltip={$t('settings.tip.tapToTurnPage')}
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableTapEdgeToFlip} />
      </SettingsItemGroup>
      {#if !verticalMode}
        <SettingsItemGroup title={$t('settings.item.columnCount')} tooltip={$t('settings.tip.columnCount')}>
          <input type="number" class={inputClasses} step="1" min="0" bind:value={pageColumns} />
        </SettingsItemGroup>
      {/if}
    {/if}
    </div>
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
              {#each sapiVoices as voice (voice.id)}
                <option value={voice.id}>{voice.name} ({voice.language})</option>
              {/each}
            </select>
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
              {#each webVoices as voice (voice.voiceURI)}
                <option value={voice.voiceURI}>{voice.name} ({voice.lang})</option>
              {/each}
            </select>
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
    <SettingsItemGroup
      title={$t('settings.item.pdfOcrHint')}
      tooltip={$t('settings.tip.pdfOcrHint')}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={ocrPromptEnabled} />
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t('settings.item.clearOcrMemory')}
      tooltip={$t('settings.tip.clearOcrMemory')}
    >
      <button
        class="m-1 rounded-md border-2 border-gray-400 p-2"
        on:click={() => (ocrSkippedBooks = '')}
        disabled={!ocrSkippedBooks}
      >
        {$t('settings.button.clearOcrMemory', { n: ocrSkippedBooks ? ocrSkippedBooks.split(',').filter(Boolean).length : 0 })}
        <Ripple />
      </button>
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
