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
    statisticsRangeTemplateLabelKey,
    statisticsAggregationModeLabelKey,
    readingTimeDataSources,
    charactersDataSources,
    readingSpeedDataSources,
    statisticsDataAggregrationModes,
    exportStatisticsData$,
    statisticsActionInProgress$,
    deleteStatisticsData$,
    setStatisticsDatesToAllTime$
  } from '$lib/components/statistics/statistics-types';
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
  import { t } from '$lib/i18n';

  const dispatch = createEventDispatcher<{
    close: void;
    statisticsDateChange: StatisticsDateChange;
  }>();

  // Day indexes as Date#getDay() counts them, listed Monday first.
  const weekDays = [1, 2, 3, 4, 5, 6, 0];

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

<div class="settings-scope flex items-center p-4">
  <button class="flex items-end md:items-center" on:click={() => dispatch('close')}>
    <Fa icon={faXmark} />
  </button>
  <div class="flex flex-1 justify-end">
    <button
      class="mr-2 sm:mr-4 hover-danger"
      class:opacity-40={!$statisticsTitleFilterEnabled$}
      disabled={!$statisticsTitleFilterEnabled$}
      title={$statisticsTitleFilterEnabled$ ? $t('stats.filter.byTitle') : $t('stats.filter.unavailable')}
      on:click={openTitleFilter}
    >
      {$t('stats.filter.books')}
    </button>
    <button class="mr-2 sm:mr-4 hover-danger" on:click={() => exportStatisticsData(false)}>
      {$t('stats.action.exportSelected')}
    </button>
    <button class="mr-2 sm:mr-4 hover-danger" on:click={() => deleteStatisticsData(false)}>
      {$t('stats.action.deleteSelected')}
    </button>
    <button class="mr-2 sm:mr-4 hover-danger" on:click={() => exportStatisticsData()}>
      {$t('stats.action.exportAll')}
    </button>
    <button class="hover-danger" on:click={() => deleteStatisticsData()}>{$t('stats.action.deleteAll')}</button>
  </div>
</div>
<div class="settings-scope flex-1 p-4 overflow-auto">
  <div class="flex flex-col mb-6">
    <label for="datesTemplate">{$t('stats.settings.template')}</label>
    <select id="datesTemplate" class="settings-input" bind:value={$lastStatisticsRangeTemplate$}>
      {#each statisticsRangeTemplates as statisticsRangeTemplate (statisticsRangeTemplate)}
        <option value={statisticsRangeTemplate}>
          {$t(statisticsRangeTemplateLabelKey[statisticsRangeTemplate])}
        </option>
      {/each}
    </select>
  </div>
  <div class="flex flex-col mb-4 sm:hidden">
    <label for="weekDay">{$t('stats.settings.weekStart')}</label>
    <select id="weekDay" class="settings-input" bind:value={$lastStartDayOfWeek$}>
      {#each weekDays as weekDay (weekDay)}
        <option value={weekDay}>
          {$t('stats.weekdayLong.' + weekDay)}
        </option>
      {/each}
    </select>
  </div>
  <div class="flex justify-between sm:flex-row">
    <div class="flex flex-col">
      <label for="fromDate">{$t('stats.settings.from')}</label>
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
      <label for="toDate">{$t('stats.settings.to')}</label>
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
      <label for="weekDay">{$t('stats.settings.weekStart')}</label>
      <select id="weekDay" class="settings-input" bind:value={$lastStartDayOfWeek$}>
        {#each weekDays as weekDay (weekDay)}
          <option value={weekDay}>
            {$t('stats.weekdayLong.' + weekDay)}
          </option>
        {/each}
      </select>
    </div>
  </div>
  <button
    class="text-left mt-3 hover-danger"
    on:click={() => setStatisticsDatesToAllTime$.next()}
  >
    {$t('stats.settings.allTimeForSelected')}
  </button>
  <div class="flex flex-wrap justify-between mt-4">
    <div class="flex flex-col my-2 w-full sm:w-[initial]">
      <Popover
        contentText={$t('stats.settings.timeSourceTip')}
        contentStyles="padding: 0.5rem;"
      >
        <Fa icon={faCircleQuestion} slot="icon" class="mx-2" />
        <label for="timeDataSource">{$t('stats.settings.timeSource')}</label>
      </Popover>
      <select id="timeDataSource" class="settings-input" bind:value={$lastReadingTimeDataSource$}>
        {#each readingTimeDataSources as readingTimeDataSource (readingTimeDataSource.key)}
          <option value={readingTimeDataSource.key}>
            {$t(readingTimeDataSource.labelKey)}
          </option>
        {/each}
      </select>
    </div>
    <div class="flex flex-col my-2 w-full sm:w-[initial]">
      <Popover
        contentText={$t('stats.settings.charsSourceTip')}
        contentStyles="padding: 0.5rem; max-width: 20rem;"
      >
        <Fa icon={faCircleQuestion} slot="icon" class="mx-2" />
        <label for="charactersSource">{$t('stats.settings.charsSource')}</label>
      </Popover>
      <select id="charactersSource" class="settings-input" bind:value={$lastCharactersDataSource$}>
        {#each charactersDataSources as charactersDataSource (charactersDataSource.key)}
          <option value={charactersDataSource.key}>
            {$t(charactersDataSource.labelKey)}
          </option>
        {/each}
      </select>
    </div>
    <div class="flex flex-col my-2 w-full sm:w-[initial]">
      <Popover
        contentText={$t('stats.settings.speedSourceTip')}
        contentStyles="padding: 0.5rem;"
      >
        <Fa icon={faCircleQuestion} slot="icon" class="mx-2" />
        <label for="speedSource">{$t('stats.settings.speedSource')}</label>
      </Popover>
      <select id="speedSource" class="settings-input" bind:value={$lastReadingSpeedDataSource$}>
        {#each readingSpeedDataSources as readingSpeedDataSource (readingSpeedDataSource.key)}
          <option value={readingSpeedDataSource.key}>
            {$t(readingSpeedDataSource.labelKey)}
          </option>
        {/each}
      </select>
    </div>
  </div>
  <div class="flex flex-col mt-4">
    <Popover
      contentText={$t('stats.settings.aggregationTip')}
      contentStyles="padding: 0.5rem;"
    >
      <Fa icon={faCircleQuestion} slot="icon" class="mx-2" />
      <label for="primaryAggregration">{$t('stats.settings.aggregation')}</label>
    </Popover>
    <select
      id="primaryAggregration"
      class="settings-input"
      bind:value={$lastPrimaryReadingDataAggregationMode$}
    >
      {#each statisticsDataAggregrationModes as statisticsDataAggregrationMode (statisticsDataAggregrationMode)}
        <option value={statisticsDataAggregrationMode}>
          {$t(statisticsAggregationModeLabelKey[statisticsDataAggregrationMode])}
        </option>
      {/each}
    </select>
  </div>
  <div class="mt-4">
    <SettingsItemGroup title={$t('stats.settings.confirmDelete')} applyHeaderClasses={false}>
      <ButtonToggleGroup
        invertColors
        options={optionsForToggle}
        bind:selectedOptionId={$confirmStatisticsDeletion$}
      />
    </SettingsItemGroup>
  </div>
</div>
