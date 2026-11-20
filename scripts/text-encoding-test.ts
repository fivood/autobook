import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAndDecode } from '../src/lib/functions/file-loaders/txt/extract-txt.ts';

// Real legacy-encoded text (generated with Python's codecs, then base64), and
// the opening it must decode to. A Korean CP949 TXT used to come out as
// GB18030 gibberish; Chinese GBK in turn decodes as EUC-KR into valid but
// meaningless Hangul, so both directions are pinned here.
const SAMPLES: Record<string, [string, string]> = {
  'ko-cp949': ['waYxwOUgvcPA2woKsde0wiC/wLehtcggw6XAuyDG7sShsO0gw7XDtcj3IMDQseIgvcPA28fftNkuIMDMIMDMvt+x4rTCIL7GwdYguNUgv76zrywgwNvAuiC4tsC7v6G8rSDAz77us60gwM/AzLTZLiC4tsC7ILvntve16cC6ILjFwM8gvsbEpyC/7LmwsKG/oSC48L+pILytt87AxyC+yLrOuKYgubC++rTZLgoKsde3r7OqIL7utMAgs68gs7i8sSC81bTUwMwgw6O+xr/UsO0sILjwtecgsM3AzCC03rbzwfax4iC9w8Dbx9+02S4=', '제1장 시작\n\n그는 오'],
  'ko-hanja': ['097529rFz9Ag+srb9iDwr+zp8MkuILTrx9G5zrG5wLoguc7B1rD4yK2xucDMtNkuILTrx9G5zrG5wMcgwdaxx8C6ILG5uc6/obDUIMDWsO0sILjwtecgsce3wsC6ILG5uc7AuLfOus7FzSCzqr/CtNkuIMDMILn9wLogsPjG98fRILOvus7FzSC9w8fgx9G02S4=', '大韓民國 憲法 第一條.'],
  'zh-gbk': ['tdrSu9XCIL+qyrwKCsv7tPK/qsTHsb6+ycrpo6zC/cL9tdi2wcHLxvDAtKGj1eK49rnKysK3osn61Nq63L7Duty+w9LUx7C1xNK7uPbQobTl16/A76GjtOXA77XEyMvDx8O/zOzU58nPtry74b7b1Nq+rrHfo6y7pc/gzsq68qGjCgrIu7b409DSu8zso6zAtMHL0rvOu8Swyfq1xL/NyMujrNK7x9C2vL+qyryx5LXDsrvNrMHLoaM=', '第一章 开始\n\n他打开那'],
  'zh-big5': ['ssSkQLO5ILZ9qWwKCqVMpbS2fai6pbvCwq7RoUG6Q7pDpmHFqqRGsF+o06FDs2+t06xHqMa1b6XNpmKr3KRbq9ykW6VIq2WquqRArdOkcKf4svi4zKFDp/i4zKq6pEitzKhDpNGmraRXs6O3fLtFpmKkq8PkoUGkrKzbsN2t1KFDCgq1TabTprOkQKTRoUGo06RGpECm7K2vpc2quqvIpEihQaRApMGzo7Z9qWzF3LFvpKOmUKRGoUM=', '第一章 開始\n\n他打開那'],
  'ja-sjis': ['keaI6o/NIILNgraC3ILoCgqU3oLNjMOCopZ7gvCKSoKrgUGC5ILBgq2C6ILGk8eC3Y5ugt+CvYFCgrGCzJWojOqCzYFBgriCwYLGkMyBQY+sgrOCyJG6gsWLToKrgr2CsYLGgsWCoILpgUKRuoLMkGyBWILNloiSqYjkjMuCzIK7gs6CyY9XgtyC6IFBjN2CooLJgqCCooKzgsKC8Izwgu2CtYK9gUI=', '第一章 はじまり\n\n彼は'],
};

for (const [name, [b64, opening]] of Object.entries(SAMPLES)) {
  test(`legacy encoding: ${name}`, () => {
    const text = detectAndDecode(new Uint8Array(Buffer.from(b64, 'base64')));
    assert.equal(text.slice(0, opening.length), opening);
  });
}
