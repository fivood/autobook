<script lang="ts">
  import { browser } from '$app/environment';
  import { faBookmark as farBookmark } from '@fortawesome/free-regular-svg-icons';
  import {
    faBookmark as fasBookmark,
    faCog,
    faCrosshairs,
    faExpand,
    faFlag,
    faHighlighter,
    faImages,
    faList,
    faPenToSquare,
    faRobot,
    faRotateLeft,
    type IconDefinition
  } from '@fortawesome/free-solid-svg-icons';
  import { readerImageGalleryPictures$ } from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import MergedHeaderIcon from '$lib/components/merged-header-icon/merged-header-icon.svelte';
  import {
    baseHeaderClasses,
    baseIconClasses,
    nTranslateXHeaderFa,
    translateXHeaderFa
  } from '$lib/css-classes';
  import { customReadingPointEnabled$, viewMode$ } from '$lib/data/store';
  import { ViewMode } from '$lib/data/view-mode';
  import { activateOnKeyup, isMobile$, isOnOldUrl } from '$lib/functions/utils';
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';
  import { t } from '$lib/i18n';

  export let hasChapterData: boolean;
  export let hasText: boolean;
  export let autoScrollMultiplier: number;
  export let hasCustomReadingPoint: boolean;
  export let showFullscreenButton: boolean;
  export let isBookmarkScreen: boolean;
  export let hasBookmarkData: boolean;
  /** Whether the spoiler-safe AI assistant can index this book's text.
   * Comics and not-yet-OCR'd scanned PDFs have no text layer; offering the
   * drawer there just answers "can't spoil" to everything. Hidden entirely —
   * see has-indexable-text.ts. */
  export let aiAvailable = true;
  /**
   * The book has a text layer (see has-indexable-text.ts): false for comics
   * and scans not yet OCR'd. Those books showed a highlights button with
   * nothing that could be highlighted, and a 目录 that was just every page as
   * 「第 N 页」 — the image gallery already shows the same pages, as pages.
   */
  export let hasReadableText = true;
  /** MD/TXT books expose the shared source editor. */
  export let textEditable = false;
  /** Current book's title. Shown as a centered label between the left
   * and right icon groups when the header slides down — reader wanted
   * to know which book they're reading without going back to library. */
  export let bookTitle = '';

  const dispatch = createEventDispatcher<{
    tocClick: void;
    editTextClick: void;
    highlightClick: void;
    aiClick: void;
    bookmarkClick: void;
    scrollToBookmarkClick: void;
    jumpClick: void;
    completeBook: void;
    fullscreenClick: void;
    showCustomReadingPoint: void;
    setCustomReadingPoint: void;
    resetCustomReadingPoint: void;
    statisticsClick: void;
    translateClick: void;
    readerImageGalleryClick: void;
    settingsClick: void;
    domainHintClick: void;
    bookManagerClick: void;
  }>();

  /**
   * Reader-only overflow entries, keyed by the event each one dispatches.
   * `label` is the dispatch identity, as with mergeEntries (see there), so it
   * stays an untranslated id; only labelKey / titleKey reach the screen.
   */
  const overflow = {
    completeBook: {
      routeId: '',
      label: 'reader:completeBook',
      labelKey: 'reader.finishBook',
      icon: faFlag,
      title: '',
      titleKey: 'reader.finishBook'
    },
    editTextClick: {
      routeId: '',
      label: 'reader:editText',
      labelKey: 'reader.editText',
      icon: faPenToSquare,
      title: '',
      titleKey: 'reader.editText'
    },
    showCustomReadingPoint: {
      routeId: '',
      label: 'reader:showCustomReadingPoint',
      labelKey: 'reader.customReadingPoint.show',
      icon: faCrosshairs,
      title: '',
      titleKey: 'reader.customReadingPoint.show'
    },
    setCustomReadingPoint: {
      routeId: '',
      label: 'reader:setCustomReadingPoint',
      labelKey: 'reader.customReadingPoint.set',
      icon: faCrosshairs,
      title: '',
      titleKey: 'reader.customReadingPoint.set'
    },
    resetCustomReadingPoint: {
      routeId: '',
      label: 'reader:resetCustomReadingPoint',
      labelKey: 'reader.customReadingPoint.reset',
      icon: faCrosshairs,
      title: '',
      titleKey: 'reader.customReadingPoint.reset'
    }
  };

  function dispatchOverflow(label: string) {
    if (label === mergeEntries.STATISTICS.label) {
      dispatch('statisticsClick');
    } else if (label === mergeEntries.JUMP_TO_POSITION.label) {
      dispatch('jumpClick');
    } else if (label === mergeEntries.DOMAIN_HINT.label) {
      dispatch('domainHintClick');
    } else {
      const event = (Object.keys(overflow) as (keyof typeof overflow)[]).find(
        (key) => overflow[key].label === label
      );
      if (event) dispatch(event);
    }
  }

  let menuItems: {
    routeId: string;
    label: string;
    labelKey?: string;
    icon: IconDefinition;
    title: string;
    titleKey?: string;
  }[] = [];

  $: isOldUrl = browser && isOnOldUrl(window);

  // The bar keeps what gets reached for mid-book; the overflow takes what is
  // reached once a book or once a session. 完成本书 used to be a permanent
  // icon and the reading point had a popover of its own, while this menu held
  // only 统计 and 跳转. In-book actions come first, leaving the book last.
  $: {
    const items = [];

    if (hasText) {
      items.push(mergeEntries.JUMP_TO_POSITION);
    }

    if ($customReadingPointEnabled$ || $viewMode$ === ViewMode.Paginated) {
      if (hasCustomReadingPoint) items.push(overflow.showCustomReadingPoint);
      items.push(overflow.setCustomReadingPoint);
      if (hasCustomReadingPoint) items.push(overflow.resetCustomReadingPoint);
    }

    if (textEditable) {
      items.push(overflow.editTextClick);
    }

    items.push(overflow.completeBook);
    items.push(isOldUrl ? mergeEntries.DOMAIN_HINT : mergeEntries.STATISTICS);

    menuItems = items;
  }
