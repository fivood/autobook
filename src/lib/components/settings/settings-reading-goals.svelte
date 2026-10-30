<script lang="ts">
  import {
    faCancel,
    faChevronLeft,
    faChevronRight,
    faEdit,
    faSave,
    faTrash
  } from '@fortawesome/free-solid-svg-icons';
  import { ReadingGoalFrequency } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import SettingsReadingGoalsMerge from '$lib/components/settings/settings-reading-goals-merge.svelte';
  import { buttonClasses } from '$lib/css-classes';
  import type { BooksDbReadingGoal } from '$lib/data/database/books-db/versions/books-db';
  import { dialogManager } from '$lib/data/dialog-manager';
  import {
    getCurrentReadingGoal,
    getDateRangeLabel,
    type ReadingGoal,
    type ReadingGoalSaveResult
  } from '$lib/data/reading-goal';
  import {
    database,
    readingGoal$,
    startDayHoursForTracker$
  } from '$lib/data/store';
  import { t, tImmediate } from '$lib/i18n';
  import { getDateKey, secondsToMinutes } from '$lib/functions/statistic-util';
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import Fa from 'svelte-fa';

  const dispatch = createEventDispatcher<{
    spinner: boolean;
  }>();

  const readingGoalFrequencies = [
    ReadingGoalFrequency.DAILY,
    ReadingGoalFrequency.WEEKLY,
    ReadingGoalFrequency.MONTHLY
  ];

  let currentTimeGoal = 0;
  let currentCharacterGoal = 0;
  let currentReadingGoalFrequency = ReadingGoalFrequency.DAILY;
  let currentReadingGoalStartDate = '';
  let isInEditMode = false;
  let readingGoals: BooksDbReadingGoal[] = [];
  let sortedReadingGoals: BooksDbReadingGoal[] = [];
  let historyIndex = 0;
  const itemsPerPage = 1;

  $: saveDisabled = !!((currentTimeGoal || currentCharacterGoal) && !currentReadingGoalStartDate);

  $: currentTimeGoalInMin = secondsToMinutes(currentTimeGoal);

  $: currentHistoryIndex = Math.max(0, historyIndex * itemsPerPage);

  $: historyReadingGoals = sortedReadingGoals.slice(
    currentHistoryIndex,
    currentHistoryIndex + itemsPerPage
  );

  $: hasNextHistoryPage = sortedReadingGoals.length > currentHistoryIndex + itemsPerPage;

  $: if ($readingGoal$) {
    ({
      timeGoal: currentTimeGoal,
      characterGoal: currentCharacterGoal,
      goalFrequency: currentReadingGoalFrequency,
      goalStartDate: currentReadingGoalStartDate
    } = $readingGoal$);
  }

  onMount(init);

  function handleReadingGoalChange(event: Event, isTimeGoal: boolean) {
    const { value } = event.target as HTMLInputElement;

    const mod = isTimeGoal ? 60 : 1;
    const val = Math.floor((Number.parseFloat(value) || 0) * mod);

    if (isTimeGoal) {
      currentTimeGoal = val < 0 ? 0 : val;
    } else {
      currentCharacterGoal = val < 0 ? 0 : val;
    }
  }

  async function saveReadingGoal() {
    if (!currentTimeGoal && !currentCharacterGoal) {
      currentReadingGoalStartDate = '';
      currentReadingGoalFrequency = ReadingGoalFrequency.DAILY;
    }

    if (
      currentTimeGoal === $readingGoal$.timeGoal &&
      currentCharacterGoal === $readingGoal$.characterGoal &&
      currentReadingGoalFrequency === $readingGoal$.goalFrequency &&
      currentReadingGoalStartDate === $readingGoal$.goalStartDate
    ) {
      isInEditMode = false;
      return;
    }

    try {
      const todayKey = getDateKey($startDayHoursForTracker$);
      const initialExistingReadingGoals = await database.getReadingGoalsForDateWindow(
        currentReadingGoalStartDate < $readingGoal$.goalStartDate
          ? currentReadingGoalStartDate || $readingGoal$.goalStartDate
          : $readingGoal$.goalStartDate || currentReadingGoalStartDate
      );
      const existingReadingGoals = currentReadingGoalStartDate
        ? initialExistingReadingGoals.filter(
            (item) => item.goalStartDate !== $readingGoal$.goalStartDate
          )
        : [];
      const isFutureWithoutReadingGoalConflicts =
        $readingGoal$.goalStartDate &&
        todayKey < $readingGoal$.goalStartDate &&
        !existingReadingGoals.length;

      const newReadingGoal = {
        timeGoal: currentTimeGoal,
        characterGoal: currentCharacterGoal,
        goalFrequency: currentReadingGoalFrequency,
        goalStartDate: currentReadingGoalStartDate,
        lastGoalModified: Date.now()
      };
      let readingGoalsToDelete: string[] = [];
      let readingGoalsToInsert: BooksDbReadingGoal[] = [];
      let error = '';

      if (isFutureWithoutReadingGoalConflicts && currentReadingGoalStartDate) {
        readingGoalsToDelete.push($readingGoal$.goalStartDate);
        readingGoalsToInsert.push({ ...newReadingGoal, goalEndDate: '', goalOriginalEndDate: '' });
      } else if (isFutureWithoutReadingGoalConflicts) {
        readingGoalsToDelete.push($readingGoal$.goalStartDate);
      } else if (initialExistingReadingGoals.length) {
        ({ readingGoalsToDelete, readingGoalsToInsert, error } =
          await new Promise<ReadingGoalSaveResult>((resolver) => {
            dialogManager.dialogs$.next([
              {
                component: SettingsReadingGoalsMerge,
                props: { newReadingGoal, resolver },
                disableCloseOnClick: true
              }
            ]);
          }));
      } else {
        readingGoalsToInsert.push({ ...newReadingGoal, goalEndDate: '', goalOriginalEndDate: '' });
      }

      if (error) {
        throw new Error(error);
      }

      dispatch('spinner', true);

      await database.updateReadingGoals(readingGoalsToDelete, readingGoalsToInsert);
    } catch (error: any) {
      tick().then(() =>
        dialogManager.dialogs$.next([
          {
            component: MessageDialog,
            props: {
              title: tImmediate('common.error'),
              message: tImmediate('goals.updateError', { detail: error.message })
            }
          }
        ])
      );
    } finally {
      dispatch('spinner', false);
      isInEditMode = false;
      await updateReadingGoalsData().catch(() => {
        // no-op
      });
    }
  }

  async function deleteReadingGoals(readingGoalToDelete?: ReadingGoal, dateRangeLabel?: string) {
    let dialogMessage = '';

    if (readingGoalToDelete) {
      const isCurrentReadingGoal =
        $readingGoal$.goalStartDate &&
        $readingGoal$.goalStartDate === readingGoalToDelete.goalStartDate;
      const range = dateRangeLabel ?? '';
      dialogMessage = !isCurrentReadingGoal
        ? tImmediate('goals.delete.archived', { range })
        : getDateKey($startDayHoursForTracker$) >= readingGoalToDelete.goalStartDate
          ? tImmediate('goals.delete.currentStarted', { range })
          : tImmediate('goals.delete.currentUpcoming', { range });
    } else if (readingGoals.length > 1) {
      dialogMessage = tImmediate(
        $readingGoal$.goalStartDate ? 'goals.delete.allWithCurrent' : 'goals.delete.all'
      );
    } else {
      dialogMessage = tImmediate(
        $readingGoal$.goalStartDate ? 'goals.delete.onlyCurrent' : 'goals.delete.onlyArchived'
      );
    }

    dialogMessage += `\n\n${tImmediate('goals.delete.syncHint')}`;

    const wasCanceled = await new Promise((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: ConfirmDialog,
          props: {
            dialogHeader: tImmediate('goals.delete.header'),
            dialogMessage,
            contentStyles: 'white-space: pre-line;',
            resolver
          },
          disableCloseOnClick: true
        }
      ]);
    });

    if (wasCanceled) {
      return;
    }

    dispatch('spinner', true);

    try {
      await database.deleteReadingGoal(readingGoalToDelete?.goalStartDate);
      await updateReadingGoalsData();
    } catch ({ message }: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: tImmediate('common.error'),
            message: tImmediate('goals.deleteError', { detail: message })
          }
        }
      ]);
    } finally {
      dispatch('spinner', false);
    }
  }

  async function init() {
    try {
      dispatch('spinner', true);
      await updateReadingGoalsData();
    } catch (error: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: tImmediate('common.error'),
            message: tImmediate('goals.loadError', { detail: error.message })
          }
        }
      ]);
    } finally {
      dispatch('spinner', false);
    }
  }

  async function updateReadingGoalsData() {
    readingGoals = await database.getReadingGoals();

    sortedReadingGoals = [...readingGoals];
    sortedReadingGoals.sort((a, b) => (a.goalStartDate > b.goalStartDate ? -1 : 1));
    historyIndex = 0;

    $readingGoal$ = await getCurrentReadingGoal(readingGoals);
  }
