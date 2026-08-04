import { BlobReader, BlobWriter, ZipReader, ZipWriter, configure } from '@zip.js/zip.js';
import { XMLParser } from 'fast-xml-parser';
import type { DocumentAdapter, DocumentSource, SegmentReplacement, TranslationDocument, TranslationSegment } from '../core/model.js';

// zip.js defaults to browser Web Workers. The same adapter is shared with
// the Node/Tauri worker, where Worker is not available.
configure({ useWebWorkers: typeof Worker !== 'undefined' });

interface EpubArchiveState {
  opfPath: string;
  entryOrder: string[];
  files: Record<string, Uint8Array>;
  textFiles: Set<string>;
  missingManifestPaths: string[];
  missingReferencedPaths: string[];
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
}

interface RawManifestItem {
  '@_id'?: string;
  '@_href'?: string;
  '@_media-type'?: string;
}

const TEXT_MEDIA_TYPES = new Set(['application/xhtml+xml', 'text/html']);
const SKIP_TAGS = new Set(['script', 'style', 'svg', 'math']);

function arrayOf<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && '#text' in value) {
    const candidate = (value as { '#text'?: unknown })['#text'];
    return typeof candidate === 'string' ? candidate : undefined;
  }
  return undefined;
}

function normalizeZipPath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function relativeZipPath(baseDir: string, target: string): string {
  const baseParts = baseDir ? baseDir.split('/').filter(Boolean) : [];
  const targetParts = target.split('/').filter(Boolean);
  while (baseParts.length && targetParts[0] === baseParts[0]) {
    baseParts.shift();
    targetParts.shift();
  }
  return [...baseParts.map(() => '..'), ...targetParts].join('/');
}

function escapeXmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function resolveZipPath(baseDir: string, href: string): string {
  const withoutFragment = href.split('#', 1)[0] || '';
  let decoded = withoutFragment;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    // Keep malformed percent-encoding as-is; the entry lookup below will report it.
  }
  return normalizeZipPath(baseDir ? `${baseDir}/${decoded}` : decoded);
}

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function parsePackage(contentsXml: string): {
  opfPath: string;
  title?: string;
  language?: string;
  manifest: ManifestItem[];
  spine: string[];
} {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const parsed = parser.parse(contentsXml) as Record<string, unknown>;
  const packageNode = (parsed['opf:package'] || parsed.package) as Record<string, unknown> | undefined;
  if (!packageNode) throw new Error('EPUB package element not found.');

  const metadata = (packageNode['opf:metadata'] || packageNode.metadata || {}) as Record<string, unknown>;
  const manifestNode = (packageNode['opf:manifest'] || packageNode.manifest) as Record<string, unknown> | undefined;
  const spineNode = (packageNode['opf:spine'] || packageNode.spine) as Record<string, unknown> | undefined;
  if (!manifestNode || !spineNode) throw new Error('EPUB manifest or spine not found.');

  const manifestItems = arrayOf((manifestNode['opf:item'] || manifestNode.item) as RawManifestItem | RawManifestItem[] | undefined);
  const manifest = manifestItems
    .map((item) => ({
      id: String(item['@_id'] || ''),
      href: String(item['@_href'] || ''),
      mediaType: String(item['@_media-type'] || '')
    }))
    .filter((item) => item.id && item.href);

  const spineItems = arrayOf((spineNode['opf:itemref'] || spineNode.itemref) as Array<{ '@_idref'?: string }> | { '@_idref'?: string } | undefined);
  const spine = spineItems.map((item) => String(item['@_idref'] || '')).filter(Boolean);

  return {
    opfPath: '',
    title: textValue(metadata['dc:title']),
    language: textValue(metadata['dc:language']),
    manifest,
    spine
  };
}

function scanTextNodes(
  html: string,
  documentId: string,
  filePath: string,
  chapter: string | undefined
): TranslationSegment[] {
  const segments: TranslationSegment[] = [];
  const tokenPattern = /<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g;
  const stack: string[] = [];
  let skippedDepth = 0;
  let match: RegExpExecArray | null;
  let textIndex = 0;

  while ((match = tokenPattern.exec(html)) !== null) {
    const token = match[0];
    const start = match.index;
    const end = start + token.length;

    if (token.startsWith('<')) {
      const tagMatch = /^<\s*(\/?)\s*([A-Za-z0-9:_-]+)/.exec(token);
      if (!tagMatch) continue;
      const isClosing = tagMatch[1] === '/';
      const tag = tagMatch[2]?.toLowerCase();
      if (!tag) continue;
      const isSelfClosing = /\/\s*>$/.test(token) || tag === 'br' || tag === 'img' || tag === 'hr' || tag === 'meta' || tag === 'link';

      if (isClosing) {
        if (SKIP_TAGS.has(tag) && skippedDepth > 0) skippedDepth -= 1;
        const stackIndex = stack.lastIndexOf(tag);
        if (stackIndex >= 0) stack.splice(stackIndex, 1);
      } else {
        if (SKIP_TAGS.has(tag)) skippedDepth += 1;
        if (!isSelfClosing) stack.push(tag);
      }
      continue;
    }

    if (skippedDepth > 0 || !/\S/.test(token)) continue;
    const parentTag = stack.at(-1) || 'body';
    const kind = /^h[1-6]$/.test(parentTag) ? 'heading' : 'text';
    const id = `seg_${fnv1a(`${documentId}|${filePath}|${start}|${end}|${textIndex}`)}`;
    segments.push({
      id,
      documentId,
      filePath,
      start,
      end,
      source: token,
      kind,
      contextPath: stack.join('/') || 'body',
      chapter
    });
    textIndex += 1;
  }

  return segments;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function placeholderXhtml(): Uint8Array {
  return encode('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title></title></head><body></body></html>\n');
}

function collectNcxSources(value: unknown, sources: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectNcxSources(item, sources);
    return sources;
  }
  if (!value || typeof value !== 'object') return sources;
  const record = value as Record<string, unknown>;
  const content = record.content;
  for (const item of arrayOf(content as { '@_src'?: string } | { '@_src'?: string }[] | undefined)) {
    if (typeof item?.['@_src'] === 'string') sources.push(item['@_src']);
  }
  for (const child of Object.values(record)) collectNcxSources(child, sources);
  return sources;
}

