<script lang="ts">
  import { onKeyUpStatisticsTab } from '../../../routes/b/on-keydown-reader';
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import { getDefaultStatistic } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import StatisticsMain from '$lib/components/statistics/statistics-main/statistics-main.svelte';
  import StatisticsSessions from '$lib/components/statistics/statistics-sessions/statistics-sessions.svelte';
  import StatisticsSummary from '$lib/components/statistics/statistics-summary/statistics-summary.svelte';
  import StatisticsYear from '$lib/components/statistics/statistics-year/statistics-year.svelte';
  import StatisticsManualEntryDialog from '$lib/components/statistics/statistics-manual-entry-dialog.svelte';
  import StatisticsHighlights from '$lib/components/statistics/statistics-highlights/statistics-highlights.svelte';
  import type {
    StatisticsDeleteRequest,
    StatisticsEditRequest
  } from '$lib/components/statistics/statistics-summary/statistics-summary';
  import StatisticsTitleFilter from '$lib/components/statistics/statistics-title-filter.svelte';
  import {
    type BookStatistic,
    type ManualStatisticEntry,
    StatisticsTab,
    StatisticsReadingDataAggregationMode,
    statisticsRangeTemplates,
    statisticsTitleFilterEnabled$,
    statisticsTitleFilterIsOpen$,
    type StatisticsTitleFilterItem,
    preFilteredTitlesForStatistics$,
    statisticsDataAggregrationModes,
    exportStatisticsData$,
    exportYearReport$,
    openManualStatisticsEntry$,
    statisticsActionInProgress$,
    deleteStatisticsData$,
    setStatisticsDatesToAllTime$,
    StatisticsRangeTemplate
  } from '$lib/components/statistics/statistics-types';
  import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { logger } from '$lib/data/logger';
  import { getDateRangeLabel } from '$lib/data/reading-goal';
  import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
  import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
  import {
    confirmStatisticsDeletion$,
    database,
    lastPrimaryReadingDataAggregationMode$,
    lastStatisticsEndDate$,
    lastStatisticsRangeTemplate$,
    lastStatisticsStartDate$,
    lastStatisticsTab$,
    skipKeyDownListener$,
    startDayHoursForTracker$,
    statisticsTabKeybindMap$
  } from '$lib/data/store';
  import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
  import { secondsToMinutes } from '$lib/functions/statistic-util';
  import { clickOutside } from '$lib/functions/use-click-outside';
  import { pluralize } from '$lib/functions/utils';
  import pLimit from 'p-limit';
  import { tap } from 'rxjs';
  import { onDestroy, onMount, tick } from 'svelte';
  import Fa from 'svelte-fa';
  import { quintInOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';

  const exportStatisticsDataHandler$ = exportStatisticsData$.pipe(
    tap(async (exportAllData) => {
      try {
        const statisticsDataToExport = new Map<string, BooksDbStatistic[]>();

        for (let index = 0; index < statisticsData.length; index += 1) {
          const {
            title,
            dateKey,
            charactersRead,
            readingTime,
            minReadingSpeed,
            altMinReadingSpeed,
            lastReadingSpeed,
            maxReadingSpeed,
            lastStatisticModified,
            completedBook,
            completedData
          } = statisticsData[index];

          if (
            exportAllData ||
            (statisticsTitleFilters.get(title) &&
              dateKey >= $lastStatisticsStartDate$ &&
              dateKey <= $lastStatisticsEndDate$)
          ) {
            const entries = statisticsDataToExport.get(title) || [];

            entries.push({
              title,
              dateKey,
              charactersRead,
              readingTime,
              minReadingSpeed,
              altMinReadingSpeed,
              lastReadingSpeed,
              maxReadingSpeed,
              lastStatisticModified,
              completedBook,
              completedData
            });

            statisticsDataToExport.set(title, entries);
          }
        }

        const entriesToExport = [...statisticsDataToExport.entries()];
        const backupHandler = getStorageHandler(window, StorageKey.BACKUP);
        const exportLimiter = pLimit(1);
        const exportTasks: Promise<void>[] = [];

        backupHandler.clearData();

        entriesToExport.forEach(([titleToExport, dataToExport]) =>
          exportTasks.push(
            exportLimiter(async () => {
              try {
                const lastStatisticsModified = await database.getLastModifiedForType(
                  titleToExport,
                  StorageDataType.STATISTICS
                );

                if (dataToExport.length) {
                  backupHandler.startContext({ id: 0, title: titleToExport, imagePath: '' });

                  await backupHandler.saveStatistics(dataToExport, lastStatisticsModified);
                }
              } catch (error) {
                exportLimiter.clearQueue();

                throw error;
              }
            })
          )
        );

        if (entriesToExport.length) {
          exportTasks.push(
            exportLimiter(async () => backupHandler.createExportZip(document, false))
          );
        }

        await Promise.all(exportTasks).finally(() => backupHandler.clearData());
      } catch ({ message }: any) {
        logger.error(`Failed to Export Data: ${message}`);
      } finally {
        $statisticsActionInProgress$ = false;
      }
    }),
    reduceToEmptyString()
  );

  const deleteStatisticsDataHandler$ = deleteStatisticsData$.pipe(
    tap(async (deleteAllData) => {
      const dataList = deleteAllData ? statisticsData : statisticsForSelection;
      const request: StatisticsDeleteRequest = {
        startDate: deleteAllData ? '' : $lastStatisticsStartDate$,
        endDate: deleteAllData ? '' : $lastStatisticsEndDate$,
        titlesToCheck: new Set<string>(),
        takeAsIs: true
      };

      for (let index = 0, { length } = dataList; index < length; index += 1) {
        request.titlesToCheck.add(dataList[index].title);
      }

      handleDeleteRequest(
        new CustomEvent<StatisticsDeleteRequest>('delete', { detail: request })
      ).finally(() => {
        tick().then(() => dialogManager.dialogs$.next([{ component: '<div/>' }]));
      });
    }),
    reduceToEmptyString()
  );

  const setStatisticsDatesToAllTimeHandler$ = setStatisticsDatesToAllTime$.pipe(
    tap(() => {
      if (!statisticsTitleFilters.size) {
        return;
      }

      let startDate = '';

      for (let index = 0, { length } = statisticsData; index < length; index += 1) {
        const statistic = statisticsData[index];

        if (statisticsTitleFilters.get(statistic.title)) {
          startDate = statistic.dateKey;
          break;
        }
      }

      if (!startDate) {
        return;
      }

      for (let index = statisticsData.length - 1; index >= 0; index -= 1) {
        const statistic = statisticsData[index];

        if (statisticsTitleFilters.get(statistic.title)) {
          $lastStatisticsStartDate$ = startDate;
          $lastStatisticsEndDate$ = statistic.dateKey;
          $lastStatisticsRangeTemplate$ = StatisticsRangeTemplate.CUSTOM;
          break;
        }
      }
    }),
    reduceToEmptyString()
  );

  const exportYearReportHandler$ = exportYearReport$.pipe(
    tap(async () => {
      $statisticsActionInProgress$ = true;
      try {
        const { aggregateHighlightStats } = await import('$lib/functions/highlight-stats');
        const { computeYearSummary } = await import(
          '$lib/components/statistics/statistics-year/year-summary'
        );
        const { buildYearReportMarkdown } = await import('$lib/functions/year-report');

        const [highlights, sessions] = await Promise.all([
          database.getAllHighlights(),
          database.getAllSessions()
        ]);

        const scopedStatistics = statisticsData.filter(
          (s) =>
            s.dateKey >= $lastStatisticsStartDate$ &&
            s.dateKey <= $lastStatisticsEndDate$ &&
            (!statisticsTitleFilters.size || statisticsTitleFilters.get(s.title))
        );

        const highlightSummary = aggregateHighlightStats(highlights, {
          startDate: $lastStatisticsStartDate$,
          endDate: $lastStatisticsEndDate$,
          startDayHoursForTracker: $startDayHoursForTracker$,
          titleFilter: statisticsTitleFilters
        });

        // Pick the year that contains the range start. Multi-year ranges get
        // the start year's picture; users who want the other year just export
        // twice with a shifted range.
        const yearRaw = Number(($lastStatisticsStartDate$ || '').slice(0, 4));
        const year = Number.isFinite(yearRaw) && yearRaw > 0 ? yearRaw : new Date().getFullYear();
        const yearSummary = computeYearSummary({
          year,
          startDayHours: $startDayHoursForTracker$,
          statistics: statisticsData,
          sessions
        });

        const md = buildYearReportMarkdown({
          label: statisticsDateRangeLabel,
          startDate: $lastStatisticsStartDate$,
          endDate: $lastStatisticsEndDate$,
          statistics: scopedStatistics,
          highlights: highlightSummary,
          year: yearSummary
        });

        const safeLabel = statisticsDateRangeLabel.replace(/[^\w一-鿿-]+/g, '-');
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `autobook-report-${safeLabel || 'range'}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (error: any) {
        dialogManager.dialogs$.next([
          {
            component: MessageDialog,
            props: { title: '错误', message: `导出失败：${error?.message ?? error}` }
          }
        ]);
      } finally {
        $statisticsActionInProgress$ = false;
      }
    }),
    reduceToEmptyString()
  );

  const manualEntryHandler$ = openManualStatisticsEntry$.pipe(
    tap(async () => {
      const existingKeys: string[] = [];
      for (let index = 0, { length } = statisticsData; index < length; index += 1) {
        const s = statisticsData[index];
        existingKeys.push(`${s.title}__${s.dateKey}`);
      }

      // Extracted so both "添加" (final close) and "保存并继续" can share
      // the same upsert + local table refresh + title-filter update.
      const applyEntry = async (entry: ManualStatisticEntry) => {
        const { statistic } = await database.upsertManualStatistic(entry);
        const nextRow: BookStatistic = {
          ...statistic,
          id: `${statistic.title}_${statistic.dateKey}`,
          averageReadingTime: statistic.readingTime,
          averageWeightedReadingTime: statistic.readingTime,
          averageCharactersRead: statistic.charactersRead,
          averageWeightedCharactersRead: statistic.charactersRead,
          averageReadingSpeed: statistic.lastReadingSpeed,
          averageWeightedReadingSpeed: statistic.lastReadingSpeed
        };
        const existingIndex = statisticsData.findIndex(
          (s) => s.title === statistic.title && s.dateKey === statistic.dateKey
        );
        if (existingIndex >= 0) {
          statisticsData[existingIndex] = nextRow;
        } else {
          statisticsData = [...statisticsData, nextRow].sort((a, b) =>
            a.dateKey > b.dateKey ? 1 : -1
          );
        }
        if (!statisticsTitleFilters.has(statistic.title)) {
          statisticsTitleFilters.set(statistic.title, true);
          statisticsTitleFilters = statisticsTitleFilters;
        }
        // Also refresh existingKeys so the conflict banner stays
        // accurate across successive "保存并继续" clicks.
        const dupKey = `${statistic.title}__${statistic.dateKey}`;
        if (!existingKeys.includes(dupKey)) existingKeys.push(dupKey);
        updateStatisticsData();
      };

      const result = await new Promise<ManualStatisticEntry | undefined>((resolver) => {
        dialogManager.dialogs$.next([
          {
            component: StatisticsManualEntryDialog,
            props: {
              existingTitles: existingKeys,
              startDayHoursForTracker: $startDayHoursForTracker$,
              resolver,
              onSaveAndContinue: applyEntry
            },
            disableCloseOnClick: true,
            zIndex: '70'
          }
        ]);
      });

      if (!result) return;

      $statisticsActionInProgress$ = true;

      try {
        await applyEntry(result);
      } catch (error: any) {
        dialogManager.dialogs$.next([
          {
            component: MessageDialog,
            props: {
              title: '错误',
              message: `添加失败：${error?.message ?? error}`
            }
          }
        ]);
      } finally {
        $statisticsActionInProgress$ = false;
      }
    }),
    reduceToEmptyString()
  );

  let isLoading = true;
  let statisticsTitleFilters = new Map<string, boolean>();
  let titlesInStatisticsDateRange = new Set<string>();
  let statisticsData: BookStatistic[] = [];
  let statisticsForSelection: BookStatistic[] = [];
  let aggregratedStatistics: BookStatistic[] = [];
  // Sessions load lazily the first time a session-aware tab (main tab
  // from 1.19.0, year tab pre-existing) is opened. Kept as a snapshot;
  // gets stale if the user reads mid-session but that's fine — the
  // panel is re-entered on every open so a fresh load happens then.
  let sessions: import('$lib/data/database/books-db/versions/books-db').BooksDbSession[] = [];
  let sessionsLoaded = false;
  let sessionsLoading = false;

  async function ensureSessionsLoaded() {
    if (sessionsLoaded || sessionsLoading) return;
    sessionsLoading = true;
    try {
      sessions = await database.getAllSessions();
      sessionsLoaded = true;
    } finally {
      sessionsLoading = false;
    }
  }

  $: if (
    ($lastStatisticsTab$ === StatisticsTab.MAIN ||
      $lastStatisticsTab$ === StatisticsTab.SESSIONS) &&
    !sessionsLoaded
  ) {
    ensureSessionsLoaded();
  }

  $: statisticsDateRangeLabel = getDateRangeLabel(
    $lastStatisticsStartDate$,
    $lastStatisticsEndDate$
  );

  $: if (
    statisticsData &&
    $lastPrimaryReadingDataAggregationMode$ &&
    $lastStatisticsStartDate$ &&
    $lastStatisticsEndDate$
  ) {
    updateStatisticsData();
  }

  onMount(init);

  onDestroy(() => dialogManager.dialogs$.next([]));

  function onKeyUp(ev: KeyboardEvent) {
    if (
      $skipKeyDownListener$ ||
      ev.altKey ||
      ev.ctrlKey ||
      ev.shiftKey ||
      ev.metaKey ||
      ev.repeat
    ) {
      return;
    }

    const result = onKeyUpStatisticsTab(
      ev,
      statisticsTabKeybindMap$.getValue(),
      toggleStatisticsRangeTemplate,
      toggleStatisticsDataAggregationMode
    );

    if (!result) return;

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    ev.preventDefault();
  }

  async function handleDeleteRequest({
    detail: { startDate, endDate, titlesToCheck, takeAsIs }
  }: CustomEvent<StatisticsDeleteRequest>) {
    let titlesToDelete = new Set<string>();

    $statisticsActionInProgress$ = true;

    if (takeAsIs) {
      titlesToDelete = titlesToCheck;
    } else {
      for (let index = 0, { length } = statisticsForSelection; index < length; index += 1) {
        const statistic = statisticsForSelection[index];

        if (
          statistic.dateKey >= startDate &&
          statistic.dateKey <= endDate &&
          (!titlesToCheck.size || titlesToCheck.has(statistic.title))
        ) {
          titlesToDelete.add(statistic.title);
        }
      }
    }

    if (!titlesToDelete.size) {
      $statisticsActionInProgress$ = false;
      return;
    }

    const titleLabel = pluralize(titlesToDelete.size, '书籍');

    let wasCanceled = false;

    if ($confirmStatisticsDeletion$) {
      wasCanceled = await new Promise((resolver) => {
        dialogManager.dialogs$.next([
          {
            component: ConfirmDialog,
            props: {
              dialogHeader: '删除数据',
              dialogMessage: `This will delete data ${
                startDate ? `from ${getDateRangeLabel(startDate, endDate)}` : ''
              }  for ${titleLabel} (which may include start and/or completion Data)\n\nExecute an one time Sync with an export behavior of "overwrite" and/or statistics merge mode of "replace" to apply deletions to other devices.\n\n${titleLabel}:\n${[
                ...titlesToDelete
              ].join('\n\n')}`,
              contentStyles: 'white-space: pre-line;max-height: 20rem;overflow: auto;',
              resolver
            },
            disableCloseOnClick: true,
            zIndex: '70'
          }
        ]);
      });
    }

    if (wasCanceled) {
      $statisticsActionInProgress$ = false;
      return;
    }

    const error = await database
      .deleteStatisticEntries([...titlesToDelete], false, startDate, endDate)
      .catch(({ message }) => message);

    if (error) {
      await new Promise((resolver) => {
        dialogManager.dialogs$.next([
          {
            component: ConfirmDialog,
            props: {
              dialogHeader: '删除数据',
              dialogMessage: `Failed to delete Data: ${error}`,
              showCancel: false,
              resolver
            },
            disableCloseOnClick: true,
            zIndex: '70'
          }
        ]);
      });
      $statisticsActionInProgress$ = false;
    } else {
      const filterMap = new Map<string, boolean>();
      const notDeletedMap = new Map<string, boolean>();

      statisticsData = statisticsData.filter((statistic) => {
        if (titlesToDelete.has(statistic.title)) {
          const returnValue = startDate
            ? !(statistic.dateKey >= startDate && statistic.dateKey <= endDate)
            : false;

          if (returnValue || !filterMap.get(statistic.title)) {
            filterMap.set(statistic.title, returnValue);
          }

          return returnValue;
        }

        if (statistic.readingTime) {
          notDeletedMap.set(statistic.title, statisticsTitleFilters.get(statistic.title) || false);
        }

        return true;
      });

      const preFilteredTitlesForStatistics = [...$preFilteredTitlesForStatistics$];

      for (let index = 0, { length } = preFilteredTitlesForStatistics; index < length; index += 1) {
        const preFilteredTitleForStatistics = preFilteredTitlesForStatistics[index];

        if (
          filterMap.has(preFilteredTitleForStatistics) &&
          !filterMap.get(preFilteredTitleForStatistics)
        ) {
          statisticsTitleFilters.delete(preFilteredTitleForStatistics);
          $preFilteredTitlesForStatistics$.delete(preFilteredTitleForStatistics);
        }
      }

      if ($preFilteredTitlesForStatistics$.size) {
        statisticsTitleFilters = statisticsTitleFilters;
        $preFilteredTitlesForStatistics$ = $preFilteredTitlesForStatistics$;
      } else {
        const filteredEntries = [...filterMap.entries()];
        const titleFilters = [...notDeletedMap.entries()];
        const newStatisticsTitleFilterData = new Map<string, boolean>();

        for (let index = 0, { length } = filteredEntries; index < length; index += 1) {
          const [title, hasData] = filteredEntries[index];

          if (hasData) {
            newStatisticsTitleFilterData.set(title, true);
          }
        }

        for (let index = 0, { length } = titleFilters; index < length; index += 1) {
          const [title, isDisplayed] = titleFilters[index];

          newStatisticsTitleFilterData.set(title, isDisplayed);
        }

        statisticsTitleFilters = newStatisticsTitleFilterData;
      }

      updateStatisticsData();
      $statisticsActionInProgress$ = false;
    }
  }

  async function handleEditRequest({
    detail: { dateKey, title, newReadingTime, newCharactersRead, resetMinMaxValues }
  }: CustomEvent<StatisticsEditRequest>) {
    $statisticsActionInProgress$ = true;

    const statisticIndex = statisticsData.findIndex(
      (statistic) => statistic.dateKey === dateKey && statistic.title === title
    );
    const statistic = statisticsData[statisticIndex];
    const newStatistic: BookStatistic = {
      ...statistic,
      readingTime: newReadingTime,
      averageReadingTime: newReadingTime,
      averageWeightedReadingTime: newReadingTime,
      charactersRead: newCharactersRead,
      averageCharactersRead: newCharactersRead,
      averageWeightedCharactersRead: newCharactersRead,
      lastReadingSpeed: newReadingTime ? Math.ceil((3600 * newCharactersRead) / newReadingTime) : 0,
      lastStatisticModified: Date.now()
    };

    newStatistic.averageReadingSpeed = newStatistic.lastReadingSpeed;
    newStatistic.averageWeightedReadingSpeed = newStatistic.lastReadingSpeed;
    newStatistic.minReadingSpeed =
      newStatistic.minReadingSpeed && !resetMinMaxValues
        ? Math.min(newStatistic.minReadingSpeed, newStatistic.lastReadingSpeed)
        : newStatistic.lastReadingSpeed;
    newStatistic.maxReadingSpeed = resetMinMaxValues
      ? newStatistic.lastReadingSpeed
      : Math.max(newStatistic.maxReadingSpeed, newStatistic.lastReadingSpeed);

    if (newCharactersRead || resetMinMaxValues) {
      newStatistic.altMinReadingSpeed =
        newStatistic.altMinReadingSpeed && !resetMinMaxValues
          ? Math.min(newStatistic.altMinReadingSpeed, newStatistic.lastReadingSpeed)
          : newStatistic.lastReadingSpeed;
    }

    const wasCanceled = await new Promise((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: ConfirmDialog,
          props: {
            dialogHeader: '更新数据',
            dialogMessage: `This will update the Data for ${title} on ${dateKey}.\n\nTime: ${secondsToMinutes(
              statistic.readingTime
            )} min => ${secondsToMinutes(newReadingTime)} min\nCharacters: ${
              statistic.charactersRead
            } => ${newCharactersRead}\nSpeed: ${statistic.lastReadingSpeed} / h => ${
              newStatistic.lastReadingSpeed
            } / h\nMin Speed: ${statistic.minReadingSpeed} / h => ${
              newStatistic.minReadingSpeed
            } / h\nAlt Min Speed: ${statistic.altMinReadingSpeed} / h => ${
              newStatistic.altMinReadingSpeed
            } / h\nMax Speed: ${statistic.maxReadingSpeed} / h => ${
              newStatistic.maxReadingSpeed
            } / h`,
            contentStyles: 'white-space: pre-line;max-height: 20rem;overflow: auto;',
            resolver
          },
          disableCloseOnClick: true,
          zIndex: '70'
        }
      ]);
    });

    if (wasCanceled) {
      $statisticsActionInProgress$ = false;
      return;
    }

    try {
      await database.updateStatistic(newStatistic);

      statisticsData[statisticIndex] = { ...statistic, ...newStatistic };
      updateStatisticsData();
    } catch ({ message }: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: '错误',
            message: `Update failed: ${message}`
          }
        }
      ]);
    } finally {
      $statisticsActionInProgress$ = false;
    }
  }

  function updateTitleFilter({
    detail: newStatisticsTitleFilters
  }: CustomEvent<StatisticsTitleFilterItem[]>) {
    const newStatisticsTitleFilterData = new Map<string, boolean>();

    for (let index = 0, { length } = newStatisticsTitleFilters; index < length; index += 1) {
      const newStatisticsTitleFilter = newStatisticsTitleFilters[index];

      newStatisticsTitleFilterData.set(
        newStatisticsTitleFilter.title,
        newStatisticsTitleFilter.isSelected
      );
    }

    statisticsTitleFilters = newStatisticsTitleFilterData;

    updateStatisticsData();
  }

  function clearPrefilter() {
    const newStatisticsTitleFilterData = new Map<string, boolean>();

    for (let index = 0, { length } = statisticsData; index < length; index += 1) {
      const statistic = statisticsData[index];

      if (statistic.readingTime) {
        newStatisticsTitleFilterData.set(statistic.title, true);
      }
    }

    statisticsTitleFilters = newStatisticsTitleFilterData;
    $preFilteredTitlesForStatistics$ = new Set();

    updateStatisticsData();
  }

  function toggleStatisticsRangeTemplate() {
    let nextIndex =
      statisticsRangeTemplates.findIndex(
        (statisticsRangeTemplate) => $lastStatisticsRangeTemplate$ === statisticsRangeTemplate
      ) + 1;

    if (nextIndex >= statisticsRangeTemplates.length - 1) {
      nextIndex = 0;
    }

    $lastStatisticsRangeTemplate$ = statisticsRangeTemplates[nextIndex];
  }

  function toggleStatisticsDataAggregationMode() {
    let nextIndex =
      statisticsDataAggregrationModes.findIndex(
        (mode) => $lastPrimaryReadingDataAggregationMode$ === mode
      ) + 1;

    if (nextIndex > statisticsDataAggregrationModes.length - 1) {
      nextIndex = 0;
    }

    $lastPrimaryReadingDataAggregationMode$ = statisticsDataAggregrationModes[nextIndex];
  }

  async function init() {
    try {
      const db = await database.db;
      const hasPrefilteredTitlesForStatistics = !!$preFilteredTitlesForStatistics$.size;

      statisticsData = (await db.getAllFromIndex('statistic', 'dateKey')).map(
        (statistic) => {
          if (
            statistic.readingTime &&
            (!hasPrefilteredTitlesForStatistics ||
              $preFilteredTitlesForStatistics$.has(statistic.title))
          ) {
            statisticsTitleFilters.set(statistic.title, true);
          }

          return {
            ...statistic,
            ...{
              id: `${statistic.title}_${statistic.dateKey}`,
              averageReadingTime: statistic.readingTime,
              averageWeightedReadingTime: statistic.readingTime,
              averageCharactersRead: statistic.charactersRead,
              averageWeightedCharactersRead: statistic.charactersRead,
              averageReadingSpeed: statistic.lastReadingSpeed,
              averageWeightedReadingSpeed: statistic.lastReadingSpeed
            }
          };
        }
      );
    } catch ({ message }: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: '错误',
            message: `Error getting Data: ${message}`
          }
        }
      ]);
    } finally {
      isLoading = false;
      $statisticsTitleFilterEnabled$ = true;
    }
  }

  function updateStatisticsData() {
    const newTitleFilterForStatisticsSet = new Set<string>();

    statisticsForSelection = statisticsData.filter((statistic) =>
      filterStatisticsForSelection(statistic, newTitleFilterForStatisticsSet)
    );
    titlesInStatisticsDateRange = newTitleFilterForStatisticsSet;

    aggregratedStatistics = [...getAggregatedStatistics($lastPrimaryReadingDataAggregationMode$)];
  }

  function getAggregatedStatistics(
    statisticsDataAggegrationMode: StatisticsReadingDataAggregationMode
  ) {
    let aggregatedStatisticsData: BookStatistic[] = [];

    if (statisticsDataAggegrationMode === StatisticsReadingDataAggregationMode.NONE) {
      aggregatedStatisticsData = statisticsForSelection;
    } else {
      const aggregationKey =
        statisticsDataAggegrationMode === StatisticsReadingDataAggregationMode.DATE
          ? 'dateKey'
          : 'title';
      const aggregrationMap = new Map<string, BookStatistic[]>();

      for (let index = 0, { length } = statisticsForSelection; index < length; index += 1) {
        const entry = statisticsForSelection[index];
        const keyValue = entry[aggregationKey];
        const entries = aggregrationMap.get(keyValue) || [];

        entries.push(entry);
        aggregrationMap.set(keyValue, entries);
      }

      const aggregationKeys = [...aggregrationMap.keys()];

      for (let index = 0, { length } = aggregationKeys; index < length; index += 1) {
        const key = aggregationKeys[index];
        const entries = aggregrationMap.get(key) || [];
        const statistic: BookStatistic = {
          ...getDefaultStatistic('-', '-'),
          ...{
            id: `${key}`,
            averageReadingTime: 0,
            averageWeightedReadingTime: 0,
            averageCharactersRead: 0,
            averageWeightedCharactersRead: 0,
            averageReadingSpeed: 0,
            averageWeightedReadingSpeed: 0
          }
        };

        let weightedSum = 0;
        let validReadingDays = 0;

        for (let index2 = 0, { length: length2 } = entries; index2 < length2; index2 += 1) {
          const entry = entries[index2];

          if (aggregationKey === 'title') {
            statistic.title = key;
          } else {
            statistic.dateKey = key;
          }

          statistic.readingTime += entry.readingTime;
          statistic.charactersRead += entry.charactersRead;
          statistic.minReadingSpeed = statistic.minReadingSpeed
            ? Math.min(statistic.minReadingSpeed, entry.minReadingSpeed)
            : entry.minReadingSpeed;
          statistic.altMinReadingSpeed = statistic.altMinReadingSpeed
            ? Math.min(statistic.altMinReadingSpeed, entry.altMinReadingSpeed)
            : statistic.altMinReadingSpeed;
          statistic.maxReadingSpeed = Math.max(statistic.maxReadingSpeed, entry.lastReadingSpeed);
          weightedSum += entry.readingTime * entry.charactersRead;

          if (statistic.readingTime) {
            validReadingDays += 1;
          }
        }

        statistic.lastReadingSpeed = statistic.readingTime
          ? Math.ceil((3600 * statistic.charactersRead) / statistic.readingTime)
          : 0;
        statistic.averageReadingTime = validReadingDays
          ? Math.ceil(statistic.readingTime / validReadingDays)
          : 0;
        statistic.averageWeightedReadingTime = statistic.charactersRead
          ? Math.ceil(weightedSum / statistic.charactersRead)
          : 0;
        statistic.averageCharactersRead = validReadingDays
          ? Math.ceil(statistic.charactersRead / validReadingDays)
          : 0;
        statistic.averageWeightedCharactersRead = statistic.readingTime
          ? Math.ceil(weightedSum / statistic.readingTime)
          : 0;
        statistic.averageReadingSpeed = statistic.averageReadingTime
          ? Math.ceil((3600 * statistic.averageCharactersRead) / statistic.averageReadingTime)
          : 0;
        statistic.averageWeightedReadingSpeed = statistic.averageWeightedReadingTime
          ? Math.ceil(
              (3600 * statistic.averageWeightedCharactersRead) /
                statistic.averageWeightedReadingTime
            )
          : 0;

        aggregatedStatisticsData.push(statistic);
      }
    }

    return aggregatedStatisticsData;
  }

  function filterStatisticsForSelection(
    statistic: BookStatistic,
    newTitleFilterForStatisticsSet: Set<string>
  ) {
    const isInDateRange =
      statistic.readingTime &&
      statistic.dateKey >= $lastStatisticsStartDate$ &&
      statistic.dateKey <= $lastStatisticsEndDate$;

    if (isInDateRange) {
      newTitleFilterForStatisticsSet.add(statistic.title);
    }

    return isInDateRange && statisticsTitleFilters.get(statistic.title);
  }
</script>

{$exportStatisticsDataHandler$ ?? ''}
{$deleteStatisticsDataHandler$ ?? ''}
{$setStatisticsDatesToAllTimeHandler$ ?? ''}
{$manualEntryHandler$ ?? ''}
{$exportYearReportHandler$ ?? ''}
<svelte:window on:keyup={onKeyUp} />
{#if isLoading}
  <div class="flex fixed items-center justify-center inset-0 h-full w-full text-7xl">
    <Fa icon={faSpinner} spin />
  </div>
{:else}
  {#if $lastStatisticsTab$ === StatisticsTab.MAIN}
    <StatisticsMain
      statistics={statisticsData}
      {sessions}
      startDate={$lastStatisticsStartDate$}
      endDate={$lastStatisticsEndDate$}
      startDayHours={$startDayHoursForTracker$}
      titleFilter={statisticsTitleFilters}
      {statisticsDateRangeLabel}
    />
  {/if}
  {#if $lastStatisticsTab$ === StatisticsTab.SESSIONS}
    <StatisticsSessions
      statistics={statisticsData}
      {sessions}
      startDate={$lastStatisticsStartDate$}
      endDate={$lastStatisticsEndDate$}
      startDayHours={$startDayHoursForTracker$}
      titleFilter={statisticsTitleFilters}
      {statisticsDateRangeLabel}
    />
  {/if}
  {#if $lastStatisticsTab$ === StatisticsTab.SUMMARY}
    <StatisticsSummary
      {aggregratedStatistics}
      {statisticsDateRangeLabel}
      on:delete={handleDeleteRequest}
      on:edit={handleEditRequest}
    />
  {/if}
  {#if $lastStatisticsTab$ === StatisticsTab.YEAR}
    <StatisticsYear />
  {/if}
  {#if $lastStatisticsTab$ === StatisticsTab.HIGHLIGHTS}
    <StatisticsHighlights
      startDate={$lastStatisticsStartDate$}
      endDate={$lastStatisticsEndDate$}
      {statisticsDateRangeLabel}
      titleFilter={statisticsTitleFilters}
    />
  {/if}
{/if}
{#if $statisticsTitleFilterIsOpen$}
  <div
    class="writing-horizontal-tb fixed top-0 right-0 z-[60] flex h-full w-full max-w-xl flex-col justify-between bg-menu text-menu"
    in:fly|local={{ x: 100, duration: 100, easing: quintInOut }}
    use:clickOutside={() => ($statisticsTitleFilterIsOpen$ = false)}
  >
    <StatisticsTitleFilter
      {statisticsTitleFilters}
      {titlesInStatisticsDateRange}
      on:applyFilter={updateTitleFilter}
      on:clearPrefilter={clearPrefilter}
      on:close={() => ($statisticsTitleFilterIsOpen$ = false)}
    />
  </div>
{/if}
{#if $statisticsActionInProgress$}
  <div class="tap-highlight-transparent fixed inset-0 bg-black/[.2] z-[70]" />
  <div class="flex fixed items-center justify-center inset-0 h-full w-full text-7xl">
    <Fa icon={faSpinner} spin />
  </div>
{/if}