</script>

<div class="mb-8 sm:col-span-2 lg:col-span-3">
  <div class="flex flex-grow">
    <h1 class="mb-2 text-xl font-medium w-full">
      <span>{$t('goals.section')}</span>
    </h1>
    {#if isInEditMode}
      <button class={`${buttonClasses} mr-4`} disabled={saveDisabled} on:click={saveReadingGoal}>
        <div
          class="flex items-center justify-center hover:opacity-50"
          class:cursor-not-allowed={saveDisabled}
        >
          <span class="mr-2">{$t('theme.save')}</span>
          <Fa icon={faSave} />
        </div>
      </button>
      <button
        class={buttonClasses}
        on:click={() => {
          ({
            timeGoal: currentTimeGoal,
            characterGoal: currentCharacterGoal,
            goalFrequency: currentReadingGoalFrequency,
            goalStartDate: currentReadingGoalStartDate
          } = $readingGoal$);

          isInEditMode = false;
        }}
      >
        <div class="flex items-center justify-center hover:opacity-50">
          <span class="mr-2">{$t('dialog.cancel')}</span>
          <Fa icon={faCancel} />
        </div>
      </button>
    {:else}
      <button class={buttonClasses} on:click={() => (isInEditMode = true)}>
        <div class="flex items-center justify-center hover:opacity-50">
          <span class="mr-2">{$t('goals.edit')}</span>
          <Fa icon={faEdit} />
        </div>
      </button>
      <button
        class={buttonClasses}
        disabled={!readingGoals.length}
        on:click={() => deleteReadingGoals()}
      >
        <div
          title={$t('goals.resetTitle')}
          class="flex items-center justify-center hover:opacity-50"
          class:cursor-not-allowed={!readingGoals.length}
        >
          <span class="mr-2">{$t('common.reset')}</span>
          <Fa icon={faTrash} />
        </div>
      </button>
    {/if}
  </div>
  <hr class="border border-black" />
  <div class="grid grid-cols-1 gap-4 justify-between items-end mt-4 md:grid-cols-4">
    <div class="flex flex-col">
      {$t('goals.timeGoal')}
      <input
        type="number"
        min="0"
        class:cursor-not-allowed={!isInEditMode}
        disabled={!isInEditMode}
        bind:value={currentTimeGoalInMin}
        on:blur={(event) => handleReadingGoalChange(event, true)}
      />
    </div>
    <div class="flex flex-col">
      {$t('goals.charGoal')}
      <input
        type="number"
        min="0"
        class:cursor-not-allowed={!isInEditMode}
        disabled={!isInEditMode}
        bind:value={currentCharacterGoal}
        on:blur={(event) => handleReadingGoalChange(event, false)}
      />
    </div>
    <div class="flex flex-col">
      {$t('goals.frequency')}
      <select
        class:cursor-not-allowed={!isInEditMode}
        disabled={!isInEditMode}
        bind:value={currentReadingGoalFrequency}
      >
        {#each readingGoalFrequencies as frequency (frequency)}
          <option value={frequency}>
            {$t('goals.freq.' + frequency)}
          </option>
        {/each}
      </select>
    </div>
    <div class="flex flex-col">
      {$t('goals.startDate')}
      <input
        type="date"
        class:cursor-not-allowed={!isInEditMode}
        disabled={!isInEditMode}
        bind:value={currentReadingGoalStartDate}
      />
    </div>
  </div>
  <details class="mt-6 cursor-pointer">
    <summary>{$t('goals.history', { n: readingGoals.length })}</summary>
    {#if readingGoals.length}
      <div class="grid-cols-[repeat(4,1fr)_0.1fr] hidden sm:grid">
        {#each historyReadingGoals as historyGoal (historyGoal.goalStartDate)}
          {@const dateRangeLabel = getDateRangeLabel(
            historyGoal.goalStartDate,
            historyGoal.goalEndDate
          )}
          <div>{dateRangeLabel}</div>
          <div>{$t('goals.minutes', { n: secondsToMinutes(historyGoal.timeGoal) })}</div>
          <div>{$t('goals.chars', { n: historyGoal.characterGoal })}</div>
          <div>{$t('goals.freq.' + historyGoal.goalFrequency)}</div>
          <button
            on:click={() => deleteReadingGoals(historyGoal, dateRangeLabel)}
            title={$t('goals.deleteOne')}
          >
            <Fa icon={faTrash} />
          </button>
        {/each}
      </div>
      <div class="sm:hidden">
        {#each historyReadingGoals as historyGoal (historyGoal.goalStartDate)}
          {@const dateRangeLabel = getDateRangeLabel(
            historyGoal.goalStartDate,
            historyGoal.goalEndDate
          )}
          <div class="my-2">
            {dateRangeLabel} / {$t('goals.minutes', { n: secondsToMinutes(historyGoal.timeGoal) })} /
            {$t('goals.chars', { n: historyGoal.characterGoal })} / {$t('goals.freq.' + historyGoal.goalFrequency)}
            <button
              on:click={() => deleteReadingGoals(historyGoal, dateRangeLabel)}
              title={$t('goals.deleteOne')}
            >
              <Fa icon={faTrash} />
            </button>
          </div>
        {/each}
      </div>
      <div class="mt-3 flex justify-between">
        <button
          title={currentHistoryIndex === 0 ? '' : $t('goals.prevPage')}
          disabled={currentHistoryIndex === 0}
          class:opacity-50={currentHistoryIndex === 0}
          class:cursor-not-allowed={currentHistoryIndex === 0}
          on:click={() => (historyIndex -= 1)}
        >
          <Fa icon={faChevronLeft} />
        </button>
        <button
          title={hasNextHistoryPage ? $t('goals.nextPage') : ''}
          disabled={!hasNextHistoryPage}
          class:opacity-50={!hasNextHistoryPage}
          class:cursor-not-allowed={!hasNextHistoryPage}
          on:click={() => (historyIndex += 1)}
        >
          <Fa icon={faChevronRight} />
        </button>
      </div>
    {:else}
      <div class="text-muted">{$t('goals.historyEmpty')}</div>
    {/if}
  </details>
</div>
