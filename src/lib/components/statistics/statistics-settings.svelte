<script lang="ts">
  import {
    faCircleQuestion,
    faLeftLong,
    faRightLong,
    faXmark
  } from '@fortawesome/free-solid-svg-icons';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import { optionsForToggle } from '$lib/components/button-toggle-group/toggle-option';
  import Popover from '$lib/components/popover/popover.svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import {
    type StatisticsDateChange,
    statisticsRangeTemplates,
    readingTimeDataSources,
    charactersDataSources,
    readingSpeedDataSources,
    statisticsDataAggregrationModes,
    exportStatisticsData$,
    statisticsActionInProgress$,
    deleteStatisticsData$,
    setStatisticsDatesToAllTime$
  } from '$lib/components/statistics/statistics-types';
  // Was imported from the now-deleted statistics-heatmap module — inlined
  // because the 7-item constant isn't worth its own file.
  const daysOfWeek = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  import { dialogManager } from '$lib/data/dialog-manager';
  import {
    confirmStatisticsDeletion$,
    lastCharactersDataSource$,
    lastPrimaryReadingDataAggregationMode$,
    lastReadingSpeedDataSource$,
    lastReadingTimeDataSource$,
    lastStartDayOfWeek$,
    lastStatisticsEndDate$,
    lastStatisticsRangeTemplate$,
    lastStatisticsStartDate$
  } from '$lib/data/store';
  import {
    statisticsTitleFilterEnabled$,
    statisticsTitleFilterIsOpen$
  } from '$lib/components/statistics/statistics-types';
  import { createEventDispatcher, onMount } from 'svelte';
  import Fa from 'svelte-fa';

  const dispatch = createEventDispatcher<{
    close: void;
    statisticsDateChange: StatisticsDateChange;
  }>();

  const weekDays = [...daysOfWeek.slice(1, 7), daysOfWeek[0]].map((day, index) => {
    if (day === '周日') {
      return { day, index: 0 };
    }
    return { day, index: index + 1 };
  });

  $: selectedStatisticsStartDate = $lastStatisticsStartDate$;

  $: selectedStatisticsEndDate = $lastStatisticsEndDate$;

  onMount(() => {
    dialogManager.dialogs$.next([{ component: '<div/>' }]);

    return () => dialogManager.dialogs$.next([]);
  });

  async function exportStatisticsData(exportAllStatisticsData = true) {
    $statisticsActionInProgress$ = true;

    exportStatisticsData$.next(exportAllStatisticsData);
  }

  async function deleteStatisticsData(deleteAllStatisticsData = true) {
    $statisticsActionInProgress$ = true;

    deleteStatisticsData$.next(deleteAllStatisticsData);
  }

  function openTitleFilter() {
    // Close this drawer first so the filter drawer isn't stacked underneath.
    dispatch('close');
    statisticsTitleFilterIsOpen$.next(true);
  }
</script>

<div class="flex items-center p-4">
  <button class="flex items-end md:items-center" on:click={() => dispatch('close')}>
    <Fa icon={faXmark} />
  </button>
  <div class="flex flex-1 justify-end">
    <button
      class="mr-2 sm:mr-4 hover-danger"
      class:opacity-40={!$statisticsTitleFilterEnabled$}
      disabled={!$statisticsTitleFilterEnabled$}
      title={$statisticsTitleFilterEnabled$ ? '按书名筛选' : '当前视图无可筛选内容'}
      on:click={openTitleFilter}
    >
      筛选书籍
    </button>
    <button class="mr-2 sm:mr-4 hover-danger" on:click={() => exportStatisticsData(false)}>
      导出选中项
    </button>
    <button class="mr-2 sm:mr-4 hover-danger" on:click={() => deleteStatisticsData(false)}>
      删除选中项
    </button>
    <button class="mr-2 sm:mr-4 hover-danger" on:click={() => exportStatisticsData()}>
      导出全部
    </button>
    <button class="hover-danger" on:click={() => deleteStatisticsData()}>删除全部</button>
  </div>
