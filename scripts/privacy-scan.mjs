/**
 * Release-readiness privacy check — real personal info only.
 * Reports local usernames, absolute paths, specific book titles, API keys,
 * specific local model ids, EXCLUDING the scan tool's own regex strings.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const roots = ['src', 'src-tauri/src', 'scripts', 'docs'];
const SKIP = ['node_modules', 'build', '.svelte-kit', 'target', 'test-dicts'];
const TEXT_EXT = ['.ts', '.svelte', '.js', '.mjs', '.rs', '.toml', '.json', '.md'];
const patterns = [
  [/\bfukki\b/, 'local username'],
  [/'E:\\book'|"E:\\book"|E:\\\\book/, 'test book dir'],
  [/刺客正传|卡拉马佐夫|亨利·詹姆斯|罗宾·霍布|创造自然/, 'book title'],
  [/sk-ant-[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{40,}/, 'API key'],
  [/qwen2\.5:14b\b|gemma4:e4b\b|gemma3:12b\b/, 'local model id'],
  [/"C:\\[A-Za-z ]+\\(Program|Users)\\?[^"]*"(?!.*ebook-convert)/, 'abs path (non-calibre)']
];
const hits = [];
function walk(d) {
  let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const f of es) {
    const p = join(d, f.name);
    if (f.isDirectory()) { if (!SKIP.includes(f.name)) walk(p); }
    else if (TEXT_EXT.includes(extname(f.name))) {
      try {
        const s = readFileSync(p, 'utf8');
        for (const [re, label] of patterns) {
          const m = s.match(re);
          if (m && !p.includes('privacy-scan') && !p.includes('sanitize')) {
            hits.push(`[${label}] ${p}: ${m[0].slice(0, 50)}`);
          }
        }
      } catch {}
    }
  }
}
for (const r of roots) walk(r);
const uniq = [...new Set(hits)];
for (const h of uniq) console.log(h);
console.log(uniq.length ? `\n共 ${uniq.length} 处` : '\n✓ 无可发布泄漏（源码无个人用户名/路径/书名/key）');
