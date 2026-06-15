<script lang="ts">
  import { faImage } from '@fortawesome/free-regular-svg-icons';
  import { onDestroy } from 'svelte';
  import Fa from 'svelte-fa';

  export let imagePath: string | Blob;
  export let title: string;
  export let progress: number;

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
    MD: { bg: '#1f3a4a', accent: '#4ca8d8' },
    MOBI: { bg: '#7a3f25', accent: '#e08545' },
    AZW: { bg: '#7a3f25', accent: '#e08545' },
    AZW3: { bg: '#7a3f25', accent: '#e08545' },
    PDF: { bg: '#7a2828', accent: '#d05050' },
    BOOK: { bg: '#3f4a5a', accent: '#7090b0' }
  };
  $: palette = FORMAT_PALETTE[detectedFormat] || FORMAT_PALETTE.BOOK;
</script>

<div tabindex="0" role="button" class="aspect-w-2 aspect-h-3 relative overflow-hidden rounded-lg" on:click on:keyup>
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

    <div class="absolute inset-x-0 bottom-0">
      <div
        class="sm:h-21 h-16 bg-menu bg-opacity-85 p-0.5 px-1.5 text-justify text-sm text-menu sm:p-1.5 sm:text-base"
      >
        <span class="line-clamp-3">{cleanTitle}</span>
      </div>
      <div class="h-2.5 bg-gray-400 bg-opacity-80">
        <div
          class="h-full rounded bg-gradient-to-b from-red-600 to-red-900"
          style:width="{progress * 100}%"
        />
      </div>
    </div>
  </div>
</div>
