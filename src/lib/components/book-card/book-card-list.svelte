<script lang="ts">
  import { faCheckCircle, faCircleInfo } from '@fortawesome/free-solid-svg-icons';
  import BookCard from '$lib/components/book-card/book-card.svelte';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import Popover from '$lib/components/popover/popover.svelte';
  import { bookCoverMinWidth$ } from '$lib/data/store';
  import { dummyFn } from '$lib/functions/utils';
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';

  export let bookCards: BookCardProps[] = [];
  export let currentBookId: number | undefined;
  export let selectedBookIds: ReadonlySet<number>;

  $: minWidth = Math.max(110, Math.min(360, Number($bookCoverMinWidth$) || 170));

  const dispatch = createEventDispatcher<{
    bookClick: { id: number };
    removeBookClick: { id: number };
    cardDragStart: { id: number; event: DragEvent };
  }>();

  let hoveringBookId: number | undefined;

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

  $: if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[autobook:dbg] BookCardList received bookCards progress=',
      bookCards.map((c) => ({ id: c.id, title: c.title.slice(0, 20), progress: c.progress })));
  }
  $: if (import.meta.env.DEV && detailCard) {
    // eslint-disable-next-line no-console
    console.log('[autobook:dbg] detailCard reactive', { id: detailCard.id, progress: detailCard.progress });
  }

  function onCardEnter(card: BookCardProps, ev: MouseEvent) {
    if (selectedBookIds.size) return;
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

  function onBookCardClick(id: number) {
    clearTimeout(hoverTimer);
    detailId = undefined;
    dispatch('bookClick', { id });
  }

  function getCardDateInfo(dateTime: number) {
    return dateTime ? new Date(dateTime).toLocaleString() : '无数据';
  }

  function relativeTime(ms: number): string {
    if (!ms) return '从未';
    const diff = Date.now() - ms;
    if (diff < 0) return '刚才';
    const s = Math.floor(diff / 1000);
    if (s < 60) return '刚才';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} 分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时前`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} 天前`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo} 个月前`;
    return `${Math.floor(mo / 12)} 年前`;
  }

  function formatChars(n: number): string {
    if (!n) return '—';
    if (n < 10_000) return `${n.toLocaleString()} 字`;
    return `${(n / 10_000).toFixed(1)} 万字`;
  }
</script>

<div class="book-grid gap-5 pb-4" style="--book-card-min: {minWidth}px;">
  {#each bookCards as bookCard (bookCard.id)}
    <div
      role="banner"
      class="relative cursor-grab active:cursor-grabbing"
      class:opacity-60={bookCard.isPlaceholder}
      draggable="true"
      title="可拖入左侧分类"
      on:dragstart={(ev) => dispatch('cardDragStart', { id: bookCard.id, event: ev })}
      on:mouseenter={(ev) => onCardEnter(bookCard, ev)}
      on:mouseleave={onCardLeave}
    >
      <div
        class="mdc-elevation--z1 hover:mdc-elevation--z8 mdc-elevation-transition relative overflow-hidden"
        class:rounded-tl-xl={bookCard.id === currentBookId}
        class:mdc-elevation--z4={selectedBookIds.has(bookCard.id) || bookCard.id === currentBookId}
      >
        <BookCard {...bookCard} on:click={() => onBookCardClick(bookCard.id)} />

        {#if selectedBookIds.has(bookCard.id)}
          <div
            tabindex="0"
            role="button"
            title="已选中书籍"
            class="absolute inset-0 bg-gray-700 bg-opacity-20"
            on:click={() => onBookCardClick(bookCard.id)}
            on:keyup={dummyFn}
          >
            <Fa class="absolute left-2 top-2 flex text-xl text-white" icon={faCheckCircle} />
          </div>
        {/if}
      </div>
      {#if selectedBookIds.has(bookCard.id)}
        <div class="absolute top-10 left-2" title="点击查看详情">
          <Popover placement="right" fallbackPlacements={['bottom']} yOffset={5}>
            <Fa
              slot="icon"
              class="mdc-elevation--z2 hover:mdc-elevation--z8 mdc-elevation-transition left-2 top-10 rounded-full bg-blue-400 text-xl text-white"
              icon={faCircleInfo}
            />
            <div class="p-4" slot="content">
              <div>字数:</div>
              <div class="w-40">{bookCard.characters || '无数据'}</div>
              <div class="mt-4">上次阅读:</div>
              <div class="w-40">{getCardDateInfo(bookCard.lastBookOpen)}</div>
              <div class="mt-4">书签时间:</div>
              <div class="w-40">{getCardDateInfo(bookCard.lastBookmarkModified)}</div>
              <div class="mt-4">最后更新:</div>
              <div class="w-40">{getCardDateInfo(bookCard.lastBookModified)}</div>
            </div>
          </Popover>
        </div>
      {/if}
      {#if bookCard.id === hoveringBookId}
        <div
          tabindex="0"
          role="button"
          class="mdc-elevation--z2 hover:mdc-elevation--z8 mdc-elevation-transition absolute top-1 right-1 h-6 w-6 rounded-full bg-red-400"
          on:click={() => dispatch('removeBookClick', { id: bookCard.id })}
          on:keyup={dummyFn}
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

{#if detailCard}
  <div
    class="detail-popover"
    style="left:{detailPos.left}px;top:{detailPos.top}px;"
    role="tooltip"
  >
    <div class="detail-title" title={detailCard.title}>{detailCard.title}</div>
    <div class="detail-grid">
      <span>字数</span><span>{formatChars(detailCard.characters)}</span>
      <span>进度</span><span>
        {Math.round((detailCard.progress || 0) * 100)}%
        {#if detailCard.characters && detailCard.progress}
          <span class="opacity-60">· 剩 {formatChars(detailCard.characters - Math.round(detailCard.characters * detailCard.progress))}</span>
        {/if}
      </span>
      <span>上次阅读</span><span title={getCardDateInfo(detailCard.lastBookOpen)}>{relativeTime(detailCard.lastBookOpen)}</span>
      <span>书签时间</span><span title={getCardDateInfo(detailCard.lastBookmarkModified)}>{relativeTime(detailCard.lastBookmarkModified)}</span>
      <span>最后更新</span><span title={getCardDateInfo(detailCard.lastBookModified)}>{relativeTime(detailCard.lastBookModified)}</span>
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
  @media (max-width: 480px) {
    /* Cap min-width on narrow screens so we never end up with a single
       absurdly wide column when the user has bumped --book-card-min up. */
    .book-grid {
      grid-template-columns: repeat(auto-fill, minmax(min(var(--book-card-min, 170px), 160px), 1fr));
    }
  }

  .detail-popover {
    position: fixed;
    z-index: 40;
    width: 280px;
    padding: 0.75rem 0.9rem;
    background: var(--menu-background, rgba(0, 0, 0, 0.88));
    color: var(--menu-foreground, #fff);
    border-radius: 0.6rem;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.3);
    font-size: 0.78rem;
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
