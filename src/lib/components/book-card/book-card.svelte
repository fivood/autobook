<script lang="ts">
  import { faImage } from '@fortawesome/free-regular-svg-icons';
  import { onDestroy } from 'svelte';
  import Fa from 'svelte-fa';
  import { t } from '$lib/i18n';
  import { activateOnKeyup } from '$lib/functions/utils';
  import { detectSourceFormat, stripBookExtension } from '$lib/functions/book-format';
  import { formatColorKey } from '$lib/data/format-color';

  export let imagePath: string | Blob;
  export let title: string;
  export let progress: number;
  export let lastBookOpen = 0;
  /** Set by imports from 1.20.2 onward. Older books fall back to
   * extension-in-title detection. */
  export let originalFormat: string | undefined = undefined;

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

  /** Prefer the import-time originalFormat (added 1.20.2); fall back to
   * extension-in-title detection for older imports whose data row was
   * saved before the field existed. Both paths go through book-format.ts so
   * comic archives and `.kfx` are recognized here too. */
  $: detectedFormat = (() => {
    const raw = originalFormat || detectSourceFormat(title);
    if (!raw || raw === 'other') return 'BOOK';
    const up = raw.toUpperCase();
    return up === 'MARKDOWN' ? 'MD' : up;
  })();

  $: cleanTitle = stripBookExtension(title);

  /** Colours live in CSS variables set per theme by +layout.svelte; this only
   * picks which set of them applies. See data/format-color.ts. */
  $: colorKey = formatColorKey(originalFormat || detectSourceFormat(title));
  // The neutral fallbacks only apply before the layout's first reactive pass
  // (and during prerender, where nothing is painted anyway) — without them an
  // unset variable resolves to `invalid`, which paints transparent.
  $: palette = {
    chipBg: `var(--fmt-${colorKey}-chip-bg, #2f3742)`,
    chipRing: `var(--fmt-${colorKey}-chip-ring, #7a8794)`,
    coverBg: `var(--fmt-${colorKey}-cover-bg, #2f3742)`,
    coverAccent: `var(--fmt-${colorKey}-cover-accent, #9fb0bd)`
  };

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
  on:keyup={activateOnKeyup}
>
  <div class="inline">
    <div class="h-full w-full text-5xl sm:text-7xl">
      {#if !imagePath}
        <!-- Generated cover for books with no artwork. Everything sits above
             y=200: the title bar overlay (h-16 / sm:h-21) covers roughly the
             bottom quarter of the card, and the old layout put the format
             wordmark at y=280 — squarely underneath it, which is why these
             covers looked blank. -->
        <svg
          viewBox="0 0 200 300"
          preserveAspectRatio="xMidYMid slice"
          class="absolute inset-0 h-full w-full"
        >
          <defs>
            <linearGradient id="grad-{colorKey}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color={palette.coverBg} />
              <stop offset="100%" stop-color="black" stop-opacity="var(--fmt-cover-shade, 0.45)" />
            </linearGradient>
          </defs>
          <rect width="200" height="300" fill="url(#grad-{colorKey})" />
          <rect x="0" y="0" width="6" height="300" fill={palette.coverAccent} />

          <!-- Page-stack motif: three offset sheets, tinted by the format's
               accent so formats stay tellable apart at thumbnail size even
               before the wordmark is legible. -->
          <g opacity="0.22" fill="none" stroke={palette.coverAccent} stroke-width="3">
            <rect x="62" y="52" width="80" height="104" rx="4" />
            <rect x="54" y="62" width="80" height="104" rx="4" />
          </g>
          <rect
            x="46"
            y="72"
            width="80"
            height="104"
            rx="4"
            fill="black"
            fill-opacity="0.18"
            stroke={palette.coverAccent}
            stroke-width="3"
          />

          <text
            x="86"
            y="132"
            text-anchor="middle"
            font-size={detectedFormat.length > 4 ? 20 : 26}
            font-weight="700"
            fill={palette.coverAccent}
            font-family="system-ui, sans-serif"
            letter-spacing="1"
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

    {#if detectedFormat !== 'BOOK'}
      <span
        class="format-chip"
        style="--chip-bg:{palette.chipBg}; --chip-ring:{palette.chipRing}"
        title={$t('bookCard.originalFormat', { format: detectedFormat })}
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
  /* Top-right: the top-left corner belongs to the format chip, which is on
     every card, while this one only appears at the two ends of the progress
     range. */
  .status-badge {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
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
  /* Always visible, top-left: the point is to tell formats apart while
     scanning the grid. It used to be opacity:0 until hover, which made the
     feature effectively invisible — you had to already be pointing at the
     book to learn what it was. */
  .format-chip {
    position: absolute;
    top: 0.4rem;
    left: 0.4rem;
    z-index: 2;
    padding: 0.12rem 0.5rem;
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: #fff;
    /* Dark base, accent only as a ring. The accent colours were picked in
       1.2.6 as decoration on the placeholder's dark background, never as a
       text background — white on them measures 2.4:1 to 4.3:1, i.e. every
       format fails WCAG AA for text this size. Against the matching dark
       `bg` tone the same white text is 7.6:1 at worst, and the ring keeps
       the accent doing its "which format is this" job. */
    background: var(--chip-bg);
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.45),
      inset 0 0 0 1px var(--chip-ring);
    pointer-events: none;
    opacity: 0.96;
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