</script>

<div class="flex justify-between items-center px-4 md:px-8 {baseHeaderClasses}">
  <div class="flex transform-gpu {nTranslateXHeaderFa}">
    {#if hasChapterData && (hasReadableText || !$readerImageGalleryPictures$.length)}
      <div
        tabindex="0"
        role="button"
        aria-label={$t('reader.toc')} title={$t('reader.toc')}
        class={baseIconClasses}
        on:click={() => dispatch('tocClick')}
        on:keyup={activateOnKeyup}
      >
        <Fa icon={faList} />
      </div>
    {/if}
    {#if $readerImageGalleryPictures$.length}
      <div
        tabindex="0"
        role="button"
        aria-label={$t('menu.imageGallery.title')} title={$t('menu.imageGallery.title')}
        class={baseIconClasses}
        on:click={() => dispatch('readerImageGalleryClick')}
        on:keyup={activateOnKeyup}
      >
        <Fa icon={faImages} />
      </div>
    {/if}
    {#if hasReadableText}
      <div
        tabindex="0"
        role="button"
        aria-label={$t('reader.highlights')} title={$t('reader.highlights')}
        class={baseIconClasses}
        on:click={() => dispatch('highlightClick')}
        on:keyup={activateOnKeyup}
      >
        <Fa icon={faHighlighter} />
      </div>
    {/if}
    {#if aiAvailable}
      <div
        tabindex="0"
        role="button"
        aria-label={$t('reader.ai')} title={$t('reader.ai')}
        class={baseIconClasses}
        on:click={() => dispatch('aiClick')}
        on:keyup={activateOnKeyup}
      >
        <Fa icon={faRobot} />
      </div>
    {/if}
    <div
      tabindex="0"
      role="button"
      aria-label={$t('reader.bookmark')} title={$t('reader.bookmark')}
      class={baseIconClasses}
      on:click={() => dispatch('bookmarkClick')}
      on:keyup={activateOnKeyup}
    >
      <Fa icon={isBookmarkScreen ? fasBookmark : farBookmark} />
    </div>
    {#if hasBookmarkData}
      <div
        tabindex="0"
        role="button"
        aria-label={$t('reader.bookmarkReturn')} title={$t('reader.bookmarkReturn')}
        class={baseIconClasses}
        on:click={() => dispatch('scrollToBookmarkClick')}
        on:keyup={activateOnKeyup}
      >
        <Fa icon={faRotateLeft} />
      </div>
    {/if}
    {#if $viewMode$ === ViewMode.Continuous && !$isMobile$ && hasReadableText}
      <div
        class="flex items-center px-4 text-xl xl:px-3 xl:text-lg"
        aria-label={$t('reader.autoScrollSpeed')} title={$t('reader.autoScrollSpeed')}
      >
        <!-- Same unit as the typewriter pill; 「6x」 read as a multiplier of
             something, and looked like a button besides. -->
        {$t('typewriter.speedUnit', { n: autoScrollMultiplier })}
      </div>
    {/if}
  </div>

  {#if bookTitle}
    <div
      class="book-title-label hidden md:block mx-4 min-w-0 flex-1 truncate text-center opacity-80"
      title={bookTitle}
    >
      {bookTitle}
    </div>
  {/if}

  <div class="flex transform-gpu {translateXHeaderFa}">
    {#if showFullscreenButton}
      <div
        tabindex="0"
        role="button"
        aria-label={$t('reader.fullscreen')} title={$t('reader.fullscreen')}
        class={baseIconClasses}
        on:click={() => dispatch('fullscreenClick')}
        on:keyup={activateOnKeyup}
      >
        <Fa icon={faExpand} />
      </div>
    {/if}
    <div
      tabindex="0"
      role="button"
      aria-label={$t('menu.translate.title')} title={$t('menu.translate.title')}
      class={baseIconClasses}
      on:click={() => dispatch('translateClick')}
      on:keyup={activateOnKeyup}
    >
      <Fa icon={mergeEntries.TRANSLATE.icon} />
    </div>
    <MergedHeaderIcon
      alwaysCollapse
      disableRouteNavigation
      items={menuItems}
      mergeTo={mergeEntries.MORE}
      on:action={({ detail }) => dispatchOverflow(detail)}
    />
    <div
      tabindex="0"
      role="button"
      aria-label={$t('reader.readingSettings')} title={$t('reader.readingSettings')}
      class={baseIconClasses}
      on:click={() => dispatch('settingsClick')}
      on:keyup={activateOnKeyup}
    >
      <Fa icon={faCog} />
    </div>
    <div
      tabindex="0"
      role="button"
      aria-label={$t('menu.manage.title')} title={$t('menu.manage.title')}
      class={baseIconClasses}
      on:click={() => dispatch('bookManagerClick')}
      on:keyup={activateOnKeyup}
    >
      <!-- Same destination as the page headers' 书库 entry, so the same icon
           comes from the same place — it drifted once already. -->
      <Fa icon={mergeEntries.MANAGE.icon} />
    </div>
  </div>
</div>

<style>
  .book-title-label {
    font-size: 0.9rem;
    letter-spacing: 0.02em;
    /* Keeps title from becoming a click target — icons on either side
       stay unambiguous. */
    pointer-events: none;
    user-select: none;
  }
</style>