</div>
<div class="flex-1 p-4 overflow-auto">
  <div class="flex flex-col mb-6">
    <label for="datesTemplate">模板</label>
    <select id="datesTemplate" class="settings-input" bind:value={$lastStatisticsRangeTemplate$}>
      {#each statisticsRangeTemplates as statisticsRangeTemplate (statisticsRangeTemplate)}
        <option value={statisticsRangeTemplate}>
          {statisticsRangeTemplate}
        </option>
      {/each}
    </select>
  </div>
  <div class="flex flex-col mb-4 sm:hidden">
    <label for="weekDay">每周起始日</label>
    <select id="weekDay" class="settings-input" bind:value={$lastStartDayOfWeek$}>
      {#each weekDays as weekDay (weekDay.day)}
        <option value={weekDay.index}>
          {weekDay.day}
        </option>
      {/each}
    </select>
  </div>
  <div class="flex justify-between sm:flex-row">
    <div class="flex flex-col">
      <label for="fromDate">从</label>
      <input
        id="fromDate"
        type="date"
        class="settings-input"
        bind:value={selectedStatisticsStartDate}
        on:change={() =>
          dispatch('statisticsDateChange', {
            isStartDate: true,
            dateString: selectedStatisticsStartDate
          })}
      />
    </div>
    <div class="flex flex-col justify-between pt-4 mx-2 text-xl sm:mx-0">
      <button
        on:click={() =>
          dispatch('statisticsDateChange', {
            isStartDate: false,
            dateString: selectedStatisticsStartDate
          })}
      >
        <Fa icon={faRightLong} />
      </button>
      <button
        on:click={() =>
          dispatch('statisticsDateChange', {
            isStartDate: true,
            dateString: selectedStatisticsEndDate
          })}
      >
        <Fa icon={faLeftLong} />
      </button>
    </div>
    <div class="flex flex-col">
      <label for="toDate">到</label>
      <input
        id="toDate"
        type="date"
        class="settings-input"
        bind:value={selectedStatisticsEndDate}
        on:change={() =>
          dispatch('statisticsDateChange', {
            isStartDate: false,
            dateString: selectedStatisticsEndDate
          })}
      />
    </div>
    <div class="flex-col hidden sm:flex">
      <label for="weekDay">每周起始日</label>
      <select id="weekDay" class="settings-input" bind:value={$lastStartDayOfWeek$}>
        {#each weekDays as weekDay (weekDay.day)}
          <option value={weekDay.index}>
            {weekDay.day}
          </option>
        {/each}
      </select>
    </div>
  </div>
  <button
    class="text-left mt-3 hover-danger"
    on:click={() => setStatisticsDatesToAllTime$.next()}
  >
    设置为所选书籍的全部时间
  </button>
  <div class="flex flex-wrap justify-between mt-4">
    <div class="flex flex-col my-2 w-full sm:w-[initial]">
      <Popover
        contentText={'汇总标签页应使用的阅读时间属性'}
        contentStyles="padding: 0.5rem;"
      >
        <Fa icon={faCircleQuestion} slot="icon" class="mx-2" />
        <label for="timeDataSource">时间数据来源</label>
      </Popover>
      <select id="timeDataSource" class="settings-input" bind:value={$lastReadingTimeDataSource$}>
        {#each readingTimeDataSources as readingTimeDataSource (readingTimeDataSource.key)}
          <option value={readingTimeDataSource.key}>
            {readingTimeDataSource.label}
          </option>
        {/each}
      </select>
    </div>
    <div class="flex flex-col my-2 w-full sm:w-[initial]">
      <Popover
        contentText={'汇总标签页应使用的已读字数属性'}
        contentStyles="padding: 0.5rem; max-width: 20rem;"
      >
        <Fa icon={faCircleQuestion} slot="icon" class="mx-2" />
        <label for="charactersSource">字数数据来源</label>
      </Popover>
      <select id="charactersSource" class="settings-input" bind:value={$lastCharactersDataSource$}>
        {#each charactersDataSources as charactersDataSource (charactersDataSource.key)}
          <option value={charactersDataSource.key}>
            {charactersDataSource.label}
          </option>
        {/each}
      </select>
    </div>
    <div class="flex flex-col my-2 w-full sm:w-[initial]">
      <Popover
        contentText={'汇总标签页应使用的阅读速度属性'}
        contentStyles="padding: 0.5rem;"
      >
        <Fa icon={faCircleQuestion} slot="icon" class="mx-2" />
        <label for="speedSource">速度数据来源</label>
      </Popover>
      <select id="speedSource" class="settings-input" bind:value={$lastReadingSpeedDataSource$}>
        {#each readingSpeedDataSources as readingSpeedDataSource (readingSpeedDataSource.key)}
          <option value={readingSpeedDataSource.key}>
            {readingSpeedDataSource.label}
          </option>
        {/each}
      </select>
    </div>
  </div>
  <div class="flex flex-col mt-4">
    <Popover
      contentText={'决定汇总标签页数据按哪个主要属性分组'}
      contentStyles="padding: 0.5rem;"
    >
      <Fa icon={faCircleQuestion} slot="icon" class="mx-2" />
      <label for="primaryAggregration">主要聚合方式</label>
    </Popover>
    <select
      id="primaryAggregration"
      class="settings-input"
      bind:value={$lastPrimaryReadingDataAggregationMode$}
    >
      {#each statisticsDataAggregrationModes as statisticsDataAggregrationMode (statisticsDataAggregrationMode)}
        <option value={statisticsDataAggregrationMode}>
          {statisticsDataAggregrationMode}
        </option>
      {/each}
    </select>
  </div>
  <div class="mt-4">
    <SettingsItemGroup title="确认统计删除" applyHeaderClasses={false}>
      <ButtonToggleGroup
        invertColors
        options={optionsForToggle}
        bind:selectedOptionId={$confirmStatisticsDeletion$}
      />
    </SettingsItemGroup>
  </div>
</div>
