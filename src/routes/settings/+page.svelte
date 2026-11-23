<script lang="ts">
  import { t } from '$lib/i18n';
  import { onMount } from 'svelte';
  import { tap } from 'rxjs';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import SettingsContent from '$lib/components/settings/settings-content.svelte';
  import SettingsHeader, { SETTINGS_TABS } from '$lib/components/settings/settings-header.svelte';
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
  import { storage } from '$lib/data/window/navigator/storage';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { writableSubject } from '$lib/functions/svelte/store';
  import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';

  const persistentStorage$ = writableSubject(false);
  let persistentStorageReactive = false;

  onMount(() => {
    storage.persisted().then(setPersistentStorage);

    setStorageQuota();
    mounted = true;
  });

  // The tab lives in the URL so that coming back here (from 更新记录, or
  // history back) lands on the tab you left, and so the reader's settings
  // drawer can link straight to the matching tab.
  const requestedTab = $page.url.searchParams.get('tab');
  let activeSettings =
    requestedTab && SETTINGS_TABS.some((tab) => tab.label === requestedTab) ? requestedTab : 'Reader';
  let mounted = false;
  $: if (mounted) syncTabToUrl(activeSettings);

  function syncTabToUrl(tab: string) {
    const url = new URL($page.url);
    if (url.searchParams.get('tab') === tab) return;
    url.searchParams.set('tab', tab);
    url.hash = '';
    // A real (replacing) navigation, not $app/navigation's shallow
    // replaceState: on history back SvelteKit restores a shallow entry's
    // original URL, which put you on the tab you entered with.
    goto(url, { replaceState: true, noScroll: true, keepFocus: true });
  }

  let storageQuota = '';

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

<SettingsHeader bind:activeSettings />

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
