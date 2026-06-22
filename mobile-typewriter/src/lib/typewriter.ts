// Typewriter engine. Reveals one character every `1000/charsPerSec` ms using
// requestAnimationFrame so we tick smoothly across speed changes. The store
// exposes the revealed prefix length; the view slices flatText accordingly.

import { writable, type Writable } from 'svelte/store';

export interface TypewriterState {
  revealed: number;
  total: number;
  playing: boolean;
  chapterIdx: number;
}

export interface TypewriterEngine {
  state: Writable<TypewriterState>;
  start(): void;
  stop(): void;
  toggle(): void;
  seek(charIndex: number): void;
  setSpeed(charsPerSec: number): void;
  setStopAtChapter(stop: boolean): void;
  setChapterBoundaries(starts: number[]): void;
  destroy(): void;
}

export function createTypewriter(opts: { total: number; speed: number }): TypewriterEngine {
  const state = writable<TypewriterState>({
    revealed: 0,
    total: opts.total,
    playing: false,
    chapterIdx: 0
  });

  let charsPerSec = opts.speed;
  let stopAtChapter = false;
  let chapterStarts: number[] = [0];

  let rafId = 0;
  let lastTick = 0;
  let revealAccumulator = 0;
  let currentRevealed = 0;
  let currentTotal = opts.total;
  let currentChapter = 0;

  state.subscribe((s) => {
    currentRevealed = s.revealed;
    currentTotal = s.total;
    currentChapter = s.chapterIdx;
  });

  const chapterOf = (pos: number): number => {
    let idx = 0;
    for (let i = chapterStarts.length - 1; i >= 0; i--) {
      if (pos >= chapterStarts[i]) {
        idx = i;
        break;
      }
    }
    return idx;
  };

  const tick = (now: number) => {
    if (!lastTick) lastTick = now;
    // Cap the delta so a tab returning from background (browser throttles
    // rAF when hidden) doesn't dump a huge chunk of revealed chars all at
    // once — we'd rather pretend no time passed than spoil a paragraph.
    const dt = Math.min(now - lastTick, 1000);
    lastTick = now;
    revealAccumulator += (charsPerSec * dt) / 1000;
    let stepped = Math.floor(revealAccumulator);
    if (stepped > 0) {
      revealAccumulator -= stepped;
      let nextRevealed = Math.min(currentTotal, currentRevealed + stepped);

      if (stopAtChapter) {
        const startChapter = chapterOf(currentRevealed);
        const nextChapterStart = chapterStarts[startChapter + 1];
        if (typeof nextChapterStart === 'number' && nextRevealed >= nextChapterStart) {
          nextRevealed = nextChapterStart;
          state.update((s) => ({
            ...s,
            revealed: nextRevealed,
            chapterIdx: chapterOf(nextRevealed),
            playing: false
          }));
          cancelTick();
          return;
        }
      }

      const newChapter = chapterOf(nextRevealed);
      state.update((s) => ({ ...s, revealed: nextRevealed, chapterIdx: newChapter }));
      if (nextRevealed >= currentTotal) {
        state.update((s) => ({ ...s, playing: false }));
        cancelTick();
        return;
      }
    }
    rafId = requestAnimationFrame(tick);
  };

  const cancelTick = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    lastTick = 0;
    revealAccumulator = 0;
  };

  return {
    state,
    start() {
      if (rafId) return;
      state.update((s) => ({ ...s, playing: true }));
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      state.update((s) => ({ ...s, playing: false }));
      cancelTick();
    },
    toggle() {
      if (rafId) this.stop();
      else this.start();
    },
    seek(charIndex: number) {
      const clamped = Math.max(0, Math.min(currentTotal, Math.floor(charIndex)));
      state.update((s) => ({ ...s, revealed: clamped, chapterIdx: chapterOf(clamped) }));
    },
    setSpeed(s: number) {
      charsPerSec = Math.max(1, Math.min(60, s));
    },
    setStopAtChapter(v: boolean) {
      stopAtChapter = v;
    },
    setChapterBoundaries(starts: number[]) {
      chapterStarts = starts.length ? starts : [0];
    },
    destroy() {
      cancelTick();
    }
  };
}
