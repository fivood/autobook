import {
  buildStarDict,
  decompressDictDz,
  parseIdx,
  parseIfo
} from '$lib/data/dict/stardict';

export interface LoadedDict {
  name: string;
  source: string;
  lookup(word: string): string[];
}

export interface DictScanResult {
  loaded: LoadedDict[];
  errors: string[];
}

export const loadedDicts$ = (() => {
  let value: LoadedDict[] = [];
  const subs = new Set<(v: LoadedDict[]) => void>();
  return {
    get(): LoadedDict[] {
      return value;
    },
    set(v: LoadedDict[]) {
      value = v;
      for (const s of subs) s(v);
    },
    subscribe(run: (v: LoadedDict[]) => void) {
      subs.add(run);
      run(value);
      return () => subs.delete(run);
    }
  };
})();

export function lookupAll(word: string): { dict: string; entries: string[] }[] {
  const out: { dict: string; entries: string[] }[] = [];
  for (const d of loadedDicts$.get()) {
    const entries = d.lookup(word);
    if (entries.length) out.push({ dict: d.name, entries });
  }
  return out;
}

interface FileLike {
  name: string;
  /** absolute path */
  path: string;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
}

/**
 * Scan a folder for dictionaries. Tauri-side function: requires fs access
 * to the given path. Each subdirectory containing an .ifo file is treated as
 * a StarDict. Files ending in .dict.json are treated as plain JSON dicts.
 */
export async function scanDictFolder(rootPath: string): Promise<DictScanResult> {
  const result: DictScanResult = { loaded: [], errors: [] };
  let fsApi: any;
  try {
    fsApi = await import('@tauri-apps/plugin-fs');
  } catch (e) {
    result.errors.push('Tauri fs 不可用');
    return result;
  }
  const { readDir, readFile, readTextFile } = fsApi;

  async function walk(dir: string): Promise<FileLike[]> {
    const entries = await readDir(dir);
    const out: FileLike[] = [];
    for (const e of entries) {
      const childPath = `${dir}/${e.name}`;
      if (e.isDirectory) {
        out.push(...(await walk(childPath)));
      } else {
        out.push({
          name: e.name,
          path: childPath,
          bytes: async () => new Uint8Array(await readFile(childPath)),
          text: async () => readTextFile(childPath)
        });
      }
    }
    return out;
  }

  let files: FileLike[];
  try {
    files = await walk(rootPath);
  } catch (e: any) {
    result.errors.push(`扫描失败：${e?.message || e}`);
    return result;
  }

  const ifoFiles = files.filter((f) => f.name.toLowerCase().endsWith('.ifo'));
  const jsonFiles = files.filter((f) => /\.dict\.json$/i.test(f.name));
  const byBaseName = new Map<string, FileLike>();
  for (const f of files) byBaseName.set(f.path.toLowerCase(), f);

  for (const ifoFile of ifoFiles) {
    try {
      const base = ifoFile.path.replace(/\.ifo$/i, '');
      const idxFile =
        byBaseName.get(`${base.toLowerCase()}.idx`) ||
        byBaseName.get(`${base.toLowerCase()}.idx.gz`);
      const dictFile =
        byBaseName.get(`${base.toLowerCase()}.dict.dz`) ||
        byBaseName.get(`${base.toLowerCase()}.dict`);
      if (!idxFile || !dictFile) {
        result.errors.push(`${ifoFile.name}: 缺少 .idx 或 .dict 文件`);
        continue;
      }
      const meta = parseIfo(await ifoFile.text());
      let idxBytes = await idxFile.bytes();
      if (/\.gz$/i.test(idxFile.name)) {
        idxBytes = await decompressDictDz(idxBytes);
      }
      const idxParsed = parseIdx(idxBytes, meta.idxOffsetBits);
      let dictBytes = await dictFile.bytes();
      if (/\.dz$/i.test(dictFile.name)) {
        dictBytes = await decompressDictDz(dictBytes);
      }
      const sd = buildStarDict(meta, idxParsed, dictBytes);
      result.loaded.push({
        name: meta.bookname || ifoFile.name.replace(/\.ifo$/i, ''),
        source: ifoFile.path,
        lookup: (w: string) => sd.lookup(w)
      });
    } catch (e: any) {
      result.errors.push(`${ifoFile.name}: ${e?.message || e}`);
    }
  }

  for (const jf of jsonFiles) {
    try {
      const text = await jf.text();
      const data = JSON.parse(text);
      const map = new Map<string, string[]>();
      if (Array.isArray(data)) {
        for (const row of data) {
          if (typeof row?.word === 'string' && typeof row?.def === 'string') {
            const k = row.word.toLowerCase();
            const arr = map.get(k) || [];
            arr.push(row.def);
            map.set(k, arr);
          }
        }
      } else if (data && typeof data === 'object') {
        for (const [k, v] of Object.entries(data)) {
          const def = Array.isArray(v) ? v.map(String).join('\n') : String(v);
          map.set(k.toLowerCase(), [def]);
        }
      }
      result.loaded.push({
        name: jf.name.replace(/\.dict\.json$/i, ''),
        source: jf.path,
        lookup: (w: string) => {
          const key = w.toLowerCase();
          return map.get(key) || [];
        }
      });
    } catch (e: any) {
      result.errors.push(`${jf.name}: ${e?.message || e}`);
    }
  }

  loadedDicts$.set(result.loaded);
  return result;
}
