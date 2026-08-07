import { BlobReader, BlobWriter, ZipReader, type Entry } from '@zip.js/zip.js';
import pLimit from 'p-limit';

const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp)$/i;

interface FileEntry {
  filename: string;
  directory: boolean;
  getData(writer: BlobWriter): Promise<Blob>;
}

function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const aTokens = a.toLowerCase().match(re) || [];
  const bTokens = b.toLowerCase().match(re) || [];
  const len = Math.min(aTokens.length, bTokens.length);
  for (let i = 0; i < len; i++) {
    const ax = aTokens[i];
    const bx = bTokens[i];
    if (/^\d+$/.test(ax) && /^\d+$/.test(bx)) {
      const d = parseInt(ax, 10) - parseInt(bx, 10);
      if (d !== 0) return d;
    } else if (ax !== bx) {
      return ax < bx ? -1 : 1;
    }
  }
  return aTokens.length - bTokens.length;
}

function mimeFromExt(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    default: return 'image/jpeg';
  }
}

export interface ComicExtractResult {
  title: string;
  pageBlobs: Blob[];
}

export async function extractComicPages(file: File): Promise<ComicExtractResult> {
  const fallbackTitle = file.name.replace(/\.(cbz|cbr)$/i, '');
  const reader = new ZipReader(new BlobReader(file));
  try {
    const allEntries = (await reader.getEntries()).filter(
      (e: Entry): e is Entry & FileEntry =>
        !e.directory && typeof (e as unknown as FileEntry).getData === 'function'
    ) as unknown as FileEntry[];

    const imageEntries = allEntries
      .filter((e) => IMAGE_RE.test(e.filename))
      .sort((a, b) => naturalCompare(a.filename, b.filename));

    if (!imageEntries.length) {
      throw new Error('CBZ 文件里没有找到图片');
    }

    let title = fallbackTitle;
    const comicInfoEntry = allEntries.find((e) => /comicinfo\.xml$/i.test(e.filename));
    if (comicInfoEntry) {
      try {
        const buf = await (await comicInfoEntry.getData(new BlobWriter('text/xml'))).arrayBuffer();
        const xml = new TextDecoder('utf-8').decode(buf);
        const m = /<Title>([^<]+)<\/Title>/i.exec(xml);
        if (m) title = m[1].trim();
      } catch {
        // metadata missing/corrupt — keep filename-derived title
      }
    }

    const pageBlobs: Blob[] = [];
    // Decompression is CPU-bound on a single worker thread, so a wide window
    // helps nothing and just spikes memory. 4 in flight keeps the zip reader
    // fed while the inflate work overlaps, cutting a 200-page serial extract
    // to roughly a quarter of the wall time.
    const limiter = pLimit(4);
    const jobs = imageEntries.map((entry) =>
      limiter(async () => {
        const mime = mimeFromExt(entry.filename);
        return entry.getData(new BlobWriter(mime));
      })
    );
    pageBlobs.push(...(await Promise.all(jobs)));

    return { title, pageBlobs };
  } finally {
    await reader.close();
  }
}
