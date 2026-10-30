import type { DBSchema } from 'idb';
import type BooksDbV12 from '$lib/data/database/books-db/versions/v12/books-db-v12';
import type { BooksDbV9Highlight } from '$lib/data/database/books-db/versions/v9/books-db-v9';

/**
 * Which of the four highlight slots a highlight belongs to.
 *
 * Deliberately positional rather than a colour name. Up to v12 these were
 * `'yellow' | 'blue' | 'green' | 'pink'`, which stopped being true the moment
 * the palette became user-configurable — a stored `'yellow'` rendering black
 * is the kind of thing you decode at 3am. The slot is the identity; what it
 * looks like is a theme concern (see `$lib/data/highlight-color`).
 *
 * The field is still called `color` because renaming it would mean touching
 * every `h.color` reference for no behavioural gain.
 */
export type HighlightSlot = '1' | '2' | '3' | '4';

export interface BooksDbV13Highlight extends Omit<BooksDbV9Highlight, 'color'> {
  color: HighlightSlot;
}

export default interface BooksDbV13 extends DBSchema {
  data: BooksDbV12['data'];
  bookmark: BooksDbV12['bookmark'];
  lastItem: BooksDbV12['lastItem'];
  storageSource: BooksDbV12['storageSource'];
  statistic: BooksDbV12['statistic'];
  readingGoal: BooksDbV12['readingGoal'];
  lastModified: BooksDbV12['lastModified'];
  audioBook: BooksDbV12['audioBook'];
  subtitle: BooksDbV12['subtitle'];
  handle: BooksDbV12['handle'];
  folder: BooksDbV12['folder'];
  bookFolder: BooksDbV12['bookFolder'];
  highlight: {
    key: number;
    value: BooksDbV13Highlight;
    indexes: { dataId: number; dataIdStartOffset: [number, number] };
  };
  highlightFolder: BooksDbV12['highlightFolder'];
  session: BooksDbV12['session'];
  manualBook: BooksDbV12['manualBook'];
  bookMetadata: BooksDbV12['bookMetadata'];
}