function addManifestItems(opfXml: string, items: Array<{ id: string; href: string }>): string {
  if (!items.length) return opfXml;
  const closingTag = /(\s*)<\/(?:opf:)?manifest\s*>/i.exec(opfXml);
  if (!closingTag || closingTag.index === undefined) return opfXml;
  const indent = closingTag[1] || '  ';
  const declarations = items
    .map((item) => `${indent}<item id="${escapeXmlAttribute(item.id)}" href="${escapeXmlAttribute(item.href)}" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const replacement = `${declarations}\n${closingTag[0]}`;
  return `${opfXml.slice(0, closingTag.index)}${replacement}${opfXml.slice(closingTag.index + closingTag[0].length)}`;
}

export class EpubAdapter implements DocumentAdapter {
  readonly format = 'epub' as const;

  async extract(source: DocumentSource): Promise<TranslationDocument> {
    const sourceBlob = new Blob([source.bytes as unknown as BlobPart]);
    const reader = new ZipReader(new BlobReader(sourceBlob));
    const entries = await reader.getEntries();
    const files: Record<string, Uint8Array> = {};
    const entryOrder: string[] = [];

    try {
      for (const entry of entries) {
        entryOrder.push(entry.filename);
        const blob = entry.directory ? new Blob([]) : await entry.getData!(new BlobWriter());
        files[entry.filename] = new Uint8Array(await blob.arrayBuffer());
      }
    } finally {
      await reader.close();
    }

    const containerBytes = files['META-INF/container.xml'];
    if (!containerBytes) throw new Error('EPUB META-INF/container.xml not found.');
    const container = new XMLParser({ ignoreAttributes: false }).parse(decode(containerBytes)) as Record<string, unknown>;
    const rootfiles = (container.container as { rootfiles?: { rootfile?: unknown } } | undefined)?.rootfiles;
    const rootfile = rootfiles?.rootfile;
    const rootfileValue = Array.isArray(rootfile) ? rootfile[0] : rootfile;
    const opfPath = String((rootfileValue as { '@_full-path'?: string } | undefined)?.['@_full-path'] || '');
    if (!opfPath || !files[opfPath]) throw new Error('EPUB OPF file not found.');

    const parsedPackage = parsePackage(decode(files[opfPath]));
    parsedPackage.opfPath = opfPath;
    const opfDirectory = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
    const spineIndexById = new Map(parsedPackage.spine.map((id, index) => [id, index]));
    const textFiles = new Set<string>();
    const missingManifestPaths: string[] = [];
    const entryFingerprint = entryOrder.map((name) => `${name}:${files[name]?.byteLength || 0}`).join('|');
    const documentId = `epub_${fnv1a(`${source.sourcePath}|${opfPath}|${entryFingerprint}`)}`;
    const segments: TranslationSegment[] = [];

    for (const item of parsedPackage.manifest) {
      if (!TEXT_MEDIA_TYPES.has(item.mediaType)) continue;
      const filePath = resolveZipPath(opfDirectory, item.href);
      const bytes = files[filePath];
      if (!bytes) {
        if (TEXT_MEDIA_TYPES.has(item.mediaType)) missingManifestPaths.push(filePath);
        continue;
      }
      textFiles.add(filePath);
      const chapter = spineIndexById.has(item.id) ? `spine-${spineIndexById.get(item.id)}` : undefined;
      segments.push(...scanTextNodes(decode(bytes), documentId, filePath, chapter));
    }

    const missingReferencedPaths: string[] = [];
    const ncxItem = parsedPackage.manifest.find((item) => item.mediaType === 'application/x-dtbncx+xml');
    if (ncxItem) {
      const ncxPath = resolveZipPath(opfDirectory, ncxItem.href);
      const ncxBytes = files[ncxPath];
      if (ncxBytes) {
        const ncx = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(decode(ncxBytes)) as unknown;
        const ncxDirectory = ncxPath.includes('/') ? ncxPath.slice(0, ncxPath.lastIndexOf('/')) : '';
        for (const source of collectNcxSources(ncx)) {
          const target = resolveZipPath(ncxDirectory, source);
          if (!target || files[target] || !/\.(?:xhtml?|html?)$/i.test(target)) continue;
          if (!missingReferencedPaths.includes(target)) missingReferencedPaths.push(target);
        }
      }
    }

    const metadata: Record<string, string> = { opfPath };
    if (parsedPackage.title) metadata.title = parsedPackage.title;
    if (parsedPackage.language) metadata.language = parsedPackage.language;

    return {
      id: documentId,
      sourcePath: source.sourcePath,
      format: 'epub',
      title: parsedPackage.title,
      sourceLanguage: parsedPackage.language,
      segments,
      metadata,
      state: { opfPath, entryOrder, files, textFiles, missingManifestPaths, missingReferencedPaths } satisfies EpubArchiveState
    };
  }

  async export(document: TranslationDocument, replacements: SegmentReplacement[]): Promise<Uint8Array> {
    if (document.format !== 'epub') throw new Error(`EpubAdapter cannot export ${document.format}.`);
    const state = document.state as EpubArchiveState;
    const segmentById = new Map(document.segments.map((segment) => [segment.id, segment]));
    const changesByFile = new Map<string, Array<{ start: number; end: number; source: string; target: string }>>();

    for (const replacement of replacements) {
      const segment = segmentById.get(replacement.segmentId);
      if (!segment) throw new Error(`Unknown segment: ${replacement.segmentId}`);
      if (replacement.source !== segment.source) throw new Error(`Source text mismatch for ${replacement.segmentId}.`);
      const changes = changesByFile.get(segment.filePath) || [];
      changes.push({ start: segment.start, end: segment.end, source: segment.source, target: replacement.target });
      changesByFile.set(segment.filePath, changes);
    }

    const modifiedFiles = new Map<string, Uint8Array>();
    for (const [filePath, changes] of changesByFile) {
      const original = decode(state.files[filePath] || new Uint8Array());
      let updated = original;
      for (const change of [...changes].sort((left, right) => right.start - left.start)) {
        if (updated.slice(change.start, change.end) !== change.source) {
          throw new Error(`EPUB text changed since extraction: ${filePath}:${change.start}`);
        }
        updated = `${updated.slice(0, change.start)}${change.target}${updated.slice(change.end)}`;
      }
      modifiedFiles.set(filePath, encode(updated));
    }

    const stateMissingManifestPaths = [...(state.missingManifestPaths || []), ...(state.missingReferencedPaths || [])];
    const generatedFiles = new Map<string, Uint8Array>();
    for (const filePath of stateMissingManifestPaths) {
      if (!state.files[filePath] && !modifiedFiles.has(filePath) && /\.(?:xhtml?|html?)$/i.test(filePath)) {
        generatedFiles.set(filePath, placeholderXhtml());
      }
    }

    const missingReferencedPaths = (state.missingReferencedPaths || []).filter((filePath) => /\.(?:xhtml?|html?)$/i.test(filePath));
    const originalOpfBytes = state.files[state.opfPath];
    if (missingReferencedPaths.length && originalOpfBytes) {
      const opfXml = decode(originalOpfBytes);
      const parsedPackage = parsePackage(opfXml);
      const opfDirectory = state.opfPath.includes('/') ? state.opfPath.slice(0, state.opfPath.lastIndexOf('/')) : '';
      const declaredPaths = new Set(parsedPackage.manifest.map((item) => resolveZipPath(opfDirectory, item.href)));
      const usedIds = new Set(parsedPackage.manifest.map((item) => item.id));
      const missingManifestItems: Array<{ id: string; href: string }> = [];
      for (const filePath of missingReferencedPaths) {
        if (declaredPaths.has(filePath)) continue;
        let id = `compat_${fnv1a(filePath)}`;
        let suffix = 2;
        while (usedIds.has(id)) id = `compat_${fnv1a(filePath)}_${suffix++}`;
        usedIds.add(id);
        declaredPaths.add(filePath);
        missingManifestItems.push({ id, href: relativeZipPath(opfDirectory, filePath) });
      }
      if (missingManifestItems.length) {
        modifiedFiles.set(state.opfPath, encode(addManifestItems(opfXml, missingManifestItems)));
      }
    }

    const writer = new ZipWriter(new BlobWriter('application/epub+zip'));
    try {
      for (const filePath of state.entryOrder) {
        const bytes = modifiedFiles.get(filePath) || generatedFiles.get(filePath) || state.files[filePath] || new Uint8Array();
        await writer.add(filePath, new BlobReader(new Blob([bytes as unknown as BlobPart])), { level: filePath === 'mimetype' ? 0 : 6 });
      }
      for (const [filePath, bytes] of generatedFiles) {
        if (!state.entryOrder.includes(filePath)) {
          await writer.add(filePath, new BlobReader(new Blob([bytes as unknown as BlobPart])), { level: 6 });
        }
      }
      const output = await writer.close();
      return new Uint8Array(await output.arrayBuffer());
    } catch (error) {
      await writer.close().catch(() => undefined);
      throw error;
    }
  }
}
