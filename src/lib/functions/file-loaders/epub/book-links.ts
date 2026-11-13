import path from 'path-browserify';

/**
 * In-book links once every chapter file is merged into one document.
 *
 * Merging puts every file's ids in one namespace, and `href`s lose their file
 * part. Two things broke on that: ids that repeat across files (Duokan/Calibre
 * books number notes `n1`, `n2`… afresh in each chapter) sent every link to
 * the first file's copy, and a link to a whole file (`part0005.html`, no `#`)
 * became `#part0005.html`, which matches nothing. Links now resolve against
 * the file they sit in: repeats are renamed per file and file links go to
 * that file's wrapper.
 */
export interface BookFile {
  /** Manifest href, the same form a link resolves to. */
  href: string;
  /** Id of the element wrapping this file's content in the merged book. */
  wrapperId: string;
}

function decode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    // Not valid percent-encoding: the raw text is what the book meant.
    return s;
  }
}

const norm = (href: string) => path.normalize(decode(href));

/**
 * `ids[i]` lists file i's element ids in document order. Returns, per file,
 * the ids it has to rename (old → new) because an earlier file used them.
 */
export function renameRepeatedIds(ids: string[][]): Map<string, string>[] {
  const seen = new Set<string>();
  return ids.map((list, i) => {
    const renamed = new Map<string, string>();
    for (const id of list) {
      if (seen.has(id)) renamed.set(id, `${id}--${i}`);
    }
    list.forEach((id) => seen.add(id));
    return renamed;
  });
}

/** Lookup from a file's normalized href to its index. Build once per book. */
export function indexBookFiles(files: BookFile[]): Map<string, number> {
  return new Map(files.map((f, i) => [norm(f.href), i]));
}

/** The `#id` an `href` found in file `from` should point at. */
export function resolveBookHref(
  href: string,
  from: number,
  files: BookFile[],
  byHref: Map<string, number>,
  renamed: Map<string, string>[]
): string {
  const hashAt = href.indexOf('#');
  const filePart = hashAt < 0 ? href : href.slice(0, hashAt);
  const frag = hashAt < 0 ? '' : decode(href.slice(hashAt + 1));
  const fallback = `#${href.replace(/.+#/, '')}`;
  if (!filePart && !frag) return '#';
  if (/^[a-z][a-z\d+.-]*:/i.test(filePart)) return fallback;

  let target = from;
  if (filePart) {
    const wanted = norm(path.join(path.dirname(files[from].href), filePart));
    const found = byHref.get(wanted);
    if (found === undefined) return fallback;
    target = found;
  }
  if (!frag) return `#${files[target].wrapperId}`;
  return `#${renamed[target].get(frag) ?? frag}`;
}
