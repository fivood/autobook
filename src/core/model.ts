export type DocumentFormat = 'epub' | 'html' | 'htmlz' | 'txt' | 'markdown' | 'mobi' | 'azw' | 'azw3' | 'pdf';

export type SegmentKind = 'text' | 'heading' | 'caption' | 'metadata';

export interface TranslationSegment {
  id: string;
  documentId: string;
  filePath: string;
  start: number;
  end: number;
  source: string;
  target?: string;
  kind: SegmentKind;
  contextPath: string;
  chapter?: string;
}

export interface TranslationDocument {
  id: string;
  sourcePath: string;
  format: DocumentFormat;
  title?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  segments: TranslationSegment[];
  metadata: Record<string, string>;
  /** Adapter-owned state needed for a lossless export. */
  state: unknown;
}

export interface SegmentReplacement {
  segmentId: string;
  source: string;
  target: string;
}

export interface DocumentAdapter {
  readonly format: DocumentFormat;
  extract(source: DocumentSource): Promise<TranslationDocument>;
  export(document: TranslationDocument, replacements: SegmentReplacement[]): Promise<Uint8Array>;
}

export interface DocumentSource {
  /** A stable display name or path used in document IDs and logs. */
  sourcePath: string;
  bytes: Uint8Array;
}
