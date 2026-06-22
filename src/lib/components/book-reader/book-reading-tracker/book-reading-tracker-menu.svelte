<script lang="ts">
  import {
    faChevronLeft,
    faChevronRight,
    faClockRotateLeft,
    faFloppyDisk,
    faPause,
    faPlay,
    faRepeat,
    faSpinner,
    faTrash,
    faXmark,
    type IconDefinition
  } from '@fortawesome/free-solid-svg-icons';
  import type { TrackingHistory } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import {
    getChapterData,
    type SectionWithProgress
  } from '$lib/components/book-reader/book-toc/book-toc';
  import { dialogManager } from '$lib/data/dialog-manager';
  import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
  import type { ReadingGoal } from '$lib/data/reading-goal';
  import { lastBlurredTrackerItems$, skipKeyDownListener$ } from '$lib/data/store';
  import { secondsToMinutes, toTimeString } from '$lib/functions/statistic-util';
  import { caluclatePercentage, dummyFn } from '$lib/functions/utils';
  import { createEventDispatcher, onMount } from 'svelte';
  import Fa from 'svelte-fa';

  export let fontColor: string;
  export let backgroundColor: string;
  export let actionInProgress: boolean;
  export let hadError: boolean;
  export let currentReadingGoal: ReadingGoal | undefined;
  export let currentTimeGoal: number;
  export let currentCharacterGoal: number;
  export let currentReadingGoalStart: string;
  export let currentReadingGoalEnd: string;
  export let remainingTimeInReadingGoalWindow: string;
  export let wasTrackerPaused: boolean;
  export let canSaveStatistics: boolean;
  export let timeToFinishBook: string;
  export let sectionData: SectionWithProgress[];
  export let exploredCharCount: number;
  export let lastExploredCharCount: number;
  export let previousLastExploredCharCount: number;
  export let frozenPosition: number;
  export let trackingHistory: TrackingHistory[];
  export let sessionStatistics: BooksDbStatistic;
  export let todaysStatistics: BooksDbStatistic;
  export let allTimeStatistics: BooksDbStatistic;
  export let bookCompletionStatistics:
    | Omit<BooksDbStatistic, 'title' | 'lastStatisticModified'>
    | undefined;
  export let autoScrollerStatistics: BooksDbStatistic | undefined;
  export let bookStartDate: string;

  const dispatch = createEventDispatcher<{
    trackerMenuClosed: void;
    updateCurrentLocation: void;
    freezeCurrentLocation: void;
    saveStatistics: void;
    revertStatistic: TrackingHistory;
  }>();

  const actions = [
    { icon: faPlay, event: 'toggleTracker', title: '切换统计' },
    { icon: faRepeat, event: 'updateCurrentLocation', title: '更新位置' },
    { icon: faClockRotateLeft, event: 'freezeCurrentLocation', title: '切换冻结位置' },
    { icon: faFloppyDisk, event: 'saveStatistics', title: '保存' }
  ];

  const trackingItemsPerPage = 15;

  let trackingHistoryIndex = 0;
  let timeToFinishChapter = '';

  $: allStatistics = autoScrollerStatistics
    ? [
        { id: '当前会话', ...sessionStatistics },
        { id: '今日', ...todaysStatistics },
        { id: '累计', ...allTimeStatistics },
        ...(bookCompletionStatistics
          ? [{ id: '已完成', ...bookCompletionStatistics }]
          : []),
        { id: '自动滚动', ...autoScrollerStatistics }
      ]
    : [
        { id: '当前会话', ...sessionStatistics },
        { id: '今日', ...todaysStatistics },
        { id: '累计', ...allTimeStatistics },
        ...(bookCompletionStatistics
          ? [{ id: '已完成', ...bookCompletionStatistics }]
          : [])
      ];

  $: currentTrackingHistoryIndex = Math.max(0, trackingHistoryIndex * trackingItemsPerPage);

  $: trackingHistoryItems = trackingHistory.slice(
    currentTrackingHistoryIndex,
    currentTrackingHistoryIndex + trackingItemsPerPage
  );

  $: hasNextPage = trackingHistory.length > currentTrackingHistoryIndex + trackingItemsPerPage;

  onMount(() => {
    $skipKeyDownListener$ = true;
    dialogManager.dialogs$.next([
      {
        component: '<div/>',
        disableCloseOnClick: true
      }
    ]);

    if (sectionData) {
      const [mainChapters, chapterIndex] = getChapterData(sectionData);
      const currentChapter = mainChapters[chapterIndex];
      const remainingCharacters =
        (currentChapter.startCharacter ?? 0) +
        (currentChapter.characters ?? 0) -
        (exploredCharCount ?? 0);

      timeToFinishChapter = sessionStatistics.lastReadingSpeed
        ? toTimeString(
            Math.max(
              0,
              Math.floor(remainingCharacters / (sessionStatistics.lastReadingSpeed / 3600))
            )
          )
        : 'N/A';
    }

    return () => {
      $skipKeyDownListener$ = false;
      dialogManager.dialogs$.next([]);
    };
  });

  function executeAction(event: string) {
    switch (event) {
      case 'toggleTracker':
        wasTrackerPaused = !wasTrackerPaused;
        break;
      case 'updateCurrentLocation':
      case 'freezeCurrentLocation':
      case 'saveStatistics':
        dispatch(event);
        break;

      default:
        break;
    }
  }

  function handleBlurredKey(dataKey: string) {
    if (window.getSelection()?.toString().trim()) {
      return;
    }

    if ($lastBlurredTrackerItems$.has(dataKey)) {
      $lastBlurredTrackerItems$.delete(dataKey);
    } else {
      $lastBlurredTrackerItems$.add(dataKey);
    }

    $lastBlurredTrackerItems$ = new Set([...$lastBlurredTrackerItems$]);
  }

  function getActionIcon(
    action: { icon: IconDefinition; event: string; title: string },
    trackerPaused: boolean
  ) {
    if (action.event === 'toggleTracker') {
      return trackerPaused ? faPlay : faPause;
    }

    return action.icon;
  }
