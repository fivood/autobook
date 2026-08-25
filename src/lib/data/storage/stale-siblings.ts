/**
 * Which files a write makes obsolete inside one book folder.
 *
 * Its own module so the node test can import it — the handler around it pulls
 * in the Tauri fs plugin and the whole `$lib` graph.
 */

export interface NamedFile {
  name: string;
  path: string;
}

/**
 * Files sharing `filename`'s prefix but not its path. Every storage filename
 * is `word_rest`, so the prefix is the head up to the first underscore.
 *
 * The sweep exists because readers pick their file with
 * `files.find((e) => e.name.startsWith(prefix))` — first in directory order,
 * which is NOT the newest: `bookdata_` puts a variable-width character count
 * ahead of the timestamp, so `bookdata_1_15_9000_<new>` sorts after
 * `bookdata_1_15_100000_<old>`. One removal that failed earlier would
 * therefore roll the book back on the next launch.
 */
export function staleSiblings<T extends NamedFile>(
  files: T[],
  filename: string,
  newPath: string
): T[] {
  const underscore = filename.indexOf('_');
  if (underscore < 0) return [];
  const prefix = filename.slice(0, underscore + 1);
  return files.filter((e) => e.name.startsWith(prefix) && e.path !== newPath);
}
