<script lang="ts">
  import { faCheckCircle, faCircleInfo } from '@fortawesome/free-solid-svg-icons';
  import { faCircle as faCircleRegular } from '@fortawesome/free-regular-svg-icons';
  import BookCard from '$lib/components/book-card/book-card.svelte';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import type { BookCardId } from '$lib/data/book-id';
  import Popover from '$lib/components/popover/popover.svelte';
  import { bookCoverMinWidth$ } from '$lib/data/store';
  import { activateOnKeyup } from '$lib/functions/utils';
  import { t, tImmediate } from '$lib/i18n';
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';

  export let bookCards: BookCardProps[] = [];
  export let currentBookId: number | undefined;
  export let selectedBookIds: ReadonlySet<BookCardId>;
  export let selectMode = false;

  $: minWidth = Math.max(110, Math.min(360, Number($bookCoverMinWidth$) || 170));

  const dispatch = createEventDispatcher<{
    bookClick: { id: BookCardId; shiftKey: boolean; toggleKey: boolean };
    marqueeSelect: { ids: BookCardId[] };
    removeBookClick: { id: BookCardId };
    cardDragStart: { id: BookCardId; event: DragEvent };
  }>();

  let hoveringBookId: BookCardId | undefined;

  // Hover-detail popover: shows on 600ms hover hold, hides instantly on
  // leave or click. Skipped while in select mode to keep the click target
  // unambiguous, and on touch input where there's no real hover semantic.
  let detailId: number | undefined;
  let detailPos: { left: number; top: number; placement: 'right' | 'left' | 'below' } = {
    left: 0,
    top: 0,
    placement: 'right'
  };
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  const HOVER_DELAY_MS = 600;
  const POPOVER_W = 280;
  const POPOVER_H_MAX = 360;
  const GAP = 12;

  $: detailCard = detailId != null ? bookCards.find((c) => c.id === detailId) : undefined;

  // Format label for the hover popover: prefer originalFormat (set at
  // import time from 1.20.2), else sniff the filename extension from the
  // title (works for TXT/MD/CBZ imports that keep the extension).
  $: detailFormat = (() => {
    if (!detailCard) return '';
    const raw = detailCard.originalFormat
      || detailCard.title.match(/\.(epub|txt|htmlz|mobi|azw3?|pdf|cbz|cbr|cb7|cbt|markdown|md)$/i)?.[1]
      || '';
    const up = raw.toUpperCase();
    return up === 'MARKDOWN' ? 'MD' : up;
  })();

  function onCardEnter(card: BookCardProps, ev: MouseEvent) {
    // Keyed on the mode, not on `selectedBookIds.size`: with the mode on but
    // nothing selected yet, the hover delete button used to appear over the
    // card you were about to select — one pixel of aim away from deleting a
    // book instead of ticking it.
    if (selectMode) return;
    hoveringBookId = card.id;
    clearTimeout(hoverTimer);
    const cardEl = (ev.currentTarget as HTMLElement) ?? null;
    hoverTimer = setTimeout(() => {
      if (!cardEl) return;
      const rect = cardEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let placement: 'right' | 'left' | 'below' = 'right';
      let left = rect.right + GAP;
      let top = rect.top;
      if (left + POPOVER_W > vw - 8) {
        if (rect.left - POPOVER_W - GAP >= 8) {
          placement = 'left';
          left = rect.left - POPOVER_W - GAP;
        } else {
          placement = 'below';
          left = Math.max(8, Math.min(rect.left, vw - POPOVER_W - 8));
          top = rect.bottom + GAP;
        }
      }
      if (top + POPOVER_H_MAX > vh - 8) {
        top = Math.max(8, vh - POPOVER_H_MAX - 8);
      }
      detailPos = { left, top, placement };
      detailId = card.id;
    }, HOVER_DELAY_MS);
  }

  function onCardLeave() {
    hoveringBookId = undefined;
    clearTimeout(hoverTimer);
    detailId = undefined;
  }

  function onBookCardClick(id: BookCardId, ev?: MouseEvent) {
    clearTimeout(hoverTimer);
    detailId = undefined;
    dispatch('bookClick', {
      id,
      shiftKey: !!ev?.shiftKey,
      toggleKey: !!(ev?.ctrlKey || ev?.metaKey)
    });
  }

  /**
   * Rubber-band selection, the way a file manager does it: in select mode,
   * press on the grid and drag a box over the covers. Picking a run of books
   * used to be one click per book, or the select-all button and then
   * un-picking what you didn't want.
   *
   * Anchors are kept in page coordinates so scrolling mid-drag doesn't drag
   * the box along with the viewport.
   */
  const MARQUEE_THRESHOLD_PX = 4;
  let marqueeFrom: { x: number; y: number; additive: boolean } | null = null;
  /** Selection as it stood when this drag started, for modifier-drags. */
  let marqueeBase: ReadonlySet<BookCardId> = new Set();
  let marqueeTo: { x: number; y: number } | null = null;
  let marqueeActive = false;
  /** A drag ends with a click event; without this it would toggle a card. */
  let swallowNextClick = false;

  $: marqueeBox =
    marqueeActive && marqueeFrom && marqueeTo
      ? {
          left: Math.min(marqueeFrom.x, marqueeTo.x) - window.scrollX,
          top: Math.min(marqueeFrom.y, marqueeTo.y) - window.scrollY,
          width: Math.abs(marqueeFrom.x - marqueeTo.x),
          height: Math.abs(marqueeFrom.y - marqueeTo.y)
        }
      : null;

  function onGridMouseDown(event: MouseEvent) {
    if (!selectMode || event.button !== 0) return;
    marqueeFrom = {
      x: event.pageX,
      y: event.pageY,
      additive: event.ctrlKey || event.metaKey || event.shiftKey
    };
    marqueeTo = null;
    marqueeActive = false;
    marqueeBase = new Set(selectedBookIds);
    // Also stops the card's own HTML5 drag from hijacking the gesture.
    event.preventDefault();
    window.addEventListener('mousemove', onMarqueeMove);
    window.addEventListener('mouseup', onMarqueeUp);
  }

  function onMarqueeMove(event: MouseEvent) {
    if (!marqueeFrom) return;
    marqueeTo = { x: event.pageX, y: event.pageY };
    if (
      !marqueeActive &&
      Math.hypot(marqueeTo.x - marqueeFrom.x, marqueeTo.y - marqueeFrom.y) < MARQUEE_THRESHOLD_PX
    ) {
      return;
    }
    marqueeActive = true;
    const inBox = idsInMarquee();
    dispatch('marqueeSelect', {
      ids: marqueeFrom.additive ? [...new Set([...marqueeBase, ...inBox])] : inBox
    });
  }

  function onMarqueeUp() {
    window.removeEventListener('mousemove', onMarqueeMove);
    window.removeEventListener('mouseup', onMarqueeUp);
    swallowNextClick = marqueeActive;
    marqueeFrom = null;
    marqueeTo = null;
    marqueeActive = false;
  }

  function idsInMarquee(): BookCardId[] {
    if (!marqueeFrom || !marqueeTo) return [];
    const left = Math.min(marqueeFrom.x, marqueeTo.x);
    const right = Math.max(marqueeFrom.x, marqueeTo.x);
    const top = Math.min(marqueeFrom.y, marqueeTo.y);
    const bottom = Math.max(marqueeFrom.y, marqueeTo.y);
    const hit: BookCardId[] = [];
    document.querySelectorAll('.book-grid-item[data-book-id]').forEach((node) => {
      const box = node.getBoundingClientRect();
      const cardLeft = box.left + window.scrollX;
      const cardTop = box.top + window.scrollY;
      if (
        cardLeft < right &&
        cardLeft + box.width > left &&
        cardTop < bottom &&
        cardTop + box.height > top
      ) {
        hit.push(Number(node.getAttribute('data-book-id')) as BookCardId);
      }
    });
    return hit;
  }

  function onGridClickCapture(event: MouseEvent) {
    if (!swallowNextClick) return;
    swallowNextClick = false;
    event.stopPropagation();
    event.preventDefault();
  }

  function getCardDateInfo(dateTime: number) {
    return dateTime ? new Date(dateTime).toLocaleString() : tImmediate('bookCard.noData');
  }

  function relativeTime(ms: number): string {
    if (!ms) return tImmediate('bookCard.never');
    const diff = Date.now() - ms;
    if (diff < 0) return tImmediate('bookCard.justNow');
    const s = Math.floor(diff / 1000);
    if (s < 60) return tImmediate('bookCard.justNow');
    const m = Math.floor(s / 60);
    if (m < 60) return tImmediate('bookCard.minutesAgo', { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return tImmediate('bookCard.hoursAgo', { n: h });
    const d = Math.floor(h / 24);
    if (d < 30) return tImmediate('bookCard.daysAgo', { n: d });
    const mo = Math.floor(d / 30);
    if (mo < 12) return tImmediate('bookCard.monthsAgo', { n: mo });
    return tImmediate('bookCard.yearsAgo', { n: Math.floor(mo / 12) });
  }

  function formatChars(n: number): string {
    if (!n) return '—';
    if (n < 10_000) return tImmediate('bookCard.chars', { n: n.toLocaleString() });
    return tImmediate('bookCard.wanChars', { n: (n / 10_000).toFixed(1) });
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<!-- The capture handler is not an affordance: it only cancels the click that
     ends a drag, so there is nothing for a keyboard user to activate. -->
<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
  class="book-grid gap-5 pb-4"
  class:select-dragging={marqueeActive}
  style="--book-card-min: {minWidth}px;"
  on:mousedown={onGridMouseDown}
  on:click|capture={onGridClickCapture}
>
  {#each bookCards as bookCard (bookCard.id)}
    <div
      role="banner"
      class="book-grid-item relative cursor-grab active:cursor-grabbing"
      class:select-mode={selectMode}
      class:opacity-60={bookCard.isPlaceholder}
      data-book-id={bookCard.id}
      draggable={!selectMode}
      title={$t('bookCard.dragToFolder')}
      on:dragstart={(ev) => dispatch('cardDragStart', { id: bookCard.id, event: ev })}
      on:mouseenter={(ev) => onCardEnter(bookCard, ev)}
      on:mouseleave={onCardLeave}
    >
      <div
        class="mdc-elevation--z1 hover:mdc-elevation--z8 mdc-elevation-transition relative overflow-hidden"
        class:rounded-tl-xl={bookCard.id === currentBookId}
        class:mdc-elevation--z4={selectedBookIds.has(bookCard.id) || bookCard.id === currentBookId}
      >
        <BookCard {...bookCard} on:click={(ev) => onBookCardClick(bookCard.id, ev)} />

        {#if selectedBookIds.has(bookCard.id)}
          <div
            tabindex="0"
            role="button"
            title={$t('bookCard.selectedTitle')}
            class="absolute inset-0 bg-current/10"
            on:click={(ev) => onBookCardClick(bookCard.id, ev)}
            on:keyup={activateOnKeyup}
          >
            <Fa
              class="absolute left-2 top-2 z-[3] flex rounded-full bg-menu text-xl text-menu"
              icon={faCheckCircle}
            />
          </div>
        {:else if selectMode}
          <!-- `bg-menu` behind the glyph on purpose: the tick is drawn in the
               menu foreground, which is a pale cream — on a white or light
               cover it disappeared completely, so half the grid looked
               unticked while it was selected. `z-[3]` because the format chip
               owns the same corner at z-index 2 and hid the tick outright on
               every PDF / CBZ / TXT card. An empty tick on every card: without it the mode is invisible
               until the first click, so a click meant to open a book selects
               it instead and nothing on screen explains why. -->
          <Fa
            class="pointer-events-none absolute left-2 top-2 z-[3] flex rounded-full bg-menu text-xl text-menu opacity-70"
            icon={faCircleRegular}
          />
        {/if}
      </div>
      {#if selectedBookIds.has(bookCard.id)}
        <div class="absolute top-10 left-2" title={$t('bookCard.clickDetails')}>
          <Popover placement="right" fallbackPlacements={['bottom']} yOffset={5}>
            <Fa
              slot="icon"
              class="mdc-elevation--z2 hover:mdc-elevation--z8 mdc-elevation-transition left-2 top-10 rounded-full bg-menu text-xl text-menu"
              icon={faCircleInfo}
            />
            <div class="p-4" slot="content">
              <div>{$t('bookCard.wordCount')}:</div>
              <div class="w-40">{bookCard.characters || $t('bookCard.noData')}</div>
              <div class="mt-4">{$t('bookCard.lastRead')}:</div>
              <div class="w-40">{getCardDateInfo(bookCard.lastBookOpen)}</div>
              <div class="mt-4">{$t('bookCard.bookmarkTime')}:</div>
              <div class="w-40">{getCardDateInfo(bookCard.lastBookmarkModified)}</div>
              <div class="mt-4">{$t('bookCard.lastModified')}:</div>
              <div class="w-40">{getCardDateInfo(bookCard.lastBookModified)}</div>
            </div>
          </Popover>
        </div>
      {/if}
      {#if bookCard.id === hoveringBookId}
        <div
          tabindex="0"
          role="button"
          class="mdc-elevation--z2 hover:mdc-elevation--z8 mdc-elevation-transition absolute top-1 right-1 h-6 w-6 rounded-full"
          style="background:var(--danger-color);"
          on:click={() => dispatch('removeBookClick', { id: bookCard.id })}
          on:keyup={activateOnKeyup}
        >
          <svg role="img" class="w-full" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 504 504">
            <path
              class="fill-current text-white"
              d="M369.6 313.1c4.7 4.7 4.7 12.3 0 17L330 369.6c-4.7 4.7-12.3 4.7-17 0L248 304l-65.1 65.6c-4.7 4.7-12.3 4.7-17 0L126.4 330c-4.7-4.7-4.7-12.3 0-17l65.6-65-65.6-65.1c-4.7-4.7-4.7-12.3 0-17l39.6-39.6c4.7-4.7 12.3-4.7 17 0l65 65.7 65.1-65.6c4.7-4.7 12.3-4.7 17 0l39.6 39.6c4.7 4.7 4.7 12.3 0 17L304 248l65.6 65.1z"
            />
          </svg>
        </div>
      {/if}
    </div>
  {/each}
</div>

{#if marqueeBox}
  <div
    class="marquee"
    style="left:{marqueeBox.left}px;top:{marqueeBox.top}px;width:{marqueeBox.width}px;height:{marqueeBox.height}px;"
  ></div>
{/if}

{#if detailCard}
  <div
    class="detail-popover menu-surface"
    style="left:{detailPos.left}px;top:{detailPos.top}px;"
    role="tooltip"
  >
    <div class="detail-title" title={detailCard.title}>{detailCard.title}</div>
    <div class="detail-grid">
      {#if detailFormat}
        <span>{$t('bookCard.format')}</span><span>{detailFormat}</span>
      {/if}
      <span>{$t('bookCard.wordCount')}</span><span>{formatChars(detailCard.characters)}</span>
      <span>{$t('bookCard.progress')}</span><span>
        {Math.round((detailCard.progress || 0) * 100)}%
        {#if detailCard.characters && detailCard.progress}
          <span class="opacity-60">· {$t('bookCard.remaining', { n: formatChars(detailCard.characters - Math.round(detailCard.characters * detailCard.progress)) })}</span>
        {/if}
      </span>
      <span>{$t('bookCard.lastRead')}</span><span title={getCardDateInfo(detailCard.lastBookOpen)}>{relativeTime(detailCard.lastBookOpen)}</span>
      <span>{$t('bookCard.bookmarkTime')}</span><span title={getCardDateInfo(detailCard.lastBookmarkModified)}>{relativeTime(detailCard.lastBookmarkModified)}</span>
      <span>{$t('bookCard.lastModified')}</span><span title={getCardDateInfo(detailCard.lastBookModified)}>{relativeTime(detailCard.lastBookModified)}</span>
    </div>
  </div>
{/if}

<style>
  /* Fluid book grid: each card targets ~170px min width and the grid
     fits as many columns as the viewport allows. Falls back to bigger
     cards at narrower widths so a 380px mobile shows ~2 wide, a 1920px
     desktop shows ~9. Avoids the previous hard cap at 5 columns. */
  .book-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--book-card-min, 170px), 1fr));
    justify-content: start;
  }

  /* Off-screen cards skip layout + paint. Card is aspect 2:3 so height
     tracks column width; --book-card-min is the min-width, so
     min-height ≈ 1.5×min-width. `auto` lets the browser cache the actual
     rendered size after the first render, so scroll position stays true
     as the user pans. Impact scales with library size — for 1000-book
     libraries the manage page's initial layout drops from O(n) to
     O(viewport). */
  /* The format chip owns the same corner as the selection tick, and in
     select mode the tick is the thing you are reading. Hidden rather than
     stacked: overlapping the two turned "PDF" into an unreadable smear. */
  .select-mode :global(.format-chip) {
    opacity: 0;
  }

  .book-grid-item {
    content-visibility: auto;
    contain-intrinsic-size: auto calc(var(--book-card-min, 170px) * 1.5);
  }
  @media (max-width: 480px) {
    /* Cap min-width on narrow screens so we never end up with a single
       absurdly wide column when the user has bumped --book-card-min up. */
    .book-grid {
      grid-template-columns: repeat(auto-fill, minmax(min(var(--book-card-min, 170px), 160px), 1fr));
    }
  }

  .marquee {
    position: fixed;
    z-index: 30;
    pointer-events: none;
    border: 1px solid currentColor;
    background: color-mix(in srgb, currentColor 12%, transparent);
    border-radius: 2px;
  }

  /* No text cursor and no accidental text selection while dragging a box. */
  .select-dragging {
    user-select: none;
    cursor: crosshair;
  }

  .detail-popover {
    position: fixed;
    z-index: 40;
    width: 280px;
    padding: 0.75rem 0.9rem;
    font-size: 0.875rem;
    pointer-events: none;
    animation: popoverIn 0.12s ease-out;
  }
  @keyframes popoverIn {
    from {
      opacity: 0;
      transform: translateY(2px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .detail-title {
    font-weight: 600;
    font-size: 0.88rem;
    line-height: 1.35;
    margin-bottom: 0.5rem;
    overflow: hidden;
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .detail-grid {
    display: grid;
    grid-template-columns: 4.5rem 1fr;
    gap: 0.25rem 0.6rem;
    align-items: baseline;
  }
  .detail-grid > span:nth-child(odd) {
    opacity: 0.55;
    font-size: 0.7rem;
  }
  @media (hover: none) {
    /* Touch devices have no real hover — suppress to avoid stuck popovers
       on long-press / scroll-pass-by. */
    .detail-popover {
      display: none;
    }
  }
</style>
