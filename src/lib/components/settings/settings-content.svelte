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
  import SettingsStorageSourceList from '$lib/components/settings/settings-storage-source-list.svelte';
  import SettingsSync from '$lib/components/settings/settings-sync.svelte';
  import SettingsDataPaths from '$lib/components/settings/settings-data-paths.svelte';
  import SettingsSectionHeader from '$lib/components/settings/settings-section-header.svelte';
  import SettingsUserFontDialog from '$lib/components/settings/settings-user-font-dialog.svelte';
  import { inputClasses } from '$lib/css-classes';
  import { BlurMode } from '$lib/data/blur-mode';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { LocalFont } from '$lib/data/fonts';
  import { FuriganaStyle } from '$lib/data/furigana-style';
  import { ImportHTMLFixMode } from '$lib/data/import-html-fix-mode';
  import { logger } from '$lib/data/logger';
  import { MergeMode } from '$lib/data/merge-mode';
  import { isAppDefault } from '$lib/data/storage/storage-source-manager';
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
    kokoroVoiceId$,
    ttsSapiVoiceId$,
    ttsShortcut$,
    ttsStartStrategy$,
    verticalCustomReadingPosition$
  } from '$lib/data/store';
  import { isTauri } from '$lib/data/env';
  import type { TextMarginMode } from '$lib/data/text-margin-mode';
  import {
    availableThemes as availableThemesMap,
    type ThemeOption
  } from '$lib/data/theme-option';
  import type { VerticalTextOrientation } from '$lib/data/vertical-text-orientation';
  import { ViewMode } from '$lib/data/view-mode';
  import type { WritingMode } from '$lib/data/writing-mode';
  import { secondsToMinutes } from '$lib/functions/statistic-util';
  import { dummyFn } from '$lib/functions/utils';
  import {
    ReplicationSaveBehavior,
    AutoReplicationType
  } from '$lib/functions/replication/replication-options';
  import { map } from 'rxjs';
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

  interface CustomPreset {
    label: string;
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

  const CUSTOM_PRESETS: Record<string, CustomPreset> = {
    siliconflow: {
      label: '★ 硅基流动 SiliconFlow（国内直连，按字符付费）',
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
      label: 'Aliyun DashScope Qwen3-TTS-Flash（国内直连，URL 抽取）',
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
    mimo: {
      label: 'MiMo-V2.5-TTS（小米，限时免费）',
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
      helpHint: '小米 MiMo TTS，限时免费阶段'
    },
    volcengine: {
      label: '火山引擎 大模型 TTS（按字符付费）',
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
      label: '★ Google Cloud TTS（每月 100 万字符免费，性价比之王）',
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
      label: 'Gemini 2.5 Flash TTS（实验）',
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
      label: 'OpenAI TTS（适合英语）',
      method: 'POST',
      endpoint: 'https://api.openai.com/v1/audio/speech',
      headers: JSON.stringify(
        { 'Content-Type': 'application/json', Authorization: 'Bearer YOUR_API_KEY' },
        null,
        2
      ),
      body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input: '{text}' }, null, 2),
      voices: [
        { value: 'alloy', label: 'Alloy' },
        { value: 'echo', label: 'Echo' },
        { value: 'fable', label: 'Fable' },
        { value: 'onyx', label: 'Onyx' },
        { value: 'nova', label: 'Nova' },
        { value: 'shimmer', label: 'Shimmer' }
      ],
      voicePath: 'voice',
      helpUrl: 'https://platform.openai.com/api-keys',
      helpHint: '需绑卡按字符计费；中文质量一般，英语优秀'
    },
    azure: {
      label: 'Azure Speech（中文质量好但配置繁琐）',
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
      label: 'ElevenLabs（仅英语推荐）',
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
    manual: {
      label: '手动配置（自由接入）',
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
  const previewText = '这是语音测试。床前明月光，疑是地上霜。';

  async function kokoroEnsureLoad() {
    try {
      const { ensureKokoroLoaded } = await import('$lib/components/book-reader/auto-reader-kokoro');
      await ensureKokoroLoaded();
    } catch {
      /* error already surfaced via kokoroLoadStatus$ */
    }
  }

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
        previewMessage = 'Web Speech 播放失败';
      };
      window.speechSynthesis.speak(utt);
      return;
    }

    if ($ttsEngine$ === 'kokoro') {
      if (!$kokoroAccepted$) {
        previewState = 'error';
        previewMessage = '请先点「下载并启用」拉取 Kokoro 模型';
        return;
      }
      previewState = 'loading';
      try {
        const { ensureKokoroLoaded } = await import('$lib/components/book-reader/auto-reader-kokoro');
        await ensureKokoroLoaded();
        const mod = await import('kokoro-js');
        const KokoroTTS = (mod as any).KokoroTTS;
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
          previewMessage = '音频播放失败';
          URL.revokeObjectURL(url);
        };
        previewState = 'playing';
        await previewAudio.play();
      } catch (err: any) {
        previewState = 'error';
        previewMessage = `Kokoro 合成失败: ${err?.message || err}`;
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
          previewMessage = '音频播放失败';
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
          previewMessage = `请求头不是合法 JSON: ${err.message}`;
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
          previewMessage = '音频播放失败';
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

  async function resetUiSettings() {
    if (
      typeof window === 'undefined' ||
      !confirm(
        '将清除本地保存的 UI 设置（主题、字体、自定义快捷键、TTS 引擎选项等），书库与统计数据保留。应用会自动重启。\n\n继续吗？'
      )
    ) {
      return;
    }
    if (isTauri()) {
      // Desktop: schedule a Local Storage wipe in Rust and restart, so it
      // works even when stale UI state would otherwise block the page.
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('schedule_ui_reset');
        return;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[reset] schedule failed, falling back to in-page clear:', err);
      }
    }
    // Browser fallback / desktop degraded path
    const toClear: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) toClear.push(k);
    }
    toClear.forEach((k) => localStorage.removeItem(k));
    window.location.reload();
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

  const optionsForFuriganaStyle: ToggleOption<FuriganaStyle>[] = [
    {
      id: FuriganaStyle.Hide,
      text: '隐藏'
    },
    {
      id: FuriganaStyle.Partial,
      text: '部分'
    },
    {
      id: FuriganaStyle.Toggle,
      text: '点击切换'
    },
    {
      id: FuriganaStyle.Full,
      text: '完整'
    }
  ];

  const optionsForWritingMode: ToggleOption<WritingMode>[] = [
    {
      id: 'horizontal-tb',
      text: '横排'
    },
    {
      id: 'vertical-rl',
      text: '竖排'
    }
  ];

  const optionsForVerticalTextOrientation: ToggleOption<VerticalTextOrientation>[] = [
    {
      id: 'mixed',
      text: '混合'
    },
    {
      id: 'upright',
      text: '正立'
    }
  ];

  const optionsForTextMarginMode: ToggleOption<TextMarginMode>[] = [
    {
      id: 'auto',
      text: '自动'
    },
    {
      id: 'manual',
      text: '手动'
    }
  ];

  const optionsForViewMode: ToggleOption<ViewMode>[] = [
    {
      id: ViewMode.Continuous,
      text: '滚动'
    },
    {
      id: ViewMode.Paginated,
      text: '分页'
    }
  ];

  const optionsForBlurMode: ToggleOption<BlurMode>[] = [
    {
      id: BlurMode.ALL,
      text: '全部'
    },
    {
      id: BlurMode.AFTER_TOC,
      text: '封面外'
    },
    {
      id: BlurMode.NONE,
      text: '不模糊'
    }
  ];

  const optionsForImportHTMLFixes: ToggleOption<ImportHTMLFixMode>[] = [
    {
      id: ImportHTMLFixMode.OFF,
      text: 'Off'
    },
    {
      id: ImportHTMLFixMode.STANDARD,
      text: '标准'
    },
    {
      id: ImportHTMLFixMode.EXTENDED,
      text: '扩展'
    }
  ];

  const optionsForAutoReplicationType: ToggleOption<AutoReplicationType>[] = [
    {
      id: AutoReplicationType.Off,
      text: 'Off'
    },
    {
      id: AutoReplicationType.Up,
      text: '上传'
    },
    {
      id: AutoReplicationType.Down,
      text: '下载'
    },
    {
      id: AutoReplicationType.All,
      text: '双向'
    }
  ];

  const optionsForReplicationSaveBehavior: ToggleOption<ReplicationSaveBehavior>[] = [
    {
      id: ReplicationSaveBehavior.NewOnly,
      text: '仅新增'
    },
    {
      id: ReplicationSaveBehavior.Overwrite,
      text: '覆盖'
    }
  ];

  const optionsForTrackerAutoPause: ToggleOption<TrackerAutoPause>[] = [
    {
      id: TrackerAutoPause.OFF,
      text: 'Off'
    },
    {
      id: TrackerAutoPause.MODERATE,
      text: '适度'
    },
    {
      id: TrackerAutoPause.STRICT,
      text: '严格'
    }
  ];

  const optionsForTrackerSkipThresholdAction: ToggleOption<TrackerSkipThresholdAction>[] = [
    {
      id: TrackerSkipThresholdAction.IGNORE,
      text: '忽略'
    },
    {
      id: TrackerSkipThresholdAction.PAUSE,
      text: '暂停统计'
    }
  ];

  const optionsForMergeMode: ToggleOption<MergeMode>[] = [
    {
      id: MergeMode.MERGE,
      text: '合并'
    },
    {
      id: MergeMode.REPLACE,
      text: '覆盖'
    }
  ];

  const storageSources$ = database.storageSourcesChanged$.pipe(
    map((storageSources) =>
      storageSources.filter((storageSource) => !isAppDefault(storageSource.name))
    )
  );

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
      ? '横向文字字符顺时针旋转 90°'
      : '横向文字字符正立排版，竖向字符也正立显示。';
  $: autoBookmarkTooltip = `开启后，超过 ${autoBookmarkTime} 秒未滚动/翻页将自动加书签`;
  $: wakeLockSupported = browser && 'wakeLock' in navigator;
  $: verticalMode = writingMode === 'vertical-rl';
  $: fontCacheSupported = browser && 'caches' in window;
  $: switch (furiganaStyle) {
    case FuriganaStyle.Hide:
      furiganaStyleTooltip = '始终隐藏';
      break;
    case FuriganaStyle.Toggle:
      furiganaStyleTooltip = '默认隐藏，点击可切换显示';
      break;
    case FuriganaStyle.Full:
      furiganaStyleTooltip = '默认隐藏，悬停或点击时显示';
      break;
    default:
      furiganaStyleTooltip = '以灰色显示振假名';
      break;
  }
  $: avoidPageBreakTooltip = avoidPageBreak
    ? '避免单词/句子被拆分到不同页面'
    : '允许单词/句子在分页处被拆分';
  $: persistentStorageTooltip = persistentStorage
    ? '阅读器使用更高的本地存储配额'
    : '使用较低的临时存储配额。\n启用可能需要书签或通知权限';
  $: switch (importHTMLFixMode) {
    case ImportHTMLFixMode.OFF:
      importHTMLFixModeTooltip = '原样导入 EPUB 文件';
      break;
    case ImportHTMLFixMode.EXTENDED:
      importHTMLFixModeTooltip = '对 EPUB 导入应用更多修正：去除控制字符、替换 HTML 实体等';
      break;
    default:
      importHTMLFixModeTooltip = '对 EPUB 导入做基础修正：错误的自闭合标签等';
      break;
  }
  $: cacheStorageDataTooltip = cacheStorageData
    ? '缓存存储数据。可省网络流量与延迟，但读取最新数据需刷新或新开标签'
    : '每次操作都重新拉取数据。流量与延迟较高，但保证数据最新';
  $: replicationSaveBehaviorTooltip =
    replicationSaveBehavior === ReplicationSaveBehavior.Overwrite
      ? '总是覆盖目标数据'
      : '仅当目标无数据、无时间戳或目标数据更旧时才写入';
  $: switch (autoReplication) {
    case AutoReplicationType.Up:
      autoReplicationTypeTooltip = '阅读时每分钟将更新数据导出到同步目标';
      break;
    case AutoReplicationType.Down:
      autoReplicationTypeTooltip = '打开书时从同步目标导入数据';
      break;
    case AutoReplicationType.All:
      autoReplicationTypeTooltip = '双向同步';
      break;
    default:
      autoReplicationTypeTooltip = '关闭自动导入/导出';
      break;
  }
  $: showExternalPlaceholderToolTip = showExternalPlaceholder
    ? '在浏览器源管理器中显示外部书籍的占位数据'
    : '隐藏外部书籍的占位数据';

  $: startOfDayHours = `${`${startDayHoursForTracker}`.padStart(2, '0')}:00`;

  $: trackerIdleTimeInMin = secondsToMinutes(trackerIdleTime);

  $: switch (trackerAutoPause) {
    case TrackerAutoPause.OFF:
      trackerAutoPauseTooltip = '除特定阅读事件外，统计不会自动暂停';
      break;
    case TrackerAutoPause.STRICT:
      trackerAutoPauseTooltip = '阅读事件或任何站点失焦（如词典弹窗）时统计都会自动暂停';
      break;
    default:
      trackerAutoPauseTooltip = '阅读事件或阅读标签失焦时统计自动暂停';
      break;
  }

  $: if ((activeSettings === 'Data' || activeSettings === 'Statistics') && !$storageSources$) {
    database
      .getStorageSources()
      .then((storageSources) => {
        database.storageSourcesChanged$.next(storageSources);
      })
      .catch((error) => {
        logger.error(`Failed to retrieve storage sources: ${error.message}`);
        database.storageSourcesChanged$.next([]);
      });
  }
