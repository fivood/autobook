/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Curated Edge TTS voice catalog: everything the free Read Aloud service
 * offers in Chinese, Japanese and Korean, plus the English voices worth
 * reading a book with.
 *
 * Only list voices the free service actually has. Azure's paid catalog is
 * much larger (晓辰、晓涵、云泽, 日语的葵/大地/真夕 …) and those names used to
 * be here too — the free endpoint does not serve them. Check against the live
 * list before adding one: speech.platform.bing.com/consumer/speech/synthesize/
 * readaloud/voices/list (needs the same Sec-MS-GEC token as synthesis; checked
 * 2026-10-13, 322 voices). The settings UI keeps an "自定义" box for anything
 * not listed here.
 */

export interface EdgeVoice {
  id: string;
  label: string;
  group: string;
}

const VOICES: EdgeVoice[] = [
  // 中文 · 大陆
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女 · 通用（推荐）', group: '中文 · 大陆' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女 · 活泼', group: '中文 · 大陆' },
  { id: 'zh-CN-YunxiNeural', label: '云希 · 男 · 阳光', group: '中文 · 大陆' },
  { id: 'zh-CN-YunyangNeural', label: '云扬 · 男 · 新闻播报', group: '中文 · 大陆' },
  { id: 'zh-CN-YunjianNeural', label: '云健 · 男 · 激昂', group: '中文 · 大陆' },
  { id: 'zh-CN-YunxiaNeural', label: '云夏 · 男童', group: '中文 · 大陆' },
  // 中文 · 方言
  { id: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北 · 女 · 东北', group: '中文 · 方言' },
  { id: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮 · 女 · 陕西', group: '中文 · 方言' },
  // 中文 · 港台
  { id: 'zh-HK-HiuMaanNeural', label: '曉曼 · 女 · 粵語', group: '中文 · 港台' },
  { id: 'zh-HK-HiuGaaiNeural', label: '曉佳 · 女 · 粵語', group: '中文 · 港台' },
  { id: 'zh-HK-WanLungNeural', label: '雲龍 · 男 · 粵語', group: '中文 · 港台' },
  { id: 'zh-TW-HsiaoChenNeural', label: '曉臻 · 女 · 台灣國語', group: '中文 · 港台' },
  { id: 'zh-TW-HsiaoYuNeural', label: '曉雨 · 女 · 台灣國語', group: '中文 · 港台' },
  { id: 'zh-TW-YunJheNeural', label: '雲哲 · 男 · 台灣國語', group: '中文 · 港台' },
  // 日语
  { id: 'ja-JP-NanamiNeural', label: '七海 · 女（推荐）', group: '日语' },
  { id: 'ja-JP-KeitaNeural', label: '圭太 · 男', group: '日语' },
  // 英语（多语音色首选，可讲中文）
  { id: 'en-US-EmmaMultilingualNeural', label: 'Emma · 女 · 多语', group: '英语（多语首选）' },
  { id: 'en-US-AvaMultilingualNeural', label: 'Ava · 女 · 多语', group: '英语（多语首选）' },
  { id: 'en-US-AndrewMultilingualNeural', label: 'Andrew · 男 · 多语', group: '英语（多语首选）' },
  { id: 'en-US-BrianMultilingualNeural', label: 'Brian · 男 · 多语', group: '英语（多语首选）' },
  // 英语 · 美式（单语）— 微软标注适合有声书的几位排在前面
  { id: 'en-US-ChristopherNeural', label: 'Christopher · 男 · 沉稳', group: '英语 · 美式' },
  { id: 'en-US-MichelleNeural', label: 'Michelle · 女 · 亲切', group: '英语 · 美式' },
  { id: 'en-US-EricNeural', label: 'Eric · 男 · 理性', group: '英语 · 美式' },
  { id: 'en-US-RogerNeural', label: 'Roger · 男 · 活泼', group: '英语 · 美式' },
  { id: 'en-US-SteffanNeural', label: 'Steffan · 男 · 理性', group: '英语 · 美式' },
  { id: 'en-US-JennyNeural', label: 'Jenny · 女', group: '英语 · 美式' },
  { id: 'en-US-AriaNeural', label: 'Aria · 女', group: '英语 · 美式' },
  { id: 'en-US-GuyNeural', label: 'Guy · 男', group: '英语 · 美式' },
  // 英语 · 英式
  { id: 'en-GB-SoniaNeural', label: 'Sonia · 女', group: '英语 · 英式' },
  { id: 'en-GB-LibbyNeural', label: 'Libby · 女', group: '英语 · 英式' },
  { id: 'en-GB-MaisieNeural', label: 'Maisie · 女童', group: '英语 · 英式' },
  { id: 'en-GB-RyanNeural', label: 'Ryan · 男', group: '英语 · 英式' },
  { id: 'en-GB-ThomasNeural', label: 'Thomas · 男', group: '英语 · 英式' },
  // 韩语
  { id: 'ko-KR-SunHiNeural', label: 'SunHi · 女', group: '韩语' },
  { id: 'ko-KR-InJoonNeural', label: 'InJoon · 男', group: '韩语' },
  { id: 'ko-KR-HyunsuMultilingualNeural', label: 'Hyunsu · 男 · 多语', group: '韩语' }
];

export function getEdgeVoiceIds(): string[] {
  return VOICES.map((v) => v.id);
}

export function getEdgeVoiceGroups(): { group: string; voices: EdgeVoice[] }[] {
  const groups: { group: string; voices: EdgeVoice[] }[] = [];
  const byName = new Map<string, EdgeVoice[]>();
  for (const v of VOICES) {
    let list = byName.get(v.group);
    if (!list) {
      list = [];
      byName.set(v.group, list);
      groups.push({ group: v.group, voices: list });
    }
    list.push(v);
  }
  return groups;
}