</script>

<div class="flex items-center justify-between min-h-[60px] px-4">
  <div class="mr-4">
    {#if hadError}
      上次更新失败
    {/if}
  </div>
  <div
    tabindex="0"
    role="button"
    title="关闭统计菜单"
    class="flex items-center hover:text-red-500 md:items-center"
    on:click={() => dispatch('trackerMenuClosed')}
    on:keyup={dummyFn}
  >
    <Fa icon={faXmark} />
  </div>
</div>
<div class="flex flex-1 flex-col overflow-auto p-4">
  {#if currentReadingGoal}
    <div class="mb-6">
      {#if currentReadingGoal.timeGoal}
        {@const timeGoalPercentage = caluclatePercentage(
          currentTimeGoal,
          currentReadingGoal.timeGoal
        )}
        <div>
          {secondsToMinutes(currentTimeGoal)} / {secondsToMinutes(currentReadingGoal.timeGoal)} 分钟 ({timeGoalPercentage}%)
        </div>
        <!-- eslint-disable-next-line svelte/no-unknown-style-directive-property -->
        <div class="w-full rounded-full h-2.5" style:background-Color={fontColor}>
          <div
            class="h-2.5 rounded-full opacity-70"
            style:width={`${Math.min(100, timeGoalPercentage)}%`}
            style:background-color={backgroundColor}
          ></div>
        </div>
      {/if}
      {#if currentReadingGoal.characterGoal}
        {@const characterGoalPercentage = caluclatePercentage(
          currentCharacterGoal,
          currentReadingGoal.characterGoal
        )}
        <div class="mt-4">
          {currentCharacterGoal} / {currentReadingGoal.characterGoal} 字 ({characterGoalPercentage}%)
        </div>
        <!-- eslint-disable-next-line svelte/no-unknown-style-directive-property -->
        <div class="w-full rounded-full h-2.5" style:background-Color={fontColor}>
          <!-- eslint-disable svelte/no-unknown-style-directive-property -->
          <div
            class="h-2.5 rounded-full opacity-70"
            style:width={`${Math.min(100, characterGoalPercentage)}%`}
            style:background-Color={backgroundColor}
          ></div>
          <!-- eslint-enable svelte/no-unknown-style-directive-property -->
        </div>
      {/if}
      <div class="grid grid-cols-[max-content,auto] gap-x-4 gap-y-2 mt-4">
        <div>当前阅读目标:</div>
        <div class="flex flex-col sm:block">
          <span>{currentReadingGoalStart}</span>
          {#if currentReadingGoalEnd && currentReadingGoalStart !== currentReadingGoalEnd}
            <span>-</span>
            <span>{currentReadingGoalEnd}</span>
          {/if}
        </div>
        <div>剩余时间:</div>
        <div>
          {remainingTimeInReadingGoalWindow}
        </div>
      </div>
    </div>
  {/if}
  {#each allStatistics as statistic (statistic.id)}
    <div class="mb-7 last:mb-4">
      <div class="flex items-center">
        <div>
          {statistic.id}
        </div>
        {#if statistic.id === '当前会话'}
          {#each actions as action (action.event)}
            {#if action.event !== 'saveStatistics' || (action.event === 'saveStatistics' && canSaveStatistics)}
              <div
                tabindex="0"
                role="button"
                class="ml-4 hover:text-red-500"
                title={action.title}
                on:click={() => executeAction(action.event)}
                on:keyup={dummyFn}
              >
                <Fa icon={getActionIcon(action, wasTrackerPaused)} />
              </div>
            {/if}
          {/each}
        {/if}
      </div>
      <hr />
      <div class="grid grid-cols-[max-content,auto] gap-x-4 gap-y-2">
        {#if statistic.id === '累计'}
          <div class="mt-3">开始阅读日期:</div>
          <div class="mt-3">{bookStartDate}</div>
        {/if}
        {#if statistic.id === '已完成' && bookCompletionStatistics}
          <div class="mt-3">完成日期:</div>
          <div class="mt-3">{bookCompletionStatistics.dateKey}</div>
        {/if}
        <button
          class="text-left"
          class:mt-3={statistic.id !== '累计' && statistic.id !== '已完成'}
          on:click={() => handleBlurredKey('charactersRead')}
        >
          {statistic.sectionsTotal ? '已读页数:' : '已读字数:'}
        </button>
        <div
          role="button"
          tabindex="0"
          class:blur={$lastBlurredTrackerItems$.has('charactersRead')}
          class:mt-3={statistic.id !== '累计' && statistic.id !== '已完成'}
          on:click={() => handleBlurredKey('charactersRead')}
          on:keyup={dummyFn}
        >
          {#if statistic.sectionsTotal}
            {statistic.sectionsRead ?? 0} / {statistic.sectionsTotal}
          {:else}
            {statistic.charactersRead}
          {/if}
        </div>
        <button class="text-left" on:click={() => handleBlurredKey('lastReadingSpeed')}>
          阅读速度:
        </button>
        <div
          role="button"
          tabindex="0"
          class:blur={$lastBlurredTrackerItems$.has('lastReadingSpeed')}
          on:click={() => handleBlurredKey('lastReadingSpeed')}
          on:keyup={dummyFn}
        >
          {statistic.lastReadingSpeed} / h
        </div>
        <button class="text-left" on:click={() => handleBlurredKey('readingTime')}>
          阅读时间:
        </button>
        <div
          role="button"
          tabindex="0"
          class:blur={$lastBlurredTrackerItems$.has('readingTime')}
          on:click={() => handleBlurredKey('readingTime')}
          on:keyup={dummyFn}
        >
          {toTimeString(statistic.readingTime)}
        </div>
        {#if statistic.id === '当前会话'}
          <button class="text-left" on:click={() => handleBlurredKey('finishETA')}>
            预计读完本书:
          </button>
          <div
            role="button"
            tabindex="0"
            class:blur={$lastBlurredTrackerItems$.has('finishETA')}
            on:click={() => handleBlurredKey('finishETA')}
            on:keyup={dummyFn}
          >
            {timeToFinishBook}
          </div>
          {#if timeToFinishChapter}
            <button class="text-left" on:click={() => handleBlurredKey('finishChapterETA')}>
              预计读完本章:
            </button>
            <div
              role="button"
              tabindex="0"
              class:blur={$lastBlurredTrackerItems$.has('finishChapterETA')}
              on:click={() => handleBlurredKey('finishChapterETA')}
              on:keyup={dummyFn}
            >
              {timeToFinishChapter}
            </div>
          {/if}

          <div class="mt-3">当前位置:</div>
          <div class="mt-3">{lastExploredCharCount}</div>
          <div>上次位置</div>
          <div>{previousLastExploredCharCount}</div>
          {#if frozenPosition > -1}
            <div>冻结位置</div>
            <div>{frozenPosition}</div>
          {/if}
        {/if}
      </div>
      {#if statistic.id === '当前会话' && trackingHistoryItems.length}
        <details class="mt-3 mr-4">
          <summary class="cursor-pointer">最近历史</summary>
          <div class="grid grid-cols-[repeat(4,max-content)] gap-x-8 items-center">
            {#each trackingHistoryItems as trackingHistoryItem (trackingHistoryItem.id)}
              <div>{trackingHistoryItem.dateTimeKey}</div>
              <div
                class:text-green-500={trackingHistoryItem.timeDiff > 0}
                class:text-red-500={trackingHistoryItem.timeDiff < 0}
              >
                {trackingHistoryItem.timeDiff}
              </div>
              <div
                class:text-green-500={trackingHistoryItem.characterDiff > 0}
                class:text-red-500={trackingHistoryItem.characterDiff < 0}
              >
                {trackingHistoryItem.characterDiff}
              </div>
              <div class="flex">
                <button
                  title="撤销项目"
                  class="hover:text-red-500"
                  on:click={() => dispatch('revertStatistic', trackingHistoryItem)}
                >
                  <Fa icon={faTrash} />
                </button>
                <div
                  title="已保存到数据库"
                  class="ml-4 cursor-not-allowed"
                  class:text-green-500={trackingHistoryItem.saved}
                >
                  <Fa icon={faFloppyDisk} />
                </div>
              </div>
            {/each}
          </div>
          <div class="flex justify-between mt-3">
            <button
              title={currentTrackingHistoryIndex === 0 ? '' : '上一页'}
              disabled={currentTrackingHistoryIndex === 0}
              class:opacity-50={currentTrackingHistoryIndex === 0}
              class:cursor-not-allowed={currentTrackingHistoryIndex === 0}
              on:click={() => (trackingHistoryIndex -= 1)}
            >
              <Fa icon={faChevronLeft} />
            </button>
            <button
              title={hasNextPage ? '下一页' : ''}
              disabled={!hasNextPage}
              class:opacity-50={!hasNextPage}
              class:cursor-not-allowed={!hasNextPage}
              on:click={() => (trackingHistoryIndex += 1)}
            >
              <Fa icon={faChevronRight} />
            </button>
          </div>
        </details>
      {/if}
    </div>
  {/each}
  {#if actionInProgress}
    <div class="tap-highlight-transparent absolute inset-0 bg-black/[.2]" />
    <div class="absolute inset-0 flex h-full w-full items-center justify-center text-7xl">
      <Fa icon={faSpinner} spin />
    </div>
  {/if}
</div>