</script>

<div class="grid grid-cols-1 items-center sm:grid-cols-2 sm:gap-6 lg:md:gap-8 lg:grid-cols-3">
  {#if activeSettings === 'Appearance'}
    <div class="lg:col-span-3">
      <SettingsItemGroup title="主题">
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

    <SettingsSectionHeader title="字体与排版" />
    <SettingsItemGroup title="字体（组 1）">
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
    <SettingsItemGroup title="字体（组 2）">
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
    <SettingsItemGroup title="字号">
      <input type="number" class={inputClasses} step="1" min="1" bind:value={fontSize} />
    </SettingsItemGroup>
    <SettingsItemGroup title="行高">
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
    <SettingsItemGroup title="字重" tooltip={'设置字重，留空使用默认'}>
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
    <SettingsSectionHeader title="段落与行" />
    <SettingsItemGroup title="段落首行缩进" tooltip="段落首行缩进（rem）">
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
    <SettingsItemGroup title="段落间距模式" tooltip={'切到手动模式可指定段落间距值'}>
      <ButtonToggleGroup
        options={optionsForTextMarginMode}
        bind:selectedOptionId={textMarginMode}
      />
    </SettingsItemGroup>
    {#if textMarginMode === 'manual'}
      <SettingsItemGroup title="段落间距" tooltip="段落间距（rem）">
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
    <SettingsItemGroup title="两端对齐" tooltip={'开启后两端对齐段落文字'}>
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={enableTextJustification}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title="美化换行" tooltip={'在支持的浏览器中启用 pretty 换行样式'}>
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableTextWrapPretty} />
    </SettingsItemGroup>
    <SettingsItemGroup title="排版方向">
      <ButtonToggleGroup options={optionsForWritingMode} bind:selectedOptionId={writingMode} />
    </SettingsItemGroup>
    {#if verticalMode}
      <SettingsItemGroup title="启用字距调整" tooltip={'在字体与浏览器支持时，竖排间距视觉更平衡'}>
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableFontKerning} />
      </SettingsItemGroup>
      <SettingsItemGroup title="启用 VPAL" tooltip={'在字体与浏览器支持时，竖排文字间距更自然'}>
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableFontVPAL} />
      </SettingsItemGroup>
      <SettingsItemGroup title="文字方向" tooltip={verticalTextOrientationTooltip}>
        <ButtonToggleGroup
          options={optionsForVerticalTextOrientation}
          bind:selectedOptionId={verticalTextOrientation}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsSectionHeader title="日文振假名" />
    <SettingsItemGroup title="隐藏振假名">
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={hideFurigana} />
    </SettingsItemGroup>
    {#if hideFurigana}
      <SettingsItemGroup title="振假名样式" tooltip={furiganaStyleTooltip}>
        <ButtonToggleGroup
          options={optionsForFuriganaStyle}
          bind:selectedOptionId={furiganaStyle}
        />
      </SettingsItemGroup>
    {/if}
  {:else if activeSettings === 'Reader'}
    <SettingsSectionHeader title="阅读视图模式" hint="决定可用的播放方式：滚动 = 打字机自动播放；分页 = TTS 朗读 + 自动翻页" />
    <div class="h-full">
      <SettingsItemGroup title="阅读视图">
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
            tooltip="开源神经网络 TTS，82M 参数，ONNX 模型约 80MB。首次启用会从 Hugging Face 下载到本机缓存（IndexedDB），之后完全离线。中文音色不少（zf_xiaobei / zm_yunjian 等），效果接近商用云端 TTS。"
          >
            <div class="space-y-3 text-sm">
              {#if !$kokoroAccepted$}
                <div class="rounded-md border border-current/20 p-3 text-xs leading-relaxed">
                  <p>启用 Kokoro 需要下载约 <strong>80 MB</strong> 模型文件（首次启用，之后离线）。</p>
                  <p class="mt-1 opacity-70">模型来自 Hugging Face <code>onnx-community/Kokoro-82M-v1.0-ONNX</code>。下载后用 IndexedDB 缓存，不上传任何阅读内容。</p>
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
              {:else if $kokoroLoadStatus$.phase === 'errored'}
                <p class="text-red-500 text-xs">下载失败：{$kokoroLoadStatus$.message}</p>
                <button
                  class="settings-input px-3 py-1 text-sm"
                  on:click={() => kokoroEnsureLoad()}
                >重试</button>
              {/if}

              {#if $kokoroAccepted$}
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-xs opacity-70">音色</span>
                  <select
                    class="settings-input px-2 py-1 text-sm max-w-xs"
                    bind:value={$kokoroVoiceId$}
                  >
                    <optgroup label="英语 美式 女声">
                      <option value="af_heart">af_heart</option>
                      <option value="af_alloy">af_alloy</option>
                      <option value="af_aoede">af_aoede</option>
                      <option value="af_bella">af_bella</option>
                      <option value="af_jessica">af_jessica</option>
                      <option value="af_kore">af_kore</option>
                      <option value="af_nicole">af_nicole</option>
                      <option value="af_nova">af_nova</option>
                      <option value="af_river">af_river</option>
                      <option value="af_sarah">af_sarah</option>
                      <option value="af_sky">af_sky</option>
                    </optgroup>
                    <optgroup label="英语 美式 男声">
                      <option value="am_adam">am_adam</option>
                      <option value="am_echo">am_echo</option>
                      <option value="am_eric">am_eric</option>
                      <option value="am_fenrir">am_fenrir</option>
                      <option value="am_liam">am_liam</option>
                      <option value="am_michael">am_michael</option>
                      <option value="am_onyx">am_onyx</option>
                      <option value="am_puck">am_puck</option>
                      <option value="am_santa">am_santa</option>
                    </optgroup>
                    <optgroup label="英语 英式 女声">
                      <option value="bf_emma">bf_emma</option>
                      <option value="bf_isabella">bf_isabella</option>
                      <option value="bf_alice">bf_alice</option>
                      <option value="bf_lily">bf_lily</option>
                    </optgroup>
                    <optgroup label="英语 英式 男声">
                      <option value="bm_george">bm_george</option>
                      <option value="bm_lewis">bm_lewis</option>
                      <option value="bm_daniel">bm_daniel</option>
                      <option value="bm_fable">bm_fable</option>
                    </optgroup>
                  </select>
                </div>
                <p class="text-xs opacity-60">
                  注：kokoro-js v1.0 ONNX 当前只打包了**英语**音色（美式 + 英式），中文 / 日语版本需等上游更新或换用「自定义 HTTP TTS」接 Qwen3-TTS / CosyVoice 2 等中文模型。
                </p>
                <p class="text-xs opacity-60">缓存在 WebView2 IndexedDB；要清除模型走「设置 → 数据 → 清除全部本地数据」</p>
              {/if}
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
              <p class="text-sm opacity-60">未检测到可用语音</p>
            {:else}
              <select
                class="rounded bg-background-color border-b-2 border-gray-400/50 px-2 py-1 text-sm max-w-xs"
                bind:value={$ttsSapiVoiceId$}
              >
                <option value="">系统默认</option>
                {#each sapiVoices as voice (voice.id)}
                  <option value={voice.id}>{voice.name} ({voice.language})</option>
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
                  {#each Object.entries(CUSTOM_PRESETS) as [id, preset] (id)}
                    <option value={id}>{preset.label}</option>
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
    <SettingsSectionHeader title={viewMode === ViewMode.Continuous ? '滚动模式行为' : '分页模式行为'} hint={viewMode === ViewMode.Continuous ? '自定义阅读点、窗口变化时的定位行为' : '翻页触发方式、分栏、滑动阈值'} />
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
      <SettingsItemGroup title="窗口变化时自动定位">
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={autoPositionOnResize}
        />
      </SettingsItemGroup>
    {:else}
      <SettingsItemGroup title="避免分页打断" tooltip={avoidPageBreakTooltip}>
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
      <SettingsItemGroup title="点击翻页" tooltip="在两侧保留小边缘区域，点击可翻页">
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableTapEdgeToFlip} />
      </SettingsItemGroup>
      {#if !verticalMode}
        <SettingsItemGroup title="分栏数" tooltip="渲染的文本栏数">
          <input type="number" class={inputClasses} step="1" min="0" bind:value={pageColumns} />
        </SettingsItemGroup>
      {/if}
      <SettingsItemGroup title="滑动阈值" tooltip={'触发翻页所需的滑动距离'}>
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
      <SettingsItemGroup title="禁用滚轮翻页">
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={disableWheelNavigation}
        />
      </SettingsItemGroup>
    {/if}

    <SettingsSectionHeader title="阅读区尺寸" hint="阅读区边距和最大宽/高度" />
    <SettingsItemGroup title={verticalMode ? '阅读区左右边距' : '阅读区上下边距'}>
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
    <SettingsItemGroup title={verticalMode ? '阅读区最大高度' : '阅读区最大宽度'}>
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

    <SettingsSectionHeader title="书签" hint="自动书签触发条件与离开行为" />
    <SettingsItemGroup title="自动书签" tooltip={autoBookmarkTooltip}>
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={autoBookmark} />
    </SettingsItemGroup>
    {#if autoBookmark}
      <SettingsItemGroup title="自动书签延时" tooltip={'触发自动书签的秒数'}>
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
      title="仅手动书签"
      tooltip={'开启后，通过菜单离开阅读器时不会将当前位置加为书签'}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={manualBookmark} />
    </SettingsItemGroup>

    <SettingsSectionHeader title="页脚显示" hint="阅读器底部状态栏显示哪些字段" />
    <SettingsItemGroup title="显示字数">
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={showCharacterCounter} />
    </SettingsItemGroup>
    <SettingsItemGroup title="显示百分比">
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={showPercentage} />
    </SettingsItemGroup>
    <SettingsItemGroup title="页脚显示章节字数">
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={showFooterChapterCharacterCounter}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title="页脚显示章节百分比">
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={showFooterChapterPercentage}
      />
    </SettingsItemGroup>

    <SettingsSectionHeader title="图片与阅读点" hint="插图模糊、自定义阅读点暂停统计" />
    {#if $lastBookHasImages$}
      <SettingsItemGroup
        title="图片模糊"
        tooltip="对包含插图的电子书（如轻小说）有效，可避免剧透图直接显示"
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={blurImage} />
      </SettingsItemGroup>
      {#if blurImage}
        <SettingsItemGroup title="模糊范围" tooltip="模糊范围：全部 / 仅封面外（保留封面，封底+正文图片都模糊）/ 不模糊">
          <ButtonToggleGroup options={optionsForBlurMode} bind:selectedOptionId={blurImageMode} />
        </SettingsItemGroup>
      {/if}
    {/if}
    {#if statisticsEnabled}
      <SettingsItemGroup
        title="自定义阅读点暂停统计"
        tooltip={'开启后，设置自定义阅读点时统计会自动暂停/恢复'}
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={pauseTrackerOnCustomPointChange}
        />
      </SettingsItemGroup>
    {/if}

    <SettingsSectionHeader title="其他" hint="屏幕常亮、关闭确认等杂项开关" />
    {#if wakeLockSupported}
      <SettingsItemGroup
        title="屏幕常亮"
        tooltip={'开启后请求屏幕常亮（WakeLock），防止屏幕变暗或锁屏'}
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableReaderWakeLock} />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup
      title="关闭确认"
      tooltip={'开启后，存在未保存改动时关闭/刷新阅读器标签前会确认'}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={confirmClose} />
    </SettingsItemGroup>
    <SettingsItemGroup
      title="优先阅读器样式"
      tooltip={'开启后，对边距/对齐等规则添加 !important，与书内样式冲突时更易生效'}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={prioritizeReaderStyles} />
    </SettingsItemGroup>

    <!-- 旧 Reader 残留（不再使用） -->
    <div class="hidden">
    <SettingsItemGroup title="字体（组 1）">
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
    <SettingsItemGroup title="字体（组 2）">
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
      title="字重"
      tooltip={'设置字重，留空使用默认'}
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
    <SettingsItemGroup title="字号">
      <input type="number" class={inputClasses} step="1" min="1" bind:value={fontSize} />
    </SettingsItemGroup>
    <SettingsItemGroup title="行高">
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
      title="段落首行缩进"
      tooltip="段落首行缩进（rem）"
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
      <SettingsItemGroup title="段落间距" tooltip="段落间距（rem）">
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
      title={verticalMode ? '阅读区左右边距' : '阅读区上下边距'}
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
    <SettingsItemGroup title={verticalMode ? '阅读区最大高度' : '阅读区最大宽度'}>
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
      title="滑动阈值"
      tooltip={'触发翻页所需的滑动距离'}
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
      <SettingsItemGroup title="自动书签延时" tooltip={'触发自动书签的秒数'}>
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
    <SettingsItemGroup title="排版方向">
      <ButtonToggleGroup options={optionsForWritingMode} bind:selectedOptionId={writingMode} />
    </SettingsItemGroup>
    {#if verticalMode}
      <SettingsItemGroup
        title="启用字距调整"
        tooltip={'在字体与浏览器支持时，竖排间距视觉更平衡'}
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableFontKerning} />
      </SettingsItemGroup>
      <SettingsItemGroup
        title="启用 VPAL"
        tooltip={'在字体与浏览器支持时，竖排文字间距更自然'}
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableFontVPAL} />
      </SettingsItemGroup>
      <SettingsItemGroup title="文字方向" tooltip={verticalTextOrientationTooltip}>
        <ButtonToggleGroup
          options={optionsForVerticalTextOrientation}
          bind:selectedOptionId={verticalTextOrientation}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup
      title="优先阅读器样式"
      tooltip={'开启后，对边距/对齐等规则添加 !important，与书内样式冲突时更易生效'}
    >
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={prioritizeReaderStyles}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      title="两端对齐"
      tooltip={'开启后两端对齐段落文字'}
    >
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={enableTextJustification}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      title="美化换行"
      tooltip={'在支持的浏览器中启用 pretty 换行样式'}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableTextWrapPretty} />
    </SettingsItemGroup>
    <SettingsItemGroup
      title="段落间距模式"
      tooltip={'切到手动模式可指定段落间距值'}
    >
      <ButtonToggleGroup
        options={optionsForTextMarginMode}
        bind:selectedOptionId={textMarginMode}
      />
    </SettingsItemGroup>
    {#if wakeLockSupported}
      <SettingsItemGroup
        title="屏幕常亮"
        tooltip={'开启后请求屏幕常亮（WakeLock），防止屏幕变暗或锁屏'}
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={enableReaderWakeLock}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup title="显示字数">
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={showCharacterCounter} />
    </SettingsItemGroup>
    <SettingsItemGroup title="显示百分比">
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={showPercentage} />
    </SettingsItemGroup>
    <SettingsItemGroup title="页脚显示章节字数">
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={showFooterChapterCharacterCounter}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title="页脚显示章节百分比">
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={showFooterChapterPercentage}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title="禁用滚轮翻页">
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={disableWheelNavigation}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      title="关闭确认"
      tooltip={'开启后，存在未保存改动时关闭/刷新阅读器标签前会确认'}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={confirmClose} />
    </SettingsItemGroup>
    <SettingsItemGroup
      title="仅手动书签"
      tooltip={'开启后，通过菜单离开阅读器时不会将当前位置加为书签'}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={manualBookmark} />
    </SettingsItemGroup>
    <SettingsItemGroup title="自动书签" tooltip={autoBookmarkTooltip}>
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={autoBookmark} />
    </SettingsItemGroup>
    {#if $lastBookHasImages$}
      <SettingsItemGroup
        title="图片模糊"
        tooltip="对包含插图的电子书（如轻小说）有效，可避免剧透图直接显示"
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={blurImage} />
      </SettingsItemGroup>
      {#if blurImage}
        <SettingsItemGroup
          title="模糊范围"
          tooltip="模糊范围：全部 / 仅封面外（保留封面，封底+正文图片都模糊）/ 不模糊"
        >
          <ButtonToggleGroup options={optionsForBlurMode} bind:selectedOptionId={blurImageMode} />
        </SettingsItemGroup>
      {/if}
    {/if}
    <SettingsItemGroup title="隐藏振假名">
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={hideFurigana} />
    </SettingsItemGroup>
    {#if hideFurigana}
      <SettingsItemGroup title="振假名样式" tooltip={furiganaStyleTooltip}>
        <ButtonToggleGroup
          options={optionsForFuriganaStyle}
          bind:selectedOptionId={furiganaStyle}
        />
      </SettingsItemGroup>
    {/if}
    {#if statisticsEnabled}
      <SettingsItemGroup
        title="自定义阅读点暂停统计"
        tooltip={'开启后，设置自定义阅读点时统计会自动暂停/恢复'}
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
      <SettingsItemGroup title="窗口变化时自动定位">
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={autoPositionOnResize}
        />
      </SettingsItemGroup>
    {:else}
      <SettingsItemGroup title="避免分页打断" tooltip={avoidPageBreakTooltip}>
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
        title="点击翻页"
        tooltip="在两侧保留小边缘区域，点击可翻页"
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableTapEdgeToFlip} />
      </SettingsItemGroup>
      {#if !verticalMode}
        <SettingsItemGroup title="分栏数" tooltip="渲染的文本栏数">
          <input type="number" class={inputClasses} step="1" min="0" bind:value={pageColumns} />
        </SettingsItemGroup>
      {/if}
    {/if}
    </div>
    <!-- end legacy hidden block -->
  {:else if activeSettings === 'TTS'}
    <SettingsSectionHeader title="TTS 朗读" hint="自 1.11 起在滚动 + 分页两种模式下都可用。包含引擎、起点、快捷键和自定义 HTTP TTS" />
    <SettingsItemGroup
      title="朗读引擎"
      tooltip="Web Speech：浏览器内建，作兜底；SAPI：系统 TTS（仅桌面端 Windows）；Kokoro-82M：内置离线神经网络 TTS（v1.0 ONNX 当前只有英语），需首次下载约 80MB；自定义 HTTP TTS 可接 OpenAI / Gemini / Google Cloud / 自部署 Qwen3-TTS / CosyVoice 2 等任意服务。切换后请重开书生效。"
    >
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2 flex-wrap">
          <select
            class="settings-input px-2 py-1 text-sm max-w-[14rem] truncate"
            bind:value={$ttsEngine$}
          >
            <option value="web">Web Speech（浏览器）</option>
            <option value="sapi">系统 TTS（SAPI）</option>
            <option value="kokoro">Kokoro-82M（内置离线）</option>
            <option value="custom">自定义 HTTP TTS</option>
          </select>
          <button
            class="settings-input px-3 py-1 text-sm disabled:opacity-40"
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
        class="settings-input px-2 py-1 text-sm max-w-[12rem]"
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
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$ttsAutoAdvanceSection$} />
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
          class="settings-input px-3 py-1 text-sm"
          on:click={() => {
            recordingShortcut = false;
            ttsShortcut$.next('ctrl+alt+p');
          }}
        >重置<Ripple /></button>
        <button
          class="settings-input px-3 py-1 text-sm"
          on:click={() => {
            recordingShortcut = false;
            ttsShortcut$.next('');
          }}
        >禁用<Ripple /></button>
      </div>
    </SettingsItemGroup>

    {#if $ttsEngine$ === 'kokoro'}
      <div class="lg:col-span-3">
        <SettingsItemGroup
          title="Kokoro-82M 离线 TTS"
          tooltip="开源神经网络 TTS，82M 参数，ONNX 模型约 80MB。首次启用会从 Hugging Face 下载到本机缓存（IndexedDB），之后完全离线。v1.0 ONNX 当前只打包了英语音色。"
        >
          <div class="space-y-3 text-sm">
            {#if !$kokoroAccepted$}
              <div class="rounded-md border border-current/20 p-3 text-xs leading-relaxed">
                <p>启用 Kokoro 需要下载约 <strong>80 MB</strong> 模型文件（首次启用，之后离线）。</p>
                <p class="mt-1 opacity-70">模型来自 Hugging Face <code>onnx-community/Kokoro-82M-v1.0-ONNX</code>。下载后用 IndexedDB 缓存，不上传任何阅读内容。</p>
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
            {:else if $kokoroLoadStatus$.phase === 'errored'}
              <p class="text-red-500 text-xs">下载失败：{$kokoroLoadStatus$.message}</p>
              <button class="settings-input px-3 py-1 text-sm" on:click={() => kokoroEnsureLoad()}>重试</button>
            {/if}

            {#if $kokoroAccepted$}
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs opacity-70">音色</span>
                <select class="settings-input px-2 py-1 text-sm max-w-xs" bind:value={$kokoroVoiceId$}>
                  <optgroup label="英语 美式 女声">
                    <option value="af_heart">af_heart</option>
                    <option value="af_alloy">af_alloy</option>
                    <option value="af_aoede">af_aoede</option>
                    <option value="af_bella">af_bella</option>
                    <option value="af_jessica">af_jessica</option>
                    <option value="af_kore">af_kore</option>
                    <option value="af_nicole">af_nicole</option>
                    <option value="af_nova">af_nova</option>
                    <option value="af_river">af_river</option>
                    <option value="af_sarah">af_sarah</option>
                    <option value="af_sky">af_sky</option>
                  </optgroup>
                  <optgroup label="英语 美式 男声">
                    <option value="am_adam">am_adam</option>
                    <option value="am_echo">am_echo</option>
                    <option value="am_eric">am_eric</option>
                    <option value="am_fenrir">am_fenrir</option>
                    <option value="am_liam">am_liam</option>
                    <option value="am_michael">am_michael</option>
                    <option value="am_onyx">am_onyx</option>
                    <option value="am_puck">am_puck</option>
                    <option value="am_santa">am_santa</option>
                  </optgroup>
                  <optgroup label="英语 英式 女声">
                    <option value="bf_emma">bf_emma</option>
                    <option value="bf_isabella">bf_isabella</option>
                    <option value="bf_alice">bf_alice</option>
                    <option value="bf_lily">bf_lily</option>
                  </optgroup>
                  <optgroup label="英语 英式 男声">
                    <option value="bm_george">bm_george</option>
                    <option value="bm_lewis">bm_lewis</option>
                    <option value="bm_daniel">bm_daniel</option>
                    <option value="bm_fable">bm_fable</option>
                  </optgroup>
                </select>
              </div>
              <p class="text-xs opacity-60">
                注：kokoro-js v1.0 ONNX 当前只打包了**英语**音色，中文 / 日语需等上游更新或换用「自定义 HTTP TTS」接 Qwen3-TTS / CosyVoice 2。
              </p>
              <p class="text-xs opacity-60">缓存在 WebView2 IndexedDB；要清除模型走「设置 → 数据 → 清除全部本地数据」</p>
            {/if}
          </div>
        </SettingsItemGroup>
      </div>
    {/if}

    {#if $ttsEngine$ === 'sapi'}
      <div class="lg:col-span-3">
        <SettingsItemGroup
          title="系统 TTS 语音"
          tooltip="注：Windows 11 设置里的「Natural 自然语音」是 Narrator 专属，应用层（包括本 app）调不到。下面是系统暴露给应用的 SAPI 5 老音色，质量基础。"
        >
          {#if sapiVoicesError}
            <p class="text-red-500 text-sm">{sapiVoicesError}</p>
          {:else if !sapiVoices.length}
            <p class="text-sm opacity-60">未检测到可用语音</p>
          {:else}
            <select class="settings-input px-2 py-1 text-sm max-w-xs" bind:value={$ttsSapiVoiceId$}>
              <option value="">系统默认</option>
              {#each sapiVoices as voice (voice.id)}
                <option value={voice.id}>{voice.name} ({voice.language})</option>
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
          tooltip={'把任意 TTS API 接进来。{text} 会被替换为当前句子并 JSON 转义。响应是音频字节（OpenAI/ElevenLabs/Azure）「音频路径」留空；响应是 JSON 包 base64 音频（MiMo / Google Cloud / Gemini 等）则填出 base64 字段的 dot-path，如 choices.0.message.audio.data。'}
        >
          <p class="text-xs opacity-70 mb-2">
            提示：Google Cloud TTS（含 Chirp3-HD）每月前 100 万字符免费；Gemini TTS 按 token 计费、无免费额度。Chirp3-HD
            不支持 speakingRate / pitch / SSML，需要这些参数请切回 WaveNet / Neural2。代理 URL 仅影响本应用的 TTS
            请求。
          </p>
          {@const activePreset = CUSTOM_PRESETS[$ttsCustomActivePreset$] ?? CUSTOM_PRESETS.manual}
          <div class="grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-x-3 gap-y-2 items-start">
            <span class="text-xs opacity-80 pt-2">服务预设</span>
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center gap-2 flex-wrap">
                <select
                  class="settings-input px-2 py-1 text-sm"
                  value={$ttsCustomActivePreset$}
                  on:change={onPresetSelectChange}
                >
                  {#each Object.entries(CUSTOM_PRESETS) as [id, preset] (id)}
                    <option value={id}>{preset.label}</option>
                  {/each}
                </select>
                <button
                  class="settings-input px-2 py-1 text-xs"
                  title="把当前预设的字段重置为默认模板（不影响其他预设保存的 key）"
                  on:click={resetActivePresetToDefaults}
                >恢复模板<Ripple /></button>
                <button
                  class="settings-input px-2 py-1 text-xs"
                  on:click={() => (revealCustomSecrets = !revealCustomSecrets)}
                >{revealCustomSecrets ? '隐藏内容' : '显示内容'}<Ripple /></button>
                {#if activePreset.helpUrl}
                  <button
                    type="button"
                    class="settings-input px-2 py-1 text-xs"
                    on:click={() => openExternal(activePreset.helpUrl || '')}
                  >获取 API key ↗</button>
                {/if}
              </div>
              {#if activePreset.helpHint}
                <p class="text-xs opacity-65 leading-snug">{activePreset.helpHint}</p>
              {/if}
            </div>

            {#if presetVoices.length}
              <span class="text-xs opacity-80 pt-2">音色</span>
              <select
                class="settings-input px-2 py-1 text-sm"
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
            <select class="settings-input px-2 py-1 text-sm w-24" bind:value={$ttsCustomMethod$}>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="GET">GET</option>
            </select>

            <span class="text-xs opacity-80 pt-2">端点 URL</span>
            <input
              type="text"
              class="settings-input px-2 py-1 text-sm"
              class:secret-masked={!revealCustomSecrets}
              placeholder="https://api.openai.com/v1/audio/speech"
              bind:value={$ttsCustomEndpoint$}
            />

            <span class="text-xs opacity-80 pt-2">请求头（JSON）</span>
            <textarea
              class="settings-input px-2 py-1 text-xs font-mono"
              class:secret-masked={!revealCustomSecrets}
              rows="4"
              bind:value={$ttsCustomHeaders$}
            ></textarea>

            <span class="text-xs opacity-80 pt-2">请求体模板</span>
            <textarea
              class="settings-input px-2 py-1 text-xs font-mono"
              class:secret-masked={!revealCustomSecrets}
              rows="8"
              bind:value={$ttsCustomBody$}
            ></textarea>

            <span class="text-xs opacity-80 pt-2">音频路径</span>
            <input
              type="text"
              class="settings-input px-2 py-1 text-sm font-mono"
              placeholder="留空 = 响应是裸音频字节；JSON 里 base64 字段填 dot-path；JSON 里是音频 URL 填 url:dot-path"
              bind:value={$ttsCustomAudioPath$}
            />

            <span class="text-xs opacity-80 pt-2">代理 URL</span>
            <input
              type="text"
              class="settings-input px-2 py-1 text-sm font-mono"
              class:secret-masked={!revealCustomSecrets}
              placeholder="留空 = 不走代理；例 http://127.0.0.1:7890 或 socks5://127.0.0.1:7891"
              bind:value={$ttsCustomProxyUrl$}
            />
          </div>
        </SettingsItemGroup>
      </div>
    {/if}

  {:else if activeSettings === 'Data'}
    <SettingsSectionHeader title="存储与备份" hint="书库、设置、统计的物理位置与云端同步" />
    <div class="lg:col-span-3">
      <SettingsItemGroup title="跨设备同步阅读统计" tooltip="把每天的阅读时长同步到云端，桌面 + 手机 PWA 都能看到合并的数据">
        <SettingsSync />
      </SettingsItemGroup>
    </div>
    <div class="lg:col-span-3">
      <SettingsItemGroup title="本地数据位置" tooltip="查看书库、设置、同步副本各自的物理位置。提供一键打开和彻底清空。">
        <SettingsDataPaths />
      </SettingsItemGroup>
    </div>
    <SettingsItemGroup title="持久化存储" tooltip={persistentStorageTooltip}>
      <div class="flex items-center">
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={persistentStorage} />
        {#if storageQuota}
          <div class="ml-4">{storageQuota}</div>
        {/if}
      </div>
    </SettingsItemGroup>
    <SettingsItemGroup
      title="重置 UI 设置"
      tooltip="清除本地保存的所有界面设置（主题、字体、TTS 引擎、快捷键、自定义主题等），书库和阅读统计保留。从更早版本升级后界面表现异常时用这个，比手动卸载重装快。"
    >
      <button
        class="m-1 rounded-md border-2 border-gray-400 p-2 text-red-600"
        on:click={resetUiSettings}
      >
        重置并刷新
        <Ripple />
      </button>
    </SettingsItemGroup>

    <SettingsSectionHeader title="导入与导出" hint="格式修正、自动备份和外部存储行为" />
    <SettingsItemGroup title="EPUB 导入修正" tooltip={importHTMLFixModeTooltip}>
      <ButtonToggleGroup
        options={optionsForImportHTMLFixes}
        bind:selectedOptionId={importHTMLFixMode}
      />
    </SettingsItemGroup>
    {#if importHTMLFixMode !== ImportHTMLFixMode.OFF}
      <SettingsItemGroup
        title="仅限制链接"
        tooltip="仅对链接标签做自闭合修正"
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={restrictImportFixToAnchor}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup title="自动导入/导出" tooltip={autoReplicationTypeTooltip}>
      <ButtonToggleGroup
        options={optionsForAutoReplicationType}
        bind:selectedOptionId={autoReplication}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title="导入/导出策略" tooltip={replicationSaveBehaviorTooltip}>
      <ButtonToggleGroup
        options={optionsForReplicationSaveBehavior}
        bind:selectedOptionId={replicationSaveBehavior}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title="缓存数据" tooltip={cacheStorageDataTooltip}>
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={cacheStorageData} />
    </SettingsItemGroup>

    <SettingsSectionHeader title="阅读器行为" hint="外部书提示、OCR 提示等阅读界面相关开关" />
    <SettingsItemGroup
      title="隐藏来源提示"
      tooltip="打开外部存储源中的书时隐藏警告提示"
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={hideExternalReadHint} />
    </SettingsItemGroup>
    <SettingsItemGroup title="显示占位卡片" tooltip={showExternalPlaceholderToolTip}>
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={showExternalPlaceholder}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      title="扫描版 PDF 自动提示 OCR"
      tooltip="关闭后，所有扫描版 PDF 都只显示原图，顶部不再弹 OCR 提示条；想恢复对某本书的提示，点下面的「清空仅看原图记忆」"
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={ocrPromptEnabled} />
    </SettingsItemGroup>
    <SettingsItemGroup
      title="清空仅看原图记忆"
      tooltip="撤销在阅读器顶部 OCR 提示条上点过的「仅看原图」选择，让这些书重新弹出 OCR 提示"
    >
      <button
        class="m-1 rounded-md border-2 border-gray-400 p-2"
        on:click={() => (ocrSkippedBooks = '')}
        disabled={!ocrSkippedBooks}
      >
        清空（当前 {ocrSkippedBooks ? ocrSkippedBooks.split(',').filter(Boolean).length : 0} 本）
        <Ripple />
      </button>
    </SettingsItemGroup>

    <SettingsSectionHeader title="存储源与诊断" hint="外部存储源管理和故障排查导出" />
    <SettingsStorageSourceList storageSources={$storageSources$} />
    <SettingsItemGroup title="诊断日志" tooltip="导出包含设置与运行日志的诊断文件，反馈问题时附上能加快定位">
      <button
        class="m-1 rounded-md border-2 border-gray-400 p-2"
        on:click={() =>
          dialogManager.dialogs$.next([
            {
              component: LogReportDialog,
              props: {
                title: '诊断日志',
                message: '导出当前会话的设置与运行日志（JSON 文件）。'
              }
            }
          ])}
      >
        导出诊断日志
        <Ripple />
      </button>
    </SettingsItemGroup>
  {:else}
    <SettingsSectionHeader title="统计基础" hint="删除策略、完成判定与起始时刻" />
    <SettingsItemGroup
      title="删除时保留本地数据"
      tooltip={'删除本地书籍副本时是否同时删除本地统计'}
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
                      title: '错误',
                      message: `清除僵尸统计数据出错: ${message}`
                    }
                  }
                ])
              )
              .finally(() => (showSpinner = false));
          }}
          on:keyup={() => {}}
        >
          清除僵尸统计
        </div>
      </div>
    </SettingsItemGroup>
    <SettingsItemGroup
      title="覆盖书籍完成状态"
      tooltip={'是只记录首次完成，还是始终更新为最新一次完成'}
    >
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={overwriteBookCompletion}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      title={`每日起始小时: ${startOfDayHours}`}
      tooltip={'设定新一天的开始时间，此时刻之前的数据计入前一天'}
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
    <SettingsSectionHeader title="同步合并策略" hint="跨设备同步时如何合并统计与目标" />
    <SettingsItemGroup
      title="统计合并方式"
      tooltip={'同步时统计按条目合并还是整体覆盖'}
    >
      <ButtonToggleGroup
        options={optionsForMergeMode}
        bind:selectedOptionId={statisticsMergeMode}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      title="阅读目标合并方式"
      tooltip={'同步时阅读目标按条目合并还是整体覆盖'}
    >
      <ButtonToggleGroup
        options={optionsForMergeMode}
        bind:selectedOptionId={readingGoalsMergeMode}
      />
    </SettingsItemGroup>
    <SettingsSectionHeader title="追踪开关" hint="启用统计后才会出现下方的细化设置" />
    <SettingsItemGroup
      title="启用统计"
      tooltip="在阅读器左下角显示统计追踪图标，需手动点击开始记录会话"
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={statisticsEnabled} />
    </SettingsItemGroup>
    {#if statisticsEnabled}
      <SettingsSectionHeader title="追踪行为" hint="自动暂停、完成判定与字符差额处理" />
      <SettingsItemGroup title="统计自动暂停" tooltip={trackerAutoPauseTooltip}>
        <ButtonToggleGroup
          options={optionsForTrackerAutoPause}
          bind:selectedOptionId={trackerAutoPause}
        />
      </SettingsItemGroup>
      <SettingsItemGroup title="完成时打开统计">
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={openTrackerOnCompletion}
        />
      </SettingsItemGroup>
      <SettingsItemGroup
        title="完成时更新"
        tooltip={'当前位置与全书总字数之间的差额是否计入统计'}
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={addCharactersOnCompletion}
        />
      </SettingsItemGroup>
      <SettingsSectionHeader title="自动启停阈值" hint="字数 / 空闲时间触发自动启动与暂停" />
      <SettingsItemGroup
        title="自动启动统计 (秒)"
        tooltip={'字数无变化达到此秒数后统计将自动启动（0 = 关闭，建议设大些避免误触发）'}
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
        <SettingsReadingGoals
          storageSources={$storageSources$}
          on:spinner={({ detail }) => (showSpinner = detail)}
        />
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
