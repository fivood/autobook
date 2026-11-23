/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BehaviorSubject, Subject } from 'rxjs';

import type { ReaderSection } from '$lib/functions/rebase-sections';

export const sectionList$ = new BehaviorSubject<ReaderSection[]>([]);
export const sectionProgress$ = new Subject<Map<string, SectionWithProgress>>();
export const nextChapter$ = new Subject<string>();
export const tocIsOpen$ = new Subject<boolean>();

export type SectionWithProgress = ReaderSection & {
  progress: number;
};

export function getChapterData(
  sectionData: SectionWithProgress[]
): [SectionWithProgress[], number, string] {
  const mainChapters = sectionData.filter((section) => !section.parentChapter);

  let currentSection = sectionData.find((section) => section.progress < 100);

  if (!currentSection) {
    currentSection = sectionData[sectionData.length - 1];
  }

  const referenceId = currentSection.parentChapter || currentSection.reference;
  const currentChapterIndex = mainChapters.findIndex(
    (section) => section.reference === referenceId
  );

  return [mainChapters, currentChapterIndex, referenceId];
}
