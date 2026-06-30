// IndexedDB book cache. Keeps the original imported file Blob keyed by
// content hash, so "最近阅读" can reopen instantly without re-prompting
// for the file. Position metadata + cover thumbnail still live in
// localStorage (see persist.ts) — IDB is purely for the raw binary.
//
// Why a separate store: the original file blob can be 10–100 MB for a
// big PDF. localStorage's 5 MB limit + sync API rules it out. IDB has
// no practical size cap (Chrome ~80% of disk, Safari ~1 GB per origin)
// and async API keeps the UI thread free during a 50 MB blob write.

const DB_NAME = 'autobook-pwa';
const STORE = 'books';
const DB_VERSION = 1;

interface StoredBook {
  hash: string;
  title: string;
  blob: Blob;
  storedAt: number;
  /** MIME / filename type echoed back so the loader can pick the right
   * dispatcher when it re-enters `loadFile`. */
  fileName: string;
}

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB 不可用'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'hash' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IDB open failed'));
  });
  return dbPromise;
}

/** Persist the imported file. Best-effort: quota errors are caught and
 * surfaced as a rejected promise (the caller can decide whether to
 * warn the user); the book still opens fine without the cache. */
export async function storeBook(
  hash: string,
  title: string,
  blob: Blob,
  fileName: string
): Promise<void> {
  const db = await openDb();
  const entry: StoredBook = {
    hash,
    title,
    blob,
    storedAt: Date.now(),
    fileName
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IDB put failed'));
    tx.objectStore(STORE).put(entry);
  });
}

export async function getStoredBook(hash: string): Promise<StoredBook | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(hash);
    req.onsuccess = () => resolve((req.result as StoredBook) ?? null);
    req.onerror = () => reject(req.error || new Error('IDB get failed'));
  });
}

export async function deleteStoredBook(hash: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IDB delete failed'));
    tx.objectStore(STORE).delete(hash);
  });
}

/** For storage-quota debugging / a future "manage cache" panel. */
export async function listStoredHashes(): Promise<string[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve((req.result as string[]) ?? []);
    req.onerror = () => reject(req.error || new Error('IDB keys failed'));
  });
}
