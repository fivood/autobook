/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Ready-made endpoint configs for the custom HTTP TTS engine. Each entry is
 * the full request shape (URL + headers + body template) for one provider, so
 * the user only has to paste an API key instead of reverse-engineering a
 * request. Pure data with no reactivity — it lives here rather than in
 * settings-content.svelte because 400+ lines of catalog was the single
 * biggest contributor to that file's size.
 *
 * Adding a provider: fill `body` with `{text}` where the sentence goes, and
 * set `audioPath` when the response wraps the audio in JSON (empty means the
 * body is raw audio bytes). `voicePath` + `voiceFormat` let the settings UI
 * swap the voice without the user hand-editing the body template.
 */

/** Grouping key for the preset dropdown — sorted by how "hands-off" the
 *  choice is (nothing to sign up for → free tier → paid → manual). */
export type PresetCategory = 'local' | 'cloudFree' | 'cloudPaid' | 'manual';

export interface CustomPreset {
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
  /** Dot-path to the free-text tone prompt inside the body JSON, for the few
   *  providers that take one (an `instructions` field, a `prompt` field, a chat
   *  message). Set it and the settings UI shows the reading-style dropdown. */
  stylePath?: string;
  /** How the voice value is embedded. JSON = replace field; xml = replace SSML name attribute; url = replace endpoint URL segment. */
  voiceFormat?: 'json' | 'xml' | 'url';
  /** Regex matching the part of the endpoint URL to replace when voiceFormat='url'. */
  voiceUrlPattern?: string;
  /** Direct link to the provider's API key console page. */
  helpUrl?: string;
  /** One-line plain-language hint shown under the preset row. */
  helpHint?: string;
}

export const PRESET_CATEGORY_LABEL: Record<PresetCategory, string> = {
  local: '本地免费（自建服务器，完全离线）',
  cloudFree: '云端免费 / 有免费额度',
  cloudPaid: '云端付费',
  manual: '手动配置'
};
export const PRESET_CATEGORY_ORDER: PresetCategory[] = ['local', 'cloudFree', 'cloudPaid', 'manual'];

export const CUSTOM_PRESETS: Record<string, CustomPreset> = {
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
    stylePath: 'messages.0.content',
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
    stylePath: 'input.prompt',
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
    stylePath: 'instructions',
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

/**
 * Reading-style prompts for the presets that expose `stylePath`. The value IS
 * the prompt sent to the model, so the body textarea stays the escape hatch —
 * pick the closest genre, then hand-edit if the book needs something else.
 * The first entry matches the default baked into those presets' templates.
 */
export const TTS_STYLE_PRESETS: { label: string; value: string }[] = [
  {
    label: '通用听书（默认）',
    value: '清晰、稳定、平和的朗读语气，适合长时间听书。'
  },
  {
    label: '小说 · 叙事',
    value:
      '像有声书演播者一样朗读：叙述沉稳自然，对白按人物身份切换语气，情绪随情节起伏，但不夸张。'
  },
  {
    label: '悬疑 · 恐怖',
    value:
      '压低声线，语速偏慢，句间留出停顿，营造紧张不安的氛围；关键处放轻，不要惊叫式的夸张。'
  },
  {
    label: '言情 · 治愈',
    value: '温柔亲近，语速偏慢，尾音略微上扬带一点笑意，像在耳边讲一个温暖的故事。'
  },
  {
    label: '武侠 · 玄幻 · 历史',
    value: '评书式的沉稳有力，咬字清楚，节奏张弛分明：叙事处铺陈从容，动作处收紧加快。'
  },
  {
    label: '科普 · 非虚构',
    value: '讲解式语气，像认真但轻松地给朋友解释；遇到定义和关键结论时放慢并加重。'
  },
  {
    label: '商业 · 自我提升',
    value: '清醒、笃定、有推进感，像播客主持人；重点句加重，避免煽情。'
  },
  {
    label: '儿童 · 童话',
    value: '活泼明亮，语速稍慢，夸张而有角色感，象声词和对白都演出来。'
  },
  {
    label: '诗歌 · 散文',
    value: '缓慢、克制，重视呼吸与停顿，按句读断句，让词句留有余韵，不要抒情过度。'
  },
  {
    label: '学术 · 教材',
    value: '中性精准，匀速平稳，不带情绪；专有名词、数字和公式咬字清楚，逗号处短停。'
  },
  {
    label: '剧本 · 多人对白',
    value: '把对白演出来：不同人物用不同语气和节奏，旁白保持中性，标点处自然换气。'
  },
  {
    label: '快速过书',
    value: '干脆利落，语速偏快，情绪平淡，只做必要断句，适合快速过一遍内容。'
  }
];
