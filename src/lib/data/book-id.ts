/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Two different numbers both called "the book id".
 *
 * - `IdbBookId` is the autoincrement key of the `data` store. Bookmarks,
 *   highlights and `lastItem` are keyed by it, and `/b?id=` carries it.
 * - `BookCardId` is what the library grid shows. Under browser storage it
 *   happens to equal the IDB id; under external file storage the books are
 *   directories on disk with no IDB row at all, so the id is derived as
 *   `stableIdFromTitle(title)`. `bookFolder.bookId` stores this one.
 *
 * They are unrelated number spaces that never overlap, so a mix-up does not
 * throw — the lookup just quietly returns nothing, or writes a row nobody
 * will ever find again. That has bitten this codebase more than once; the
 * most recent was `tauri-fs-handler.saveBook` returning a constant 0 that
 * went unnoticed for months because its only caller discarded it.
 *
 * Branding them makes the compiler refuse the mix-up. Conversion is possible
 * but has to be spelled out, which is the point: every cast below is a place
 * where someone asserted the two spaces line up, and can be audited.
 */

declare const idbBookIdBrand: unique symbol;
declare const bookCardIdBrand: unique symbol;

export type IdbBookId = number & { readonly [idbBookIdBrand]: true };
export type BookCardId = number & { readonly [bookCardIdBrand]: true };

/** Tag a raw number coming from the `data` store / the `?id=` query param. */
export function asIdbBookId(id: number): IdbBookId {
  return id as IdbBookId;
}

/** Tag a raw number that identifies a library card. */
export function asBookCardId(id: number): BookCardId {
  return id as BookCardId;
}

/**
 * Browser storage keeps books as IDB rows, so a card's id *is* the row's id.
 * Only correct for that storage source — external file storage derives card
 * ids from the title and has no IDB row to point at.
 */
export function cardIdFromIdbId(id: IdbBookId): BookCardId {
  return id as unknown as BookCardId;
}
