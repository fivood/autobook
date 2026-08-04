export type GlossaryRule = 'preferred' | 'forbidden' | 'do-not-translate';

export interface GlossaryEntry {
  id: string;
  source: string;
  target: string;
  rule: GlossaryRule;
  note?: string;
  caseSensitive?: boolean;
  approved: boolean;
}

export interface GlossaryValidationIssue {
  entryId: string;
  source: string;
  target: string;
  message: string;
}

export interface GlossaryCandidate {
  source: string;
  occurrences: number;
  reason: 'proper-name' | 'acronym' | 'repeated-term';
  sampleSegmentIds: string[];
}

export interface GlossaryCandidateOptions {
  minOccurrences?: number;
  maxCandidates?: number;
}

const CANDIDATE_PATTERN = /\b(?:[A-Z][A-Za-z0-9]+(?:[’'-][A-Za-z0-9]+)?(?:\s+[A-Z][A-Za-z0-9]+(?:[’'-][A-Za-z0-9]+)?){0,3}|[A-Z][A-Z0-9_-]{2,})\b/g;
const COMMON_SENTENCE_WORDS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'And', 'But', 'For', 'From', 'With', 'When', 'Where', 'What', 'How',
  'Not', 'Then', 'There', 'They', 'Their', 'You', 'Your', 'She', 'Her', 'His', 'Its', 'One', 'Chapter'
]);

export function extractGlossaryCandidates(
  segments: readonly { id: string; source: string }[],
  options: GlossaryCandidateOptions = {}
): GlossaryCandidate[] {
  const minOccurrences = options.minOccurrences ?? 1;
  const candidates = new Map<string, GlossaryCandidate>();

  for (const segment of segments) {
    const seenInSegment = new Set<string>();
    for (const match of segment.source.matchAll(CANDIDATE_PATTERN)) {
      const source = match[0].trim();
      if (COMMON_SENTENCE_WORDS.has(source) || source.length < 3 || seenInSegment.has(source)) continue;
      seenInSegment.add(source);
      const reason = source === source.toUpperCase() ? 'acronym' : source.includes(' ') || /^[A-Z]/.test(source) ? 'proper-name' : 'repeated-term';
      const existing = candidates.get(source);
      if (existing) {
        existing.occurrences += 1;
        if (existing.sampleSegmentIds.length < 3) existing.sampleSegmentIds.push(segment.id);
      } else {
        candidates.set(source, { source, occurrences: 1, reason, sampleSegmentIds: [segment.id] });
      }
    }
  }

  return [...candidates.values()]
    .filter((candidate) => candidate.occurrences >= minOccurrences)
    .sort((left, right) => right.occurrences - left.occurrences || left.source.localeCompare(right.source))
    .slice(0, options.maxCandidates ?? 200);
}

export function buildGlossaryPrompt(entries: readonly GlossaryEntry[]): string {
  const approved = entries.filter((entry) => entry.approved);
  if (!approved.length) return 'No approved glossary entries.';

  return approved
    .map((entry) => {
      const rule = entry.rule === 'do-not-translate' ? 'keep exactly' : entry.rule;
      const note = entry.note ? `; note: ${entry.note}` : '';
      return `- ${entry.source} => ${entry.target} (${rule}${note})`;
    })
    .join('\n');
}

export function validateGlossary(
  source: string,
  target: string,
  entries: readonly GlossaryEntry[]
): GlossaryValidationIssue[] {
  const issues: GlossaryValidationIssue[] = [];

  for (const entry of entries) {
    if (!entry.approved) continue;
    const sourceHasTerm = entry.caseSensitive
      ? source.includes(entry.source)
      : source.toLocaleLowerCase().includes(entry.source.toLocaleLowerCase());
    if (!sourceHasTerm) continue;

    const targetHasPreferred = entry.caseSensitive
      ? target.includes(entry.target)
      : target.toLocaleLowerCase().includes(entry.target.toLocaleLowerCase());

    if (entry.rule === 'forbidden' && targetHasPreferred) {
      issues.push({
        entryId: entry.id,
        source: entry.source,
        target: entry.target,
        message: `Forbidden target term found: ${entry.target}`
      });
    } else if (entry.rule !== 'forbidden' && !targetHasPreferred) {
      issues.push({
        entryId: entry.id,
        source: entry.source,
        target: entry.target,
        message: `Preferred target term missing: ${entry.target}`
      });
    }
  }

  return issues;
}
