/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Curated Edge TTS voice catalog. Microsoft ships 300+ voices; this list
 * picks the ones a Chinese/Japanese/English reader is actually going to use.
 * Full list at speech.platform.bing.com/consumer/speech/synthesize/readaloud/
 * voices/list — the settings UI has an "自定义" text box for users who want
 * one not in this catalog.
 */

export interface EdgeVoice {
  id: string;
  label: string;
  group: string;
}

const VOICES: EdgeVoice[] = [
  // 中文 · 大陆
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女 · 通用（推荐）', group: '中文 · 大陆' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女 · 温柔', group: '中文 · 大陆' },
  { id: 'zh-CN-YunxiNeural', label: '云希 · 男 · 阳光', group: '中文 · 大陆' },
  { id: 'zh-CN-YunyangNeural', label: '云扬 · 男 · 磁性播报', group: '中文 · 大陆' },
  { id: 'zh-CN-YunjianNeural', label: '云健 · 男 · 沉稳', group: '中文 · 大陆' },
  { id: 'zh-CN-YunxiaNeural', label: '云夏 · 男童', group: '中文 · 大陆' },
  { id: 'zh-CN-XiaochenNeural', label: '晓辰 · 女 · 随意', group: '中文 · 大陆' },
  { id: 'zh-CN-XiaohanNeural', label: '晓涵 · 女 · 温暖', group: '中文 · 大陆' },
  { id: 'zh-CN-XiaomengNeural', label: '晓梦 · 女 · 甜美', group: '中文 · 大陆' },
  { id: 'zh-CN-XiaomoNeural', label: '晓墨 · 女 · 舒缓', group: '中文 · 大陆' },
  { id: 'zh-CN-XiaoqiuNeural', label: '晓秋 · 女 · 成熟', group: '中文 · 大陆' },
  { id: 'zh-CN-XiaoruiNeural', label: '晓睿 · 女 · 长者', group: '中文 · 大陆' },
  { id: 'zh-CN-XiaoshuangNeural', label: '晓双 · 女童', group: '中文 · 大陆' },
  { id: 'zh-CN-XiaoxuanNeural', label: '晓萱 · 女 · 犀利', group: '中文 · 大陆' },
  { id: 'zh-CN-XiaoyanNeural', label: '晓颜 · 女 · 温柔', group: '中文 · 大陆' },
  { id: 'zh-CN-XiaoyouNeural', label: '晓悠 · 女童', group: '中文 · 大陆' },
  { id: 'zh-CN-XiaozhenNeural', label: '晓甄 · 女 · 情绪丰富', group: '中文 · 大陆' },
  { id: 'zh-CN-YunfengNeural', label: '云枫 · 男 · 深情', group: '中文 · 大陆' },
  { id: 'zh-CN-YunhaoNeural', label: '云皓 · 男 · 广告', group: '中文 · 大陆' },
  { id: 'zh-CN-YunyeNeural', label: '云野 · 男 · 深沉', group: '中文 · 大陆' },
  { id: 'zh-CN-YunzeNeural', label: '云泽 · 男 · 老年', group: '中文 · 大陆' },
  // 中文 · 方言
  { id: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北 · 女 · 东北', group: '中文 · 方言' },
  { id: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮 · 女 · 陕西', group: '中文 · 方言' },
  { id: 'zh-CN-sichuan-YunxiNeural', label: '云希 · 男 · 四川', group: '中文 · 方言' },
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
  { id: 'ja-JP-AoiNeural', label: '葵 · 女', group: '日语' },
  { id: 'ja-JP-DaichiNeural', label: '大地 · 男', group: '日语' },
  { id: 'ja-JP-MayuNeural', label: '真夕 · 女', group: '日语' },
  // 英语（多语音色首选，可讲中文）
  { id: 'en-US-EmmaMultilingualNeural', label: 'Emma · 女 · 多语', group: '英语（多语首选）' },
  { id: 'en-US-AvaMultilingualNeural', label: 'Ava · 女 · 多语', group: '英语（多语首选）' },
  { id: 'en-US-AndrewMultilingualNeural', label: 'Andrew · 男 · 多语', group: '英语（多语首选）' },
  { id: 'en-US-BrianMultilingualNeural', label: 'Brian · 男 · 多语', group: '英语（多语首选）' },
  // 英语 · 美式（单语）
  { id: 'en-US-JennyNeural', label: 'Jenny · 女', group: '英语 · 美式' },
  { id: 'en-US-AriaNeural', label: 'Aria · 女', group: '英语 · 美式' },
  { id: 'en-US-GuyNeural', label: 'Guy · 男', group: '英语 · 美式' },
  { id: 'en-US-DavisNeural', label: 'Davis · 男', group: '英语 · 美式' },
  // 英语 · 英式
  { id: 'en-GB-SoniaNeural', label: 'Sonia · 女', group: '英语 · 英式' },
  { id: 'en-GB-RyanNeural', label: 'Ryan · 男', group: '英语 · 英式' },
  // 韩语
  { id: 'ko-KR-SunHiNeural', label: 'SunHi · 女', group: '韩语' },
  { id: 'ko-KR-InJoonNeural', label: 'InJoon · 男', group: '韩语' }
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
