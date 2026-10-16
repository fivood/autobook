/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Voice catalog for both Kokoro model variants. Kept as static data rather
 * than read from the runtime `tts.voices` because the settings UI has to
 * render the picker before the model has been downloaded (and possibly
 * before the user has even consented to download it).
 *
 * Chinese voices in v1.1-zh are numeric ids only (zf_001..zf_099, zm_009..
 * zm_100, both non-contiguous). Labels here are our own — the upstream model
 * card doesn't describe them beyond gender.
 */

import type { KokoroModelId } from '$lib/data/store';

export interface KokoroVoice {
  id: string;
  label: string;
  group: string;
}

const V1_0_VOICES: KokoroVoice[] = [
  // American English female
  { id: 'af_heart', label: 'af_heart (♥ 推荐)', group: '英语 美式 · 女' },
  { id: 'af_alloy', label: 'af_alloy', group: '英语 美式 · 女' },
  { id: 'af_aoede', label: 'af_aoede', group: '英语 美式 · 女' },
  { id: 'af_bella', label: 'af_bella (高质量)', group: '英语 美式 · 女' },
  { id: 'af_jessica', label: 'af_jessica', group: '英语 美式 · 女' },
  { id: 'af_kore', label: 'af_kore', group: '英语 美式 · 女' },
  { id: 'af_nicole', label: 'af_nicole (ASMR)', group: '英语 美式 · 女' },
  { id: 'af_nova', label: 'af_nova', group: '英语 美式 · 女' },
  { id: 'af_river', label: 'af_river', group: '英语 美式 · 女' },
  { id: 'af_sarah', label: 'af_sarah', group: '英语 美式 · 女' },
  { id: 'af_sky', label: 'af_sky', group: '英语 美式 · 女' },
  // American English male
  { id: 'am_adam', label: 'am_adam', group: '英语 美式 · 男' },
  { id: 'am_echo', label: 'am_echo', group: '英语 美式 · 男' },
  { id: 'am_eric', label: 'am_eric', group: '英语 美式 · 男' },
  { id: 'am_fenrir', label: 'am_fenrir', group: '英语 美式 · 男' },
  { id: 'am_liam', label: 'am_liam', group: '英语 美式 · 男' },
  { id: 'am_michael', label: 'am_michael', group: '英语 美式 · 男' },
  { id: 'am_onyx', label: 'am_onyx', group: '英语 美式 · 男' },
  { id: 'am_puck', label: 'am_puck', group: '英语 美式 · 男' },
  { id: 'am_santa', label: 'am_santa', group: '英语 美式 · 男' },
  // British English female
  { id: 'bf_alice', label: 'bf_alice', group: '英语 英式 · 女' },
  { id: 'bf_emma', label: 'bf_emma', group: '英语 英式 · 女' },
  { id: 'bf_isabella', label: 'bf_isabella', group: '英语 英式 · 女' },
  { id: 'bf_lily', label: 'bf_lily', group: '英语 英式 · 女' },
  // British English male
  { id: 'bm_daniel', label: 'bm_daniel', group: '英语 英式 · 男' },
  { id: 'bm_fable', label: 'bm_fable', group: '英语 英式 · 男' },
  { id: 'bm_george', label: 'bm_george', group: '英语 英式 · 男' },
  { id: 'bm_lewis', label: 'bm_lewis', group: '英语 英式 · 男' }
];

// v1.1-zh voice IDs pulled from onnx-community/Kokoro-82M-v1.1-zh-ONNX
// (2025-03). Chinese IDs are non-contiguous — kept as authored to match the
// files actually shipped in the model repo.
const V1_1_ZH_CHINESE_FEMALE = [
  '001','002','003','004','005','006','007','008',
  '017','018','019',
  '021','022','023','024','026','027','028',
  '032','036','038','039','040','042','043','044','046','047','048','049',
  '051','059','060','067',
  '070','071','072','073','074','075','076','077','078','079',
  '083','084','085','086','087','088','090','092','093','094','099'
];
const V1_1_ZH_CHINESE_MALE = [
  '009','010','011','012','013','014','015','016',
  '020','025','029','030','031','033','034','035','037',
  '041','045','050','052','053','054','055','056','057','058',
  '061','062','063','064','065','066','068','069',
  '080','081','082','089','091','095','096','097','098','100'
];

const V1_1_ZH_VOICES: KokoroVoice[] = [
  // English speakers new in v1.1-zh — described in the model card
  { id: 'af_maple', label: 'af_maple (v1.1 新增)', group: '英语 · 女' },
  { id: 'af_sol', label: 'af_sol (v1.1 新增)', group: '英语 · 女' },
  { id: 'bf_vale', label: 'bf_vale (v1.1 新增)', group: '英语 · 女' },
  ...V1_1_ZH_CHINESE_FEMALE.map((n) => ({
    id: `zf_${n}`,
    label: `中文女声 · ${n}`,
    group: '中文 · 女'
  })),
  ...V1_1_ZH_CHINESE_MALE.map((n) => ({
    id: `zm_${n}`,
    label: `中文男声 · ${n}`,
    group: '中文 · 男'
  }))
];

export function getKokoroVoices(modelId: KokoroModelId): KokoroVoice[] {
  return modelId === 'v1.0' ? V1_0_VOICES : V1_1_ZH_VOICES;
}

/** Group the flat catalog into <optgroup>s while preserving declared order. */
export function getKokoroVoiceGroups(modelId: KokoroModelId): { group: string; voices: KokoroVoice[] }[] {
  const voices = getKokoroVoices(modelId);
  const groups: { group: string; voices: KokoroVoice[] }[] = [];
  const byName = new Map<string, KokoroVoice[]>();
  for (const v of voices) {
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

/** The recommended default voice for a given model — used to pick a
 *  sensible replacement when the saved voice isn't in the new model. */
export function getDefaultKokoroVoice(modelId: KokoroModelId): string {
  return modelId === 'v1.0' ? 'af_heart' : 'zf_001';
}
