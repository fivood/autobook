<script lang="ts">
  import { browser } from '$app/environment';
  import { faBookmark as farBookmark } from '@fortawesome/free-regular-svg-icons';
  import {
    faBookmark as fasBookmark,
    faCrosshairs,
    faExpand,
    faFlag,
    faHighlighter,
    faList,
    faRobot,
    faRotateLeft,
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
  import { dummyFn, isMobile$, isOnOldUrl } from '$lib/functions/utils';
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
  /** Current book's title. Shown as a centered label between the left
   * and right icon groups when the header slides down — reader wanted
   * to know which book they're reading without going back to library. */
  export let bookTitle = '';

  const dispatch = createEventDispatcher<{
    tocClick: void;
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

    if ($readerImageGalleryPictures$.length) {
      items.push(mergeEntries.READER_IMAGE_GALLERY);
    }

    items.push(mergeEntries.SETTINGS, mergeEntries.MANAGE);

    menuItems = items;
  }

  function dispatchCustomReadingPointAction(action: any) {
    dispatch(action);
    customReadingPointMenuElm.toggleOpen();
  }
</script>

<div class="flex justify-between items-center px-4 md:px-8 {baseHeaderClasses}">
  <div class="flex transform-gpu {nTranslateXHeaderFa}">
    {#if hasChapterData}
      <div
        tabindex="0"
        role="button"
        title={$t('reader.toc')}
        class={baseIconClasses}
        on:click={() => dispatch('tocClick')}
        on:keyup={dummyFn}
      >
        <Fa icon={faList} />
      </div>
    {/if}
    <div
      tabindex="0"
      role="button"
      title={$t('reader.highlights')}
      class={baseIconClasses}
      on:click={() => dispatch('highlightClick')}
      on:keyup={dummyFn}
    >
      <Fa icon={faHighlighter} />
    </div>
    <div
      tabindex="0"
      role="button"
      title={$t('reader.ai')}
      class={baseIconClasses}
      on:click={() => dispatch('aiClick')}
      on:keyup={dummyFn}
    >
      <Fa icon={faRobot} />
    </div>
    <div
      tabindex="0"
      role="button"
      title={$t('reader.bookmark')}
      class={baseIconClasses}
      on:click={() => dispatch('bookmarkClick')}
      on:keyup={dummyFn}
    >
      <Fa icon={isBookmarkScreen ? fasBookmark : farBookmark} />
    </div>
    {#if hasBookmarkData}
      <div
        tabindex="0"
        role="button"
        title={$t('reader.bookmarkReturn')}
        class={baseIconClasses}
        on:click={() => dispatch('scrollToBookmarkClick')}
        on:keyup={dummyFn}
      >
        <Fa icon={faRotateLeft} />
      </div>
    {/if}
    {#if $viewMode$ === ViewMode.Continuous && !$isMobile$}
      <div
        class="flex items-center px-4 text-xl xl:px-3 xl:text-lg"
        title={$t('reader.autoScrollSpeed')}
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
      title={$t('reader.finishBook')}
      class={baseIconClasses}
      on:click={() => dispatch('completeBook')}
      on:keyup={dummyFn}
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
          <div slot="icon" title={$t('reader.customReadingPointMenu')} class={baseIconClasses}>
            <Fa icon={faCrosshairs} />
          </div>
          <div class="w-40 bg-menu text-menu md:w-32" slot="content">
            {#each customReadingPointMenuItems as actionItem (actionItem.action)}
              <div
                tabindex="0"
                role="button"
                class="px-4 py-2 text-sm hover:bg-white/10"
                on:click={() => dispatchCustomReadingPointAction(actionItem.action)}
                on:keyup={dummyFn}
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
        title={$t('reader.fullscreen')}
        class={baseIconClasses}
        on:click={() => dispatch('fullscreenClick')}
        on:keyup={dummyFn}
      >
        <Fa icon={faExpand} />
      </div>
    {/if}
    <MergedHeaderIcon
      disableRouteNavigation
      items={menuItems}
      on:action={({ detail }) => {
        if (detail === mergeEntries.STATISTICS.label) {
          dispatch('statisticsClick');
        } else if (detail === mergeEntries.JUMP_TO_POSITION.label) {
          dispatch('jumpClick');
        } else if (detail === mergeEntries.READER_IMAGE_GALLERY.label) {
          dispatch('readerImageGalleryClick');
        } else if (detail === mergeEntries.SETTINGS.label) {
          dispatch('settingsClick');
        } else if (detail === mergeEntries.DOMAIN_HINT.label) {
          dispatch('domainHintClick');
        } else if (detail === mergeEntries.MANAGE.label) {
          dispatch('bookManagerClick');
        }
      }}
    />
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
