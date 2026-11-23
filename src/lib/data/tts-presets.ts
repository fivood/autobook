/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Starting templates for the custom HTTP TTS engine. These are deliberately
 * request *shapes*, not providers: which AI voice services are reachable,
 * affordable or even legal differs by country, and a named-provider catalog
 * went stale faster than releases (prices, free tiers, voice ids). So each
 * entry is one common wire format with YOUR_* placeholders, and the user
 * fills in whatever service they actually have.
 *
 * Users who saved a config under one of the old provider ids (mimo, openai,
 * azure, ...) keep it — `ttsCustomPresetStates$` still holds it and the
 * settings UI lists it under "saved configs".
 *
 * Adding a template: put `{text}` where the sentence goes, and set
 * `audioPath` when the response wraps the audio in JSON (empty means the body
 * is raw audio bytes). `stylePath` points at a free-text tone prompt field and
 * turns on the reading-style dropdown.
 */

export type PresetCategory = 'local' | 'cloud' | 'manual';

export interface CustomPreset {
  /** i18n key of the option label. */
  labelKey: string;
  /** i18n key of the one-line hint shown under the picker. */
  hintKey: string;
  category: PresetCategory;
  method: string;
  endpoint: string;
  headers: string;
  body: string;
  audioPath?: string;
  proxyUrl?: string;
  /** Dot-path to the free-text tone prompt inside the body JSON. */
  stylePath?: string;
}

export const PRESET_CATEGORY_ORDER: PresetCategory[] = ['local', 'cloud', 'manual'];

const JSON_HEADERS = JSON.stringify({ 'Content-Type': 'application/json' }, null, 2);
const BEARER_HEADERS = JSON.stringify(
  { 'Content-Type': 'application/json', Authorization: 'Bearer YOUR_API_KEY' },
  null,
  2
);

export const CUSTOM_PRESETS: Record<string, CustomPreset> = {
  localOpenai: {
    labelKey: 'settings.ttsCustom.ex.localOpenai',
    hintKey: 'settings.ttsCustom.ex.localOpenaiHint',
    category: 'local',
    method: 'POST',
    endpoint: 'http://localhost:8880/v1/audio/speech',
    headers: JSON_HEADERS,
    body: JSON.stringify(
      { model: 'YOUR_MODEL', input: '{text}', voice: 'YOUR_VOICE', response_format: 'mp3' },
      null,
      2
    )
  },
  localSimple: {
    labelKey: 'settings.ttsCustom.ex.localSimple',
    hintKey: 'settings.ttsCustom.ex.localSimpleHint',
    category: 'local',
    method: 'POST',
    endpoint: 'http://localhost:5000/api/tts',
    headers: JSON_HEADERS,
    body: JSON.stringify({ text: '{text}' }, null, 2)
  },
  cloudOpenai: {
    labelKey: 'settings.ttsCustom.ex.cloudOpenai',
    hintKey: 'settings.ttsCustom.ex.cloudOpenaiHint',
    category: 'cloud',
    method: 'POST',
    endpoint: 'https://api.example.com/v1/audio/speech',
    headers: BEARER_HEADERS,
    body: JSON.stringify(
      {
        model: 'YOUR_MODEL',
        input: '{text}',
        voice: 'YOUR_VOICE',
        response_format: 'mp3',
        instructions: '清晰、稳定、平和的朗读语气，适合长时间听书。'
      },
      null,
      2
    ),
    stylePath: 'instructions'
  },
  cloudJsonAudio: {
    labelKey: 'settings.ttsCustom.ex.cloudJsonAudio',
    hintKey: 'settings.ttsCustom.ex.cloudJsonAudioHint',
    category: 'cloud',
    method: 'POST',
    endpoint: 'https://api.example.com/v1/tts',
    headers: BEARER_HEADERS,
    body: JSON.stringify({ text: '{text}', voice: 'YOUR_VOICE', format: 'mp3' }, null, 2),
    audioPath: 'data.audio'
  },
  manual: {
    labelKey: 'settings.ttsCustom.ex.manual',
    hintKey: 'settings.ttsCustom.ex.manualHint',
    category: 'manual',
    method: 'POST',
    endpoint: '',
    headers: JSON_HEADERS,
    body: '',
    audioPath: '',
    proxyUrl: ''
  }
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
