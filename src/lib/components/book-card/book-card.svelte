<script lang="ts">
  import { faImage } from '@fortawesome/free-regular-svg-icons';
  import { onDestroy } from 'svelte';
  import Fa from 'svelte-fa';
  import { t } from '$lib/i18n';

  export let imagePath: string | Blob;
  export let title: string;
  export let progress: number;
  export let lastBookOpen = 0;

  let objectUrl = '';

  onDestroy(() => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  });

  function convertImagePath(value: string | Blob) {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = '';
    }
    if (typeof value !== 'string') {
      objectUrl = URL.createObjectURL(
        value.type ? value : new Blob([value], { type: 'image/jpeg' })
      );

      return objectUrl;
    }

    return value;
  }

  function mapImagePathFactory() {
    let prevValue: string | Blob | undefined;
    let prevResponse: string | undefined;

    const isEqual = (newValue: string | Blob) => {
      if (!prevValue) return false;
      if (prevValue instanceof Blob && newValue instanceof Blob) {
        return prevValue.type === newValue.type && prevValue.size === newValue.size;
      }
      if (typeof prevValue !== 'object' || typeof newValue !== 'object') {
        return prevValue === newValue;
      }
      return false;
    };

    return (value: string | Blob) => {
      if (isEqual(value)) return prevResponse as string;

      prevValue = value;
      prevResponse = convertImagePath(value);

      return prevResponse;
    };
  }

  const mapImagePath = mapImagePathFactory();

  let imgEl: HTMLImageElement | undefined;
  let imageLoading = true;

  $: imageLoadComplete = imgEl?.complete && !imageLoading;
  $: alt = `${title}_cover`;

  /** Detect a book file extension hidden in the title, fall back to BOOK. */
  $: detectedFormat = (() => {
    const match = title.match(/\.(epub|txt|htmlz|mobi|azw3?|pdf|markdown|md)$/i);
    if (!match) return 'BOOK';
    const ext = match[1].toUpperCase();
    return ext === 'MARKDOWN' ? 'MD' : ext;
  })();

  $: cleanTitle = title.replace(/\.(epub|txt|htmlz|mobi|azw3?|pdf|markdown|md)$/i, '');

  const FORMAT_PALETTE: Record<string, { bg: string; accent: string }> = {
    EPUB: { bg: '#2b5a69', accent: '#5fb0a7' },
    TXT: { bg: '#5a4a3c', accent: '#c39a55' },
    MD: { bg: '#2d4a2b', accent: '#7ab86d' },
    HTMLZ: { bg: '#4a2b5a', accent: '#a574c0' },
    MOBI: { bg: '#7a3f25', accent: '#e08545' },
    AZW: { bg: '#7a3f25', accent: '#e08545' },
    AZW3: { bg: '#7a3f25', accent: '#e08545' },
    PDF: { bg: '#7a2828', accent: '#d05050' },
    CBZ: { bg: '#1f3d5a', accent: '#4c8cb8' },
    BOOK: { bg: '#3f4a5a', accent: '#7090b0' }
  };
  $: palette = FORMAT_PALETTE[detectedFormat] || FORMAT_PALETTE.BOOK;

  // Status badge: at-a-glance "done" or "未读" marker. Anything in progress
  // is already conveyed by the bottom progress bar — no badge there.
  $: status =
    progress >= 0.995 ? 'done' : progress === 0 && lastBookOpen === 0 ? 'unread' : null;
</script>

<div
  tabindex="0"
  role="button"
  title={detectedFormat === 'BOOK' ? cleanTitle : `${cleanTitle} · ${detectedFormat}`}
  class="book-card-root aspect-w-2 aspect-h-3 relative overflow-hidden rounded-lg"
  on:click
  on:keyup
>
  <div class="inline">
    <div class="h-full w-full text-5xl sm:text-7xl">
      {#if !imagePath}
        <!-- Generated placeholder: format-color background + title + format chip -->
        <svg
          viewBox="0 0 200 300"
          preserveAspectRatio="xMidYMid slice"
          class="absolute inset-0 h-full w-full"
        >
          <defs>
            <linearGradient id="grad-{detectedFormat}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color={palette.bg} />
              <stop offset="100%" stop-color="black" stop-opacity="0.35" />
            </linearGradient>
          </defs>
          <rect width="200" height="300" fill="url(#grad-{detectedFormat})" />
          <rect x="0" y="0" width="6" height="300" fill={palette.accent} />
          <text
            x="100"
            y="280"
            text-anchor="middle"
            font-size="20"
            font-weight="700"
            fill={palette.accent}
            font-family="system-ui, sans-serif"
          >{detectedFormat}</text>
        </svg>
      {/if}
      {#if !imageLoadComplete && imagePath}
        <Fa class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" icon={faImage} />
      {/if}

      {#if imagePath}
        <img
          decoding="async"
          loading="lazy"
          referrerpolicy="no-referrer"
          class="book-cover relative h-full w-full object-cover transition delay-150 duration-700 ease-out"
          class:blur={!imageLoadComplete}
          src={mapImagePath(imagePath)}
          {alt}
          bind:this={imgEl}
          on:load={() => (imageLoading = false)}
        />
      {/if}
    </div>

    {#if status === 'done'}
      <span class="status-badge done" title={$t('bookCard.doneTooltip')}>✓ {$t('bookCard.done')}</span>
    {:else if status === 'unread'}
      <span class="status-badge unread" title={$t('bookCard.unreadTooltip')}>{$t('bookCard.unread')}</span>
    {/if}

    {#if imagePath && detectedFormat !== 'BOOK'}
      <span
        class="format-chip"
        style="background:{palette.accent}"
        title="原文件格式：{detectedFormat}"
      >{detectedFormat}</span>
    {/if}

    <div class="absolute inset-x-0 bottom-0">
      <div
        class="sm:h-21 h-16 bg-menu bg-opacity-85 p-0.5 px-1.5 text-justify text-sm text-menu sm:p-1.5 sm:text-base"
      >
        <span class="line-clamp-3">{cleanTitle}</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style:width="{Math.round(progress * 100)}%" />
      </div>
    </div>
  </div>
</div>

<style>
  .status-badge {
    position: absolute;
    top: 0.4rem;
    left: 0.4rem;
    z-index: 2;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    pointer-events: none;
  }
  .status-badge.done {
    background: rgba(63, 142, 90, 0.92);
    color: #fff;
  }
  .status-badge.unread {
    background: rgba(255, 255, 255, 0.92);
    color: #444;
  }
  /* Hover-revealed chip in the top-right showing the original file format.
     Only shown when the card has a real cover (imagePath) — the placeholder
     branch already renders the format prominently in its SVG label. */
  .format-chip {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
    z-index: 2;
    padding: 0.12rem 0.5rem;
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .book-card-root:hover .format-chip,
  .book-card-root:focus-within .format-chip {
    opacity: 0.95;
  }
  .progress-track {
    height: 0.45rem;
    background: rgba(127, 127, 127, 0.55);
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(180deg, rgba(95, 126, 123, 0.95), rgba(58, 90, 88, 0.95));
    transition: width 0.25s ease;
  }
</style>
