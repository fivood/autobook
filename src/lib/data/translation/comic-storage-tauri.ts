import type { ComicStorage } from 'translator-workbench';
import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  remove,
  writeFile
} from '@tauri-apps/plugin-fs';

const ROOT = 'AutoBook/comic-cache';

function pagePath(jobId: string, pageIndex: number): string {
  return `${ROOT}/${jobId}/pages/${String(pageIndex).padStart(4, '0')}.bin`;
}

function inpaintPath(jobId: string, pageIndex: number): string {
  return `${ROOT}/${jobId}/inpaint/${String(pageIndex).padStart(4, '0')}.bin`;
}

function ocrPath(jobId: string, pageIndex: number): string {
  return `${ROOT}/${jobId}/ocr/${String(pageIndex).padStart(4, '0')}.json`;
}

async function ensureDir(path: string): Promise<void> {
  const dir = path.slice(0, path.lastIndexOf('/'));
  if (!(await exists(dir, { baseDir: BaseDirectory.Document }))) {
    await mkdir(dir, { baseDir: BaseDirectory.Document, recursive: true });
  }
}

export class TauriComicStorage implements ComicStorage {
  async writePage(jobId: string, pageIndex: number, blob: Blob): Promise<string> {
    const p = pagePath(jobId, pageIndex);
    await ensureDir(p);
    await writeFile(p, new Uint8Array(await blob.arrayBuffer()), { baseDir: BaseDirectory.Document });
    return p;
  }

  async readPage(jobId: string, pageIndex: number): Promise<Blob | null> {
    const p = pagePath(jobId, pageIndex);
    if (!(await exists(p, { baseDir: BaseDirectory.Document }))) return null;
    const bytes = await readFile(p, { baseDir: BaseDirectory.Document });
    return new Blob([bytes]);
  }

  async writeOcrCache(jobId: string, pageIndex: number, data: object): Promise<void> {
    const p = ocrPath(jobId, pageIndex);
    await ensureDir(p);
    const json = JSON.stringify(data);
    await writeFile(p, new TextEncoder().encode(json), { baseDir: BaseDirectory.Document });
  }

  async readOcrCache(jobId: string, pageIndex: number): Promise<object | null> {
    const p = ocrPath(jobId, pageIndex);
    if (!(await exists(p, { baseDir: BaseDirectory.Document }))) return null;
    const bytes = await readFile(p, { baseDir: BaseDirectory.Document });
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as object;
  }

  async writeInpainted(jobId: string, pageIndex: number, blob: Blob): Promise<string> {
    const p = inpaintPath(jobId, pageIndex);
    await ensureDir(p);
    await writeFile(p, new Uint8Array(await blob.arrayBuffer()), { baseDir: BaseDirectory.Document });
    return p;
  }

  async readInpainted(jobId: string, pageIndex: number): Promise<Blob | null> {
    const p = inpaintPath(jobId, pageIndex);
    if (!(await exists(p, { baseDir: BaseDirectory.Document }))) return null;
    const bytes = await readFile(p, { baseDir: BaseDirectory.Document });
    return new Blob([bytes]);
  }

  async deleteJob(jobId: string): Promise<void> {
    const dir = `${ROOT}/${jobId}`;
    if (await exists(dir, { baseDir: BaseDirectory.Document })) {
      await remove(dir, { baseDir: BaseDirectory.Document, recursive: true });
    }
  }
}
