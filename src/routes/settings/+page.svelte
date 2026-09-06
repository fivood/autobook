<script lang="ts">
  import { t } from '$lib/i18n';
  import { onMount } from 'svelte';
  import { tap } from 'rxjs';
  import { afterNavigate } from '$app/navigation';
  import SettingsContent from '$lib/components/settings/settings-content.svelte';
  import SettingsHeader from '$lib/components/settings/settings-header.svelte';
  import { pxScreen } from '$lib/css-classes';
  import {
    addCharactersOnCompletion$,
    adjustStatisticsAfterIdleTime$,
    autoReplication$,
    cacheStorageData$,
    hideExternalReadHint$,
    importHTMLFixMode$,
    openTrackerOnCompletion$,
    overwriteBookCompletion$,
    replicationSaveBehavior$,
    restrictImportFixToAnchor$,
    showExternalPlaceholder$,
    startDayHoursForTracker$,
    statisticsEnabled$,
    statisticsMergeMode$,
    theme$,
    trackerAutoPause$,
    trackerBackwardSkipThreshold$,
    trackerForwardSkipThreshold$,
    trackerAutostartTime$,
    trackerIdleTime$,
    trackerPopupDetection$,
    trackerSkipThresholdAction$,
    readingGoalsMergeMode$,
  } from '$lib/data/store';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import { pagePath } from '$lib/data/env';
  import { storage } from '$lib/data/window/navigator/storage';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { writableSubject } from '$lib/functions/svelte/store';
  import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';

  const persistentStorage$ = writableSubject(false);
  let persistentStorageReactive = false;

  onMount(() => {
    storage.persisted().then(setPersistentStorage);

    setStorageQuota();
  });

  let prevPage = `${pagePath}${mergeEntries.MANAGE.routeId}`;

  let activeSettings = 'Reader';

  let storageQuota = '';

  afterNavigate((navigation) => {
    const { from } = navigation;
    if (!from?.url) return;
    prevPage = `${from.url.pathname}${from.url.search}`;
  });

  const setPersistentStorage$ = persistentStorage$.pipe(
    tap((value) => {
      if (!persistentStorageReactive) return;
      if (!value) {
        setPersistentStorage(true);
        return;
      }

      storage.persist().then(setPersistentStorage).finally(setStorageQuota);
    }),
    reduceToEmptyString()
  );

  function setPersistentStorage(value: boolean) {
    persistentStorageReactive = false;
    persistentStorage$.next(value);
    persistentStorageReactive = true;
  }

  function setStorageQuota() {
    storage
      .estimate()
      .then((storageData) => {
        const { usage, quota } = storageData;

        if (usage === undefined || quota === undefined) {
          return;
        }

        storageQuota = `${Math.round(((usage / quota) * 100 + Number.EPSILON) * 100) / 100} % used`;
      })
      .catch(() => {
        // no-op
      });
  }
</script>

<svelte:head>
  <title>{formatPageTitle($t('pageTitle.settings'))}</title>
</svelte:head>

<SettingsHeader leavePageLink={prevPage} bind:activeSettings />

<div class="settings-scope {pxScreen} h-full pt-16 xl:pt-14">
  <div class="max-w-5xl">
    <SettingsContent
      {activeSettings}
      {storageQuota}
      bind:selectedTheme={$theme$}
      bind:persistentStorage={$persistentStorage$}
      bind:hideExternalReadHint={$hideExternalReadHint$}
      bind:importHTMLFixMode={$importHTMLFixMode$}
      bind:restrictImportFixToAnchor={$restrictImportFixToAnchor$}
      bind:cacheStorageData={$cacheStorageData$}
      bind:replicationSaveBehavior={$replicationSaveBehavior$}
      bind:autoReplication={$autoReplication$}
      bind:showExternalPlaceholder={$showExternalPlaceholder$}
      bind:overwriteBookCompletion={$overwriteBookCompletion$}
      bind:startDayHoursForTracker={$startDayHoursForTracker$}
      bind:statisticsMergeMode={$statisticsMergeMode$}
      bind:readingGoalsMergeMode={$readingGoalsMergeMode$}
      bind:statisticsEnabled={$statisticsEnabled$}
      bind:trackerAutoPause={$trackerAutoPause$}
      bind:openTrackerOnCompletion={$openTrackerOnCompletion$}
      bind:addCharactersOnCompletion={$addCharactersOnCompletion$}
      bind:trackerAutoStartTime={$trackerAutostartTime$}
      bind:trackerIdleTime={$trackerIdleTime$}
      bind:trackerForwardSkipThreshold={$trackerForwardSkipThreshold$}
      bind:trackerBackwardSkipThreshold={$trackerBackwardSkipThreshold$}
      bind:trackerSkipThresholdAction={$trackerSkipThresholdAction$}
      bind:trackerPopupDetection={$trackerPopupDetection$}
      bind:adjustStatisticsAfterIdleTime={$adjustStatisticsAfterIdleTime$}
    />
  </div>
</div>
{$setPersistentStorage$ ?? ''}
