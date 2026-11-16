import test from 'node:test';
import assert from 'node:assert/strict';
import { pickWebVoice, voiceSpeaks } from '../src/lib/data/tts/web-voice-pick.ts';
import { detectLanguage } from '../src/lib/functions/file-loaders/detect-language.ts';

const v = (name: string, lang: string, isDefault = false) => ({
  name,
  lang,
  default: isDefault,
  localService: true
});

// The order macOS lists them in: Eloquence / novelty voices before the system
// voice. Taking the first zh match read Chinese books in "Eddy".
const MAC_ZH = [
  v('Eddy (中文（中国大陆）)', 'zh-CN'),
  v('Flo (中文（中国大陆）)', 'zh-CN'),
  v('Grandpa (中文（中国大陆）)', 'zh-CN'),
  v('Meijia', 'zh-TW'),
  v('Tingting', 'zh-CN', true)
];

test('macOS: the system voice, not the first Eloquence voice', () => {
  assert.equal(pickWebVoice(MAC_ZH, 'zh-CN')?.name, 'Tingting');
  assert.equal(pickWebVoice(MAC_ZH, 'zh')?.name, 'Tingting');
});

test('no default flagged: first real voice, never a novelty one', () => {
  const list = [v('Eddy (中文（中国大陆）)', 'zh-CN'), v('Lili', 'zh-CN'), v('Tingting', 'zh-CN')];
  assert.equal(pickWebVoice(list, 'zh-CN')?.name, 'Lili');
});

test('high-quality voice beats a plain one', () => {
  const list = [v('Kyoko', 'ja-JP'), v('Kyoko (Enhanced)', 'ja-JP')];
  assert.equal(pickWebVoice(list, 'ja')?.name, 'Kyoko (Enhanced)');
});

test('Korean: family match, novelty skipped', () => {
  const list = [...MAC_ZH, v('Rocko (한국어(대한민국))', 'ko-KR'), v('Yuna', 'ko-KR')];
  assert.equal(pickWebVoice(list, 'ko')?.name, 'Yuna');
  assert.equal(pickWebVoice(list, 'ko-KR')?.name, 'Yuna');
  assert.equal(pickWebVoice(MAC_ZH, 'ko'), undefined);
});

test('a saved Chinese voice does not read Korean; multilingual ones do', () => {
  assert.equal(voiceSpeaks(v('Tingting', 'zh-CN'), 'ko'), false);
  assert.equal(voiceSpeaks(v('Yuna', 'ko-KR'), 'ko-KR'), true);
  assert.equal(voiceSpeaks(v('Microsoft Ava Multilingual Online', 'en-US'), 'ko'), true);
});

test('Korean text is detected as Korean, not Chinese', () => {
  assert.equal(detectLanguage('그는 오래된 책을 펼치고 천천히 읽기 시작했다. 이 이야기는 아주 먼 옛날의 일이다.'), 'ko');
  assert.equal(detectLanguage('大韓民國 憲法 第一條. 대한민국은 민주공화국이다. 대한민국의 주권은 국민에게 있다.'), 'ko');
  assert.equal(detectLanguage('他打开那本旧书，慢慢地读了起来。这个故事发生在很久以前。'), 'zh');
  assert.equal(detectLanguage('彼は古い本を開き、ゆっくりと読み始めた。この物語はずっと昔のことである。'), 'ja');
});

test('Hangul counts toward reading position; other scripts unchanged', async () => {
  const { isCountedCharacter } = await import('../src/lib/functions/counted-character.ts');
  for (const ch of ['한', '글', 'ㄱ', '漢', 'か', 'A', '7']) assert.ok(isCountedCharacter(ch), ch);
  for (const ch of [' ', '。', '.', '，', '!']) assert.ok(!isCountedCharacter(ch), ch);
});
