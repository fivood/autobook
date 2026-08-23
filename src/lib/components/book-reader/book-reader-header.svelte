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
    faSignOutAlt,
    type IconDefinition
  } from '@fortawesome/free-solid-svg-icons';
  import { readerImageGalleryPictures$ } from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import MergedHeaderIcon from '$lib/components/merged-header-icon/merged-header-icon.svelte';
  import Popover from '$lib/components/popover/popover.svelte';
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

  // labelKey is the i18n key rendered via {$t(...)}; `action` is the
  // untranslated event id dispatched to the reader page.
  const customReadingPointMenuItems: {
    labelKey: string;
    action: any;
  }[] = [
    ...(hasCustomReadingPoint
      ? [{ labelKey: 'reader.customReadingPoint.show', action: 'showCustomReadingPoint' }]
      : []),
    { labelKey: 'reader.customReadingPoint.set', action: 'setCustomReadingPoint' },
    ...(hasCustomReadingPoint
      ? [{ labelKey: 'reader.customReadingPoint.reset', action: 'resetCustomReadingPoint' }]
      : [])
  ];

  let customReadingPointMenuElm: Popover;

  let menuItems: {
    routeId: string;
    label: string;
    labelKey?: string;
    icon: IconDefinition;
    title: string;
    titleKey?: string;
  }[] = [];

  $: isOldUrl = browser && isOnOldUrl(window);

  // What stays in the overflow menu: everything that navigates away from the
  // book or is reached once a session. Reading settings and 返回书库 used to
  // live here too — they're first-class icons now, and the image gallery moved
  // to the left group with the other in-book navigation.
  $: {
    const items = [];

    if (isOldUrl) {
      items.push(mergeEntries.DOMAIN_HINT);
    } else {
      items.push(mergeEntries.STATISTICS);
    }

    if (hasText) {
      items.push(mergeEntries.JUMP_TO_POSITION);
    }

    items.push(mergeEntries.TRANSLATE);

    menuItems = items;
  }

  function dispatchCustomReadingPointAction(action: any) {
    dispatch(action);
    customReadingPointMenuElm.toggleOpen();
  }
</script>

<div class="flex justify-between items-center px-4 md:px-8 {baseHeaderClasses}">
  <div class="flex transform-gpu {nTranslateXHeaderFa}">
    {#if textEditable}
      <div
        tabindex="0"
        role="button"
        aria-label={$t('reader.editText')} title={$t('reader.editText')}
        class={baseIconClasses}
        on:click={() => dispatch('editTextClick')}
        on:keyup={activateOnKeyup}
      >
        <Fa icon={faPenToSquare} />
      </div>
    {/if}
    {#if hasChapterData}
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
    {#if $viewMode$ === ViewMode.Continuous && !$isMobile$}
      <div
        class="flex items-center px-4 text-xl xl:px-3 xl:text-lg"
        aria-label={$t('reader.autoScrollSpeed')} title={$t('reader.autoScrollSpeed')}
      >
        {autoScrollMultiplier}x
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
    <div
      tabindex="0"
      role="button"
      aria-label={$t('reader.finishBook')} title={$t('reader.finishBook')}
      class={baseIconClasses}
      on:click={() => dispatch('completeBook')}
      on:keyup={activateOnKeyup}
    >
      <Fa icon={faFlag} />
    </div>
    {#if $customReadingPointEnabled$ || $viewMode$ === ViewMode.Paginated}
      <div class="flex">
        <Popover
          placement="bottom"
          fallbackPlacements={['bottom-end', 'bottom-start']}
          yOffset={0}
          bind:this={customReadingPointMenuElm}
        >
          <div slot="icon" aria-label={$t('reader.customReadingPointMenu')} title={$t('reader.customReadingPointMenu')} class={baseIconClasses}>
            <Fa icon={faCrosshairs} />
          </div>
          <div class="menu-list w-40 md:w-32" slot="content">
            {#each customReadingPointMenuItems as actionItem (actionItem.action)}
              <div
                tabindex="0"
                role="button"
                class="menu-item"
                on:click={() => dispatchCustomReadingPointAction(actionItem.action)}
                on:keyup={activateOnKeyup}
              >
                {$t(actionItem.labelKey)}
              </div>
            {/each}
          </div>
        </Popover>
      </div>
    {/if}
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
      on:action={({ detail }) => {
        if (detail === mergeEntries.STATISTICS.label) {
          dispatch('statisticsClick');
        } else if (detail === mergeEntries.TRANSLATE.label) {
          dispatch('translateClick');
        } else if (detail === mergeEntries.JUMP_TO_POSITION.label) {
          dispatch('jumpClick');
        } else if (detail === mergeEntries.DOMAIN_HINT.label) {
          dispatch('domainHintClick');
        }
      }}
    />
    <div
      tabindex="0"
      role="button"
      aria-label={$t('menu.settings.title')} title={$t('menu.settings.title')}
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
      <Fa icon={faSignOutAlt} />
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
