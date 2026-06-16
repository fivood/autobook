<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import { buttonClasses } from '$lib/css-classes';
  import { isTauri } from '$lib/data/env';
  import { logger } from '$lib/data/logger';
  import {
    theme$,
    viewMode$,
    fontFamilyGroupOne$,
    fontFamilyGroupTwo$,
    fontWeight$,
    fontSize$,
    lineHeight$,
    textIndentation$,
    textMarginMode$,
    textMarginValue$,
    firstDimensionMargin$,
    secondDimensionMaxValue$,
    swipeThreshold$,
    disableWheelNavigation$,
    writingMode$,
    enableVerticalFontKerning$,
    enableFontVPAL$,
    verticalTextOrientation$,
    prioritizeReaderStyles$,
    enableTextJustification$,
    enableTextWrapPretty$,
    confirmClose$,
    autoBookmark$,
    autoBookmarkTime$,
    hideSpoilerImage$,
    hideFurigana$,
    furiganaStyle$,
    avoidPageBreak$,
    pauseTrackerOnCustomPointChange$,
    customReadingPointEnabled$,
    selectionToBookmarkEnabled$,
    enableTapEdgeToFlip$,
    pageColumns$,
    autoPositionOnResize$,
    requestPersistentStorage$,
    hideExternalReadHint$,
    importHTMLFixMode$,
    restrictImportFixToAnchor$,
    cacheStorageData$,
    autoReplication$,
    replicationSaveBehavior$,
    showExternalPlaceholder$,
    syncTarget$,
    keepLocalStatisticsOnDeletion$,
    overwriteBookCompletion$,
    startDayHoursForTracker$,
    statisticsMergeMode$,
    readingGoalsMergeMode$,
    statisticsEnabled$,
    trackerAutoPause$,
    openTrackerOnCompletion$,
    addCharactersOnCompletion$,
    trackerAutostartTime$,
    trackerIdleTime$,
    trackerForwardSkipThreshold$,
    trackerBackwardSkipThreshold$,
    trackerSkipThresholdAction$,
    trackerPopupDetection$,
    adjustStatisticsAfterIdleTime$,
    readingGoal$,
    lastSyncedSettingsSource$,
    lastSyncedSettingsTarget$,
    lastReadingGoalsModified$,
    isOnline$,
    multiplier$,
    showCharacterCounter$,
    showPercentage$,
    showFooterChapterCharacterCounter$,
    showFooterChapterPercentage$,
    enableReaderWakeLock$
  } from '$lib/data/store';

  export let title = '错误';

  export let message: string;

  const reportPayload = JSON.stringify(
      {
        userAgent: navigator.userAgent,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timezoneOffset: new Date().getTimezoneOffset(),
        languages: navigator.languages,
        viewport: {
          visualViewport: !!window.visualViewport,
          width: window.visualViewport?.width ?? window.innerWidth,
          height: window.visualViewport?.height ?? window.innerHeight
        },
        settings: {
          theme: theme$.getValue(),
          viewMode: viewMode$.getValue(),
          fontFamilyGroupOne: fontFamilyGroupOne$.getValue(),
          fontFamilyGroupTwo: fontFamilyGroupTwo$.getValue(),
          fontWeight: fontWeight$.getValue(),
          fontSize: fontSize$.getValue(),
          lineHeight: lineHeight$.getValue(),
          textIndentation: textIndentation$.getValue(),
          textMarginMode: textMarginMode$.getValue(),
          textMarginValue: textMarginValue$.getValue(),
          firstDimensionMargin: firstDimensionMargin$.getValue(),
          secondDimensionMaxValue: secondDimensionMaxValue$.getValue(),
          swipeThreshold: swipeThreshold$.getValue(),
          disableWheelNavigation: disableWheelNavigation$.getValue(),
          writingMode: writingMode$.getValue(),
          enableVerticalFontKerning: enableVerticalFontKerning$.getValue(),
          enableFontVPAL: enableFontVPAL$.getValue(),
          verticalTextOrientation: verticalTextOrientation$.getValue(),
          prioritizeReaderStyles: prioritizeReaderStyles$.getValue(),
          enableTextJustification: enableTextJustification$.getValue(),
          enableTextWrapPretty: enableTextWrapPretty$.getValue(),
          enableReaderWakeLock: enableReaderWakeLock$.getValue(),
          showCharacterCounter$: showCharacterCounter$.getValue(),
          showPercentage$: showPercentage$.getValue(),
          showFooterChapterCharacterCounter: showFooterChapterCharacterCounter$.getValue(),
          showFooterChapterPercentage: showFooterChapterPercentage$.getValue(),
          confirmClose: confirmClose$.getValue(),
          autoBookmark: autoBookmark$.getValue(),
          autoBookmarkTime: autoBookmarkTime$.getValue(),
          hideSpoilerImage: hideSpoilerImage$.getValue(),
          hideFurigana: hideFurigana$.getValue(),
          furiganaStyle: furiganaStyle$.getValue(),
          avoidPageBreak: avoidPageBreak$.getValue(),
          pauseTrackerOnCustomPointChange: pauseTrackerOnCustomPointChange$.getValue(),
          customReadingPointEnabled: customReadingPointEnabled$.getValue(),
          selectionToBookmarkEnabled: selectionToBookmarkEnabled$.getValue(),
          enableTapEdgeToFlip: enableTapEdgeToFlip$.getValue(),
          pageColumns: pageColumns$.getValue(),
          autoPositionOnResize: autoPositionOnResize$.getValue(),
          requestPersistentStorage: requestPersistentStorage$.getValue(),
          hideExternalReadHint: hideExternalReadHint$.getValue(),
          importHTMLFixMode: importHTMLFixMode$.getValue(),
          restrictImportFixToAnchor: restrictImportFixToAnchor$.getValue(),
          cacheStorageData: cacheStorageData$.getValue(),
          autoReplication: autoReplication$.getValue(),
          replicationSaveBehavior: replicationSaveBehavior$.getValue(),
          showExternalPlaceholder: showExternalPlaceholder$.getValue(),
          syncTarget: !!syncTarget$.getValue(),
          keepLocalStatisticsOnDeletion: keepLocalStatisticsOnDeletion$.getValue(),
          overwriteBookCompletion: overwriteBookCompletion$.getValue(),
          startDayHoursForTracker: startDayHoursForTracker$.getValue(),
          statisticsMergeMode: statisticsMergeMode$.getValue(),
          readingGoalsMergeMode: readingGoalsMergeMode$.getValue(),
          statisticsEnabled: statisticsEnabled$.getValue(),
          trackerAutoPause: trackerAutoPause$.getValue(),
          openTrackerOnCompletion: openTrackerOnCompletion$.getValue(),
          addCharactersOnCompletion: addCharactersOnCompletion$.getValue(),
          trackerAutostartTime: trackerAutostartTime$.getValue(),
          trackerIdleTime: trackerIdleTime$.getValue(),
          trackerForwardSkipThreshold: trackerForwardSkipThreshold$.getValue(),
          trackerBackwardSkipThreshold: trackerBackwardSkipThreshold$.getValue(),
          trackerSkipThresholdAction: trackerSkipThresholdAction$.getValue(),
          trackerPopupDetection: trackerPopupDetection$.getValue(),
          adjustStatisticsAfterIdleTime: adjustStatisticsAfterIdleTime$.getValue(),
          readingGoal: readingGoal$.getValue(),
          lastSyncedSettingsSource: lastSyncedSettingsSource$.getValue(),
          lastSyncedSettingsTarget: lastSyncedSettingsTarget$.getValue(),
          lastReadingGoalsModified: lastReadingGoalsModified$.getValue(),
          isOnline: isOnline$.getValue(),
          multiplier: multiplier$.getValue()
        },
        log: logger.history
      },
      null,
      2
    );

  let downloadStatus = '';

  async function openRepo() {
    const url = 'https://github.com/fivood/autobook';
    try {
      if (isTauri()) {
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(url);
        return;
      }
    } catch {
      /* fall through to in-page navigation */
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function downloadReport() {
    downloadStatus = '';
    const filename = `autobook-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    try {
      if (isTauri()) {
        // Write straight to the user's Documents/EbookReader/ folder, which
        // the fs scope already permits — no save-dialog plugin needed.
        const { writeTextFile, BaseDirectory, mkdir, exists } = await import(
          '@tauri-apps/plugin-fs'
        );
        if (!(await exists('AutoBook/Logs', { baseDir: BaseDirectory.Document }))) {
          await mkdir('AutoBook/Logs', {
            baseDir: BaseDirectory.Document,
            recursive: true
          });
        }
        const path = `AutoBook/Logs/${filename}`;
        await writeTextFile(path, reportPayload, { baseDir: BaseDirectory.Document });
        downloadStatus = `已保存到 文档/${path}`;
        return;
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn('[log-report] tauri save failed, falling back:', err);
    }
    // Browser fallback: blob download trick (data: URIs are rejected by WebView2).
    const blob = new Blob([reportPayload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    downloadStatus = '已下载';
  }
</script>

<DialogTemplate>
  <svelte:fragment slot="header">{title}</svelte:fragment>
  <svelte:fragment slot="content">
    <p>{message}</p>
    {#if downloadStatus}
      <p class="text-xs opacity-70 mt-2">{downloadStatus}</p>
    {/if}
  </svelte:fragment>
  <svelte:fragment slot="footer">
    <button class={buttonClasses} on:click={openRepo}>
      打开仓库
      <Ripple />
    </button>
    <button class={buttonClasses} on:click={downloadReport}>
      下载报告
      <Ripple />
    </button>
  </svelte:fragment>
</DialogTemplate>
