<script lang="ts">
  import { browser } from '$app/environment';
  import { faBookmark as farBookmark } from '@fortawesome/free-regular-svg-icons';
  import {
    faBookmark as fasBookmark,
    faCrosshairs,
    faExpand,
    faFlag,
    faThumbtack,
    faHighlighter,
    faImages,
    faList,
    faMagnifyingGlass,
    faPenToSquare,
    faRobot,
    faRotateLeft,
    faSliders,
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
  import { isTauri } from '$lib/data/env';
  import { customReadingPointEnabled$, viewMode$, windowAlwaysOnTop$ } from '$lib/data/store';
  import { ViewMode } from '$lib/data/view-mode';
  import { activateOnKeyup, isOnOldUrl } from '$lib/functions/utils';
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';
  import { t } from '$lib/i18n';

  export let hasChapterData: boolean;
  export let hasText: boolean;
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
    searchClick: void;
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
    searchClick: {
      routeId: '',
      label: 'reader:search',
      labelKey: 'reader.search',
      icon: faMagnifyingGlass,
      title: '',
      titleKey: 'reader.searchTitle'
    },
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
      titleKey: 'reader.customReadingPoint.setTitle'
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

  // Handled here rather than dispatched. One row with a tick: it used to swap
  // between 窗口置顶 and 取消置顶, which read as two different commands.
  const pinWindow = {
    routeId: '',
    label: 'reader:pinWindow',
    labelKey: 'reader.alwaysOnTop.on',
    icon: faThumbtack,
    title: '',
    titleKey: 'reader.alwaysOnTop.on'
  };

  function dispatchOverflow(label: string) {
    if (label === mergeEntries.STATISTICS.label) {
      dispatch('statisticsClick');
    } else if (label === mergeEntries.JUMP_TO_POSITION.label) {
      dispatch('jumpClick');
    } else if (label === mergeEntries.DOMAIN_HINT.label) {
      dispatch('domainHintClick');
    } else if (label === pinWindow.label) {
      $windowAlwaysOnTop$ = !$windowAlwaysOnTop$;
    } else if (label === mergeEntries.TRANSLATE.label) {
      dispatch('translateClick');
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
    group?: string;
    checked?: boolean;
  }[] = [];

  $: isOldUrl = browser && isOnOldUrl(window);

  // The bar keeps what gets reached for mid-book; the overflow takes what is
  // reached once a book or once a session, in three groups: finding a place,
  // this book, and the window / leaving the book. 翻译工作台 sat on the bar
  // between 全屏 and 更多, where nothing said that it leaves the book.
  $: {
    const items = [];
    const find = { group: 'find' };
    const book = { group: 'book' };
    const leave = { group: 'leave' };

    if (hasText) {
      items.push({ ...overflow.searchClick, ...find });
      items.push({ ...mergeEntries.JUMP_TO_POSITION, ...find });
    }

    if ($customReadingPointEnabled$ || $viewMode$ === ViewMode.Paginated) {
      if (hasCustomReadingPoint) items.push({ ...overflow.showCustomReadingPoint, ...book });
      items.push({ ...overflow.setCustomReadingPoint, ...book });
      if (hasCustomReadingPoint) items.push({ ...overflow.resetCustomReadingPoint, ...book });
    }

    if (textEditable) {
      items.push({ ...overflow.editTextClick, ...book });
    }

    items.push({ ...overflow.completeBook, ...book });

    if (isTauri()) {
      items.push({ ...pinWindow, ...leave, checked: $windowAlwaysOnTop$ });
    }
    // Same dispatch labels as the page entries, named for what they open from
    // here: statistics filtered to this book, the workbench on this book.
    items.push(
      isOldUrl
        ? { ...mergeEntries.DOMAIN_HINT, ...leave }
        : {
            ...mergeEntries.STATISTICS,
            labelKey: 'reader.bookStatistics',
            titleKey: 'reader.bookStatistics',
            ...leave
          }
    );
    items.push({
      ...mergeEntries.TRANSLATE,
      labelKey: 'reader.translateBook',
      titleKey: 'menu.translate.title',
      ...leave
    });

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
      <!-- Not the settings page's gear: this opens a drawer over the book,
           the same sliders icon the statistics page uses for its own drawer. -->
      <Fa icon={faSliders} />
    </div>
    <!-- 书库 leaves the book; the rule keeps it from reading as one more
         in-book tool next to 设置. -->
    <div class="mx-1 h-5 w-px shrink-0 self-center bg-current/30"></div>
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
