<script lang="ts">
  import { browser } from '$app/environment';
  import {
    faFileArrowDown,
    faFileArrowUp,
    faPlus,
    faSpinner
  } from '@fortawesome/free-solid-svg-icons';
  import {
    TrackerAutoPause,
    TrackerSkipThresholdAction
  } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import {
    optionsForToggle,
    type ToggleOption
  } from '$lib/components/button-toggle-group/toggle-option';
  import LogReportDialog from '$lib/components/log-report-dialog.svelte';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import SettingsThemeEditor from '$lib/components/settings/settings-theme-editor.svelte';
  import {
    DEFAULT_CUSTOM_COLORS,
    HIGHLIGHT_SLOTS,
    type HighlightPaletteMode
  } from '$lib/data/highlight-color';
  import Ripple from '$lib/components/ripple.svelte';
  import SettingsCustomTheme from '$lib/components/settings/settings-custom-theme.svelte';
  import SettingsDimensionPopover from '$lib/components/settings/settings-dimension-popover.svelte';
  import SettingsReadingGoals from '$lib/components/settings/settings-reading-goals.svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSync from '$lib/components/settings/settings-sync.svelte';
  import SettingsTypography from '$lib/components/settings/settings-typography.svelte';
  import SettingsTts from '$lib/components/settings/settings-tts.svelte';
  import SettingsAi from '$lib/components/settings/settings-ai.svelte';
  import SettingsOcr from '$lib/components/settings/settings-ocr.svelte';
  import SettingsModels from '$lib/components/settings/settings-models.svelte';
  import SettingsDataPaths from '$lib/components/settings/settings-data-paths.svelte';
  import SettingsSectionHeader from '$lib/components/settings/settings-section-header.svelte';
  import { inputClasses } from '$lib/css-classes';
  import { BlurMode } from '$lib/data/blur-mode';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { confirmResetUiSettings } from '$lib/functions/reset-ui-settings';
  import { ImportHTMLFixMode } from '$lib/data/import-html-fix-mode';
  import { MergeMode } from '$lib/data/merge-mode';
  import {
    customThemes$,
    highlightCustomColors$,
    highlightPalette$,
    highlightSlotStyles$,
    database,
    lastBookHasImages$,
    horizontalCustomReadingPosition$,
    textMarginMode$,
    textMarginValue$,
    theme$,
    writingMode$,
    verticalCustomReadingPosition$
  } from '$lib/data/store';
  import { isTauri } from '$lib/data/env';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import {
    availableThemes as availableThemesMap,
    type ThemeOption
  } from '$lib/data/theme-option';
  import { ViewMode } from '$lib/data/view-mode';
  import { t, tImmediate, locale$, LOCALES } from '$lib/i18n';
  import { secondsToMinutes } from '$lib/functions/statistic-util';
  import { activateOnKeyup } from '$lib/functions/utils';
  import {
    ReplicationSaveBehavior,
    AutoReplicationType
  } from '$lib/functions/replication/replication-options';
  import Fa from 'svelte-fa';
  import { onDestroy } from 'svelte';

  export let selectedTheme: string;

  export let viewMode: ViewMode;








  export let blurImage: boolean;

  export let blurImageMode: string;







  export let prioritizeReaderStyles: boolean;




  export let enableReaderWakeLock: boolean;

  export let showCharacterCounter: boolean;

  export let showPercentage: boolean;

  export let showFooterChapterCharacterCounter: boolean;

  export let showFooterChapterPercentage: boolean;

  export let secondDimensionMaxValue: number;

  export let firstDimensionMargin: number;

  export let swipeThreshold: number;

  export let disableWheelNavigation: boolean;

  export let autoPositionOnResize: boolean;

  export let avoidPageBreak: boolean;

  export let pauseTrackerOnCustomPointChange: boolean;

  export let customReadingPointEnabled: boolean;

  export let selectionToBookmarkEnabled: boolean;

  export let enableTapEdgeToFlip: boolean;

  export let pageColumns: number;

  export let storageQuota: string;

  export let persistentStorage: boolean;

  export let hideExternalReadHint: boolean;

  export let confirmClose: boolean;

  export let manualBookmark: boolean;

  export let autoBookmark: boolean;

  export let autoBookmarkTime: number;

  export let activeSettings: string;

  export let importHTMLFixMode: string;

  export let restrictImportFixToAnchor: boolean;

  export let cacheStorageData: boolean;

  export let autoReplication: string;

  export let replicationSaveBehavior: string;

  export let showExternalPlaceholder: boolean;

  export let keepLocalStatisticsOnDeletion: boolean;

  export let overwriteBookCompletion: boolean;

  export let startDayHoursForTracker: number;

  export let statisticsMergeMode: string;

  export let readingGoalsMergeMode: string;

  export let statisticsEnabled: boolean;

  export let trackerAutoPause: string;

  export let openTrackerOnCompletion: boolean;

  export let addCharactersOnCompletion: boolean;

  export let trackerAutoStartTime: number;

  export let trackerIdleTime: number;

  export let trackerForwardSkipThreshold: number;

  export let trackerBackwardSkipThreshold: number;

  export let trackerSkipThresholdAction: string;

  export let trackerPopupDetection: boolean;

  export let adjustStatisticsAfterIdleTime: boolean;

  $: availableThemes = (() => {
    // Custom themes shadow built-ins of the same id.
    const map = new Map(availableThemesMap);
    if (browser) {
      for (const [name, theme] of Object.entries($customThemes$)) {
        map.set(name, theme);
      }
    }
    return Array.from(map.entries()).map(([theme, option]) => ({ theme, option }));
  })();

  $: optionsForTheme = availableThemes.map(({ theme, option }) => ({
    id: theme,
    text: '中字',
    style: {
      color: option.fontColor,
      'background-color': option.backgroundColor
    },
    thickBorders: true,
    showIcons: true
  }));

  // Each language is labelled in its own script (中文 / English / 日本語) so it
  // stays findable when the UI is currently in a language you can't read —
  // which is exactly the state someone opening this setting is trying to fix.
  $: optionsForLocale = LOCALES.map((loc) => ({ id: loc, text: tImmediate('locale.' + loc) }));

  $: optionsForHighlightPalette = (['color', 'invert', 'custom'] as HighlightPaletteMode[]).map(
    (id) => ({ id, text: $t(`settings.highlightPalette.${id}`) })
  );

  // Stored as one comma-separated string so it needs no new storage subject
  // type; the split is padded because a hand-edited value can be short.
  $: customSlotColors = HIGHLIGHT_SLOTS.map(
    (_, i) => $highlightCustomColors$.split(',')[i]?.trim() || DEFAULT_CUSTOM_COLORS[i]
  );

  function setCustomSlotColor(index: number, value: string) {
    const next = [...customSlotColors];
    next[index] = value;
    $highlightCustomColors$ = next.join(',');
  }

  /** The applied theme's own page colours, for the preview strip's backdrop. */
  let previewTheme: Partial<ThemeOption> = {};
  $: previewTheme = $customThemes$[selectedTheme] || availableThemesMap.get(selectedTheme) || {};

  onDestroy(() => dialogManager.dialogs$.next([]));

  function resetUiSettings() {
    confirmResetUiSettings();
  }

  let themeImportInput: HTMLInputElement | undefined;
  let inlineEditTheme: string | null = null;

  function handleNewTheme() {
    dialogManager.dialogs$.next([
      {
        component: SettingsCustomTheme,
        props: { existingThemes: optionsForTheme, selectedTheme: selectedTheme }
      }
    ]);
  }

  function exportCustomThemes() {
    const json = JSON.stringify($customThemes$, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'autobook-themes.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importCustomThemes(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('不是有效的主题文件');
      }

      const entries = Object.entries(parsed).filter(
        ([, value]) => value && typeof value === 'object' && !Array.isArray(value)
      );

      if (!entries.length) {
        throw new Error('文件中没有可导入的主题');
      }

      $customThemes$ = {
        ...$customThemes$,
        ...(Object.fromEntries(entries) as Record<string, ThemeOption>)
      };
    } catch (error: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: { title: '导入主题失败', message: error.message }
        }
      ]);
    }
  }

  $: optionsForViewMode = [
    { id: ViewMode.Continuous, text: $t('settings.value.viewMode.continuous') },
    { id: ViewMode.Paginated, text: $t('settings.value.viewMode.paginated') }
  ] as ToggleOption<ViewMode>[];

  $: optionsForBlurMode = [
    { id: BlurMode.ALL, text: $t('settings.value.blur.all') },
    { id: BlurMode.AFTER_TOC, text: $t('settings.value.blur.cover') },
    { id: BlurMode.NONE, text: $t('settings.value.blur.none') }
  ] as ToggleOption<BlurMode>[];

  // 书库存储源 toggle。Tauri 桌面上才显示：TAURI_FS 是默认真书库，
  // BROWSER 只留给从更早浏览器 IDB 升级过来的用户翻旧数据。
  $: storageSourceOptions = [
    { id: StorageKey.TAURI_FS, text: $t('settings.value.storageSource.fs') },
    { id: StorageKey.BROWSER, text: $t('settings.value.storageSource.browser') }
  ] as ToggleOption<StorageKey>[];
  let selectedStorageSource: StorageKey = $storageSource$;
  $: if (selectedStorageSource !== $storageSource$) {
    storageSource$.next(selectedStorageSource);
  }

  $: optionsForImportHTMLFixes = [
    { id: ImportHTMLFixMode.OFF, text: $t('settings.value.epubFix.off') },
    { id: ImportHTMLFixMode.STANDARD, text: $t('settings.value.epubFix.standard') },
    { id: ImportHTMLFixMode.EXTENDED, text: $t('settings.value.epubFix.extended') }
  ] as ToggleOption<ImportHTMLFixMode>[];

  $: optionsForAutoReplicationType = [
    { id: AutoReplicationType.Off, text: 'Off' },
    { id: AutoReplicationType.Up, text: $t('settings.value.autoRepl.up') },
    { id: AutoReplicationType.Down, text: $t('settings.value.autoRepl.down') },
    { id: AutoReplicationType.All, text: $t('settings.value.autoRepl.all') }
  ] as ToggleOption<AutoReplicationType>[];

  $: optionsForReplicationSaveBehavior = [
    { id: ReplicationSaveBehavior.NewOnly, text: $t('settings.value.mergeOnly') },
    { id: ReplicationSaveBehavior.Overwrite, text: $t('settings.value.overwrite') }
  ] as ToggleOption<ReplicationSaveBehavior>[];

  $: optionsForTrackerAutoPause = [
    { id: TrackerAutoPause.OFF, text: 'Off' },
    { id: TrackerAutoPause.MODERATE, text: $t('settings.value.autoPause.moderate') },
    { id: TrackerAutoPause.STRICT, text: $t('settings.value.autoPause.strict') }
  ] as ToggleOption<TrackerAutoPause>[];

  $: optionsForTrackerSkipThresholdAction = [
    { id: TrackerSkipThresholdAction.IGNORE, text: $t('settings.value.skipAction.ignore') },
    { id: TrackerSkipThresholdAction.PAUSE, text: $t('settings.value.skipAction.pause') }
  ] as ToggleOption<TrackerSkipThresholdAction>[];

  $: optionsForMergeMode = [
    { id: MergeMode.MERGE, text: $t('settings.value.merge') },
    { id: MergeMode.REPLACE, text: $t('settings.value.overwrite') }
  ] as ToggleOption<MergeMode>[];

  let showSpinner = false;
  let importHTMLFixModeTooltip = '';
  let autoReplicationTypeTooltip = '';
  let trackerAutoPauseTooltip = '';

  $: if ($textMarginMode$ === 'auto') {
    $textMarginValue$ = 0;
  }

  $: autoBookmarkTooltip = $t('settings.tip.autoBookmark', { n: autoBookmarkTime });
  $: wakeLockSupported = browser && 'wakeLock' in navigator;
  $: verticalMode = $writingMode$ === 'vertical-rl';
  $: avoidPageBreakTooltip = avoidPageBreak
    ? $t('settings.tip.avoidBreak.on')
    : $t('settings.tip.avoidBreak.off');
  $: persistentStorageTooltip = persistentStorage
    ? $t('settings.tip.persistent.on')
    : $t('settings.tip.persistent.off');
  $: switch (importHTMLFixMode) {
    case ImportHTMLFixMode.OFF:
      importHTMLFixModeTooltip = $t('settings.tip.epubFix.off');
      break;
    case ImportHTMLFixMode.EXTENDED:
      importHTMLFixModeTooltip = $t('settings.tip.epubFix.extended');
      break;
    default:
      importHTMLFixModeTooltip = $t('settings.tip.epubFix.standard');
      break;
  }
  $: cacheStorageDataTooltip = cacheStorageData
    ? $t('settings.tip.cacheData.on')
    : $t('settings.tip.cacheData.off');
  $: replicationSaveBehaviorTooltip =
    replicationSaveBehavior === ReplicationSaveBehavior.Overwrite
      ? $t('settings.tip.replBehavior.overwrite')
      : $t('settings.tip.replBehavior.newOnly');
  $: switch (autoReplication) {
    case AutoReplicationType.Up:
      autoReplicationTypeTooltip = $t('settings.tip.autoRepl.up');
      break;
    case AutoReplicationType.Down:
      autoReplicationTypeTooltip = $t('settings.tip.autoRepl.down');
      break;
    case AutoReplicationType.All:
      autoReplicationTypeTooltip = $t('settings.tip.autoRepl.all');
      break;
    default:
      autoReplicationTypeTooltip = $t('settings.tip.autoRepl.off');
      break;
  }
  $: showExternalPlaceholderToolTip = showExternalPlaceholder
    ? $t('settings.tip.showPlaceholder.on')
    : $t('settings.tip.showPlaceholder.off');

  $: startOfDayHours = `${`${startDayHoursForTracker}`.padStart(2, '0')}:00`;

  $: trackerIdleTimeInMin = secondsToMinutes(trackerIdleTime);

  $: switch (trackerAutoPause) {
    case TrackerAutoPause.OFF:
      trackerAutoPauseTooltip = $t('settings.tip.autoPause.off');
      break;
    case TrackerAutoPause.STRICT:
      trackerAutoPauseTooltip = $t('settings.tip.autoPause.strict');
      break;
    default:
      trackerAutoPauseTooltip = $t('settings.tip.autoPause.moderate');
      break;
  }

</script>

<div class="grid grid-cols-1 items-center sm:grid-cols-2 sm:gap-6 lg:md:gap-8 lg:grid-cols-3">
  {#if activeSettings === 'Appearance'}
    <div class="lg:col-span-3">
      <SettingsItemGroup title={$t('locale.label')}>
        <ButtonToggleGroup options={optionsForLocale} bind:selectedOptionId={$locale$} />
      </SettingsItemGroup>
    </div>
    <div class="lg:col-span-3">
      <SettingsItemGroup title={$t('settings.section.theme')}>
        <ButtonToggleGroup
          options={optionsForTheme}
          dimUnselected={false}
          bind:selectedOptionId={selectedTheme}
          on:edit={({ detail }) => (inlineEditTheme = detail)}
          on:delete={({ detail }) => {
            $theme$ = optionsForTheme[optionsForTheme.length - 2]?.id || 'light-theme';
            delete $customThemes$[detail];
            $customThemes$ = { ...$customThemes$ };
            if (inlineEditTheme === detail) inlineEditTheme = null;
          }}
        >
          {#if browser}
            <div class="flex">
              <button
                title="新建主题"
                class="m-1 rounded-md border-2 border-current/40 p-2 text-lg"
                on:click={handleNewTheme}
              >
                <Fa icon={faPlus} class="mx-2" />
                <Ripple />
              </button>
              <button
                title="导出自定义主题"
                class="m-1 rounded-md border-2 border-current/40 p-2 text-lg"
                disabled={!Object.keys($customThemes$).length}
                class:opacity-40={!Object.keys($customThemes$).length}
                on:click={exportCustomThemes}
              >
                <Fa icon={faFileArrowUp} class="mx-2" />
                <Ripple />
              </button>
              <button
                title="导入自定义主题"
                class="m-1 rounded-md border-2 border-current/40 p-2 text-lg"
                on:click={() => themeImportInput?.click()}
              >
                <Fa icon={faFileArrowDown} class="mx-2" />
                <Ripple />
              </button>
              <input
                type="file"
                accept="application/json,.json"
                class="hidden"
                bind:this={themeImportInput}
                on:change={importCustomThemes}
              />
            </div>
          {/if}
        </ButtonToggleGroup>
        {#if inlineEditTheme}
          {#key inlineEditTheme}
            <SettingsThemeEditor
              themeId={inlineEditTheme}
              on:close={() => (inlineEditTheme = null)}
              on:saved={() => (inlineEditTheme = null)}
              on:deleted={() => (inlineEditTheme = null)}
            />
          {/key}
        {:else}
          <p class="mt-2 text-xs opacity-60">{$t('settings.theme.editHint')}</p>
        {/if}
      </SettingsItemGroup>
    </div>

    <div class="lg:col-span-3">
      <SettingsItemGroup
        title={$t('settings.item.highlightPalette')}
        tooltip={$t('settings.tip.highlightPalette')}
      >
        <ButtonToggleGroup
          options={optionsForHighlightPalette}
          bind:selectedOptionId={$highlightPalette$}
        />
        <div
          class="mt-3 flex flex-wrap items-center gap-3 rounded-md p-3"
          style="background:{previewTheme.backgroundColor || 'transparent'};color:{previewTheme.fontColor ||
            'inherit'}"
        >
          {#each HIGHLIGHT_SLOTS as slot (slot)}
            <span
              class="rounded-sm px-2 py-1"
              style="background:rgba({$highlightSlotStyles$[slot].rgb},{$highlightSlotStyles$[slot].alpha});
                     border-bottom:{$highlightSlotStyles$[slot].underlineWidth} {$highlightSlotStyles$[slot]
                .underlineStyle} rgb({$highlightSlotStyles$[slot].rgb});
                     color:{$highlightSlotStyles$[slot].ink}"
            >
              {$t('settings.highlightPalette.sample', { slot })}
            </span>
          {/each}
        </div>
        {#if $highlightPalette$ === 'custom'}
          <div class="-m-1 mt-2 flex flex-wrap">
            {#each HIGHLIGHT_SLOTS as slot, i (slot)}
              <label class="m-1 flex flex-col items-center gap-1">
                <input
                  type="color"
                  class="h-12 w-14 cursor-pointer rounded-md border-2 border-current/40 bg-transparent p-1"
                  value={customSlotColors[i]}
                  on:input={(ev) => setCustomSlotColor(i, ev.currentTarget.value)}
                />
                <span class="text-xs opacity-60">{slot}</span>
              </label>
            {/each}
          </div>
        {/if}
      </SettingsItemGroup>
    </div>

    <SettingsTypography />
  {:else if activeSettings === 'Reader'}
    <SettingsSectionHeader title={$t('settings.section.viewMode')} hint={$t('settings.section.viewModeHint')} />
    <div class="h-full">
      <SettingsItemGroup title={$t('settings.item.readerView')}>
        <ButtonToggleGroup options={optionsForViewMode} bind:selectedOptionId={viewMode} />
      </SettingsItemGroup>
    </div>


    <!-- 视图模式专属 -->
    <SettingsSectionHeader title={$t(viewMode === ViewMode.Continuous ? 'settings.section.readerBehavior.continuous' : 'settings.section.readerBehavior.paginated')} hint={$t(viewMode === ViewMode.Continuous ? 'settings.section.readerBehavior.continuousHint' : 'settings.section.readerBehavior.paginatedHint')} />
    {#if viewMode === ViewMode.Continuous}
      <SettingsItemGroup
        title={$t('settings.item.customReadingPoint')}
        tooltip={$t('settings.tip.customReadingPoint')}
      >
        <div class="flex items-center">
          <ButtonToggleGroup
            options={optionsForToggle}
            bind:selectedOptionId={customReadingPointEnabled}
          />
          {#if customReadingPointEnabled}
            <div
              tabindex="0"
              role="button"
              class="ml-4 hover:underline"
              on:click={() => {
                verticalCustomReadingPosition$.next(100);
                horizontalCustomReadingPosition$.next(0);
              }}
              on:keyup={activateOnKeyup}
            >
              {$t('settings.button.resetReadingPoint')}
            </div>
          {/if}
        </div>
      </SettingsItemGroup>
      <SettingsItemGroup title={$t('settings.item.autoRepositionOnResize')}>
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={autoPositionOnResize}
        />
      </SettingsItemGroup>
    {:else}
      <SettingsItemGroup title={$t('settings.item.avoidPaginationBreak')} tooltip={avoidPageBreakTooltip}>
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={avoidPageBreak} />
      </SettingsItemGroup>
      <SettingsItemGroup
        title="选中即书签"
        tooltip={'开启后，书签会落在当前/上次选中文本附近段落，而不是页首'}
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={selectionToBookmarkEnabled}
        />
      </SettingsItemGroup>
      <SettingsItemGroup title={$t('settings.item.tapToTurnPage')} tooltip={$t('settings.tip.tapToTurnPage')}>
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableTapEdgeToFlip} />
      </SettingsItemGroup>
      {#if !verticalMode}
        <SettingsItemGroup title={$t('settings.item.columnCount')} tooltip={$t('settings.tip.columnCount')}>
          <input type="number" class={inputClasses} step="1" min="0" bind:value={pageColumns} />
        </SettingsItemGroup>
      {/if}
      <SettingsItemGroup title={$t('settings.item.swipeThreshold')} tooltip={$t('settings.tip.swipeThreshold')}>
        <input
          type="number"
          step="1"
          min="10"
          class={inputClasses}
          bind:value={swipeThreshold}
          on:blur={() => {
            if (swipeThreshold < 10 || typeof swipeThreshold !== 'number') swipeThreshold = 10;
          }}
        />
      </SettingsItemGroup>
      <SettingsItemGroup title={$t('settings.item.disableWheelPageTurn')}>
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={disableWheelNavigation}
        />
      </SettingsItemGroup>
    {/if}

    <SettingsSectionHeader title={$t('settings.section.readerArea')} hint={$t('settings.section.readerAreaHint')} />
    <SettingsItemGroup title={verticalMode ? $t('settings.item.readerPaddingH') : $t('settings.item.readerPaddingV')}>
      <SettingsDimensionPopover
        slot="header"
        isFirstDimension
        isVertical={verticalMode}
        bind:dimensionValue={firstDimensionMargin}
      />
      <input
        type="number"
        class={inputClasses}
        step="1"
        min="0"
        bind:value={firstDimensionMargin}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={verticalMode ? $t('settings.item.readerMaxHeight') : $t('settings.item.readerMaxWidth')}>
      <SettingsDimensionPopover
        slot="header"
        isVertical={verticalMode}
        bind:dimensionValue={secondDimensionMaxValue}
      />
      <input
        type="number"
        class={inputClasses}
        step="1"
        min="0"
        bind:value={secondDimensionMaxValue}
      />
    </SettingsItemGroup>

    <SettingsSectionHeader title={$t('settings.section.bookmarks')} hint={$t('settings.section.bookmarksHint')} />
    <SettingsItemGroup title={$t('settings.item.autoBookmark')} tooltip={autoBookmarkTooltip}>
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={autoBookmark} />
    </SettingsItemGroup>
    {#if autoBookmark}
      <SettingsItemGroup title={$t('settings.item.autoBookmarkDelay')} tooltip={$t('settings.tip.autoBookmarkDelay')}>
        <input
          type="number"
          step="1"
          min="1"
          class={inputClasses}
          bind:value={autoBookmarkTime}
          on:blur={() => {
            if (autoBookmarkTime < 1 || typeof autoBookmarkTime !== 'number') autoBookmarkTime = 3;
          }}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup
      title={$t('settings.item.manualOnlyBookmark')}
      tooltip={$t('settings.tip.manualOnlyBookmark')}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={manualBookmark} />
    </SettingsItemGroup>

    <SettingsSectionHeader title={$t('settings.section.footerDisplay')} hint={$t('settings.section.footerDisplayHint')} />
    <SettingsItemGroup title={$t('settings.item.showCharacters')}>
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={showCharacterCounter} />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.showPercent')}>
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={showPercentage} />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.footerChapterChars')}>
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={showFooterChapterCharacterCounter}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.footerChapterPercent')}>
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={showFooterChapterPercentage}
      />
    </SettingsItemGroup>

    <SettingsSectionHeader title={$t('settings.section.imagesReadingPoint')} hint={$t('settings.section.imagesReadingPointHint')} />
    {#if $lastBookHasImages$}
      <SettingsItemGroup
        title={$t('settings.item.blurImages')}
        tooltip={$t('settings.tip.blurImages')}
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={blurImage} />
      </SettingsItemGroup>
      {#if blurImage}
        <SettingsItemGroup title={$t('settings.item.blurScope')} tooltip={$t('settings.tip.blurScope')}>
          <ButtonToggleGroup options={optionsForBlurMode} bind:selectedOptionId={blurImageMode} />
        </SettingsItemGroup>
      {/if}
    {/if}
    {#if statisticsEnabled}
      <SettingsItemGroup
        title={$t('settings.item.customReadingPointPause')}
        tooltip={$t('settings.tip.customReadingPointPause')}
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={pauseTrackerOnCustomPointChange}
        />
      </SettingsItemGroup>
    {/if}

    <SettingsSectionHeader title={$t('settings.section.miscReader')} hint={$t('settings.section.miscReaderHint')} />
    {#if wakeLockSupported}
      <SettingsItemGroup
        title={$t('settings.item.keepAwake')}
        tooltip={$t('settings.tip.keepAwake')}
      >
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={enableReaderWakeLock} />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup
      title={$t('settings.item.confirmClose')}
      tooltip={$t('settings.tip.confirmClose')}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={confirmClose} />
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t('settings.item.preferReaderStyle')}
      tooltip={$t('settings.tip.preferReaderStyle')}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={prioritizeReaderStyles} />
    </SettingsItemGroup>

    <!-- end legacy hidden block -->
  {:else if activeSettings === 'TTS'}
    <SettingsTts />

  {:else if activeSettings === 'AI'}
    <SettingsSectionHeader title={$t('settings.section.ai')} hint={$t('settings.section.aiHint')} />
    <div class="lg:col-span-3">
      <SettingsModels />
    </div>
    <div class="lg:col-span-3">
      <SettingsAi />
    </div>

  {:else if activeSettings === 'OCR'}
    <SettingsSectionHeader title={$t('settings.section.ocr')} hint={$t('settings.section.ocrHint')} />
    <div class="lg:col-span-3">
      <SettingsOcr />
    </div>

  {:else if activeSettings === 'Data'}
    <SettingsSectionHeader title={$t('settings.section.storageBackup')} hint={$t('settings.section.storageBackupHint')} />
    <div class="lg:col-span-3">
      <SettingsItemGroup title={$t('settings.item.syncStats')} tooltip="把每天的阅读时长同步到云端，桌面 + 手机 PWA 都能看到合并的数据">
        <SettingsSync />
      </SettingsItemGroup>
    </div>
    <div class="lg:col-span-3">
      <SettingsItemGroup title={$t('settings.item.localDataPaths')} tooltip={$t('settings.tip.localDataPaths')}>
        <SettingsDataPaths />
      </SettingsItemGroup>
    </div>
    {#if isTauri()}
      <SettingsItemGroup title={$t('settings.item.storageSource')} tooltip={$t('settings.tip.storageSource')}>
        <ButtonToggleGroup
          options={storageSourceOptions}
          bind:selectedOptionId={selectedStorageSource}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup title={$t('settings.item.persistentStorage')} tooltip={persistentStorageTooltip}>
      <div class="flex items-center">
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={persistentStorage} />
        {#if storageQuota}
          <div class="ml-4">{storageQuota}</div>
        {/if}
      </div>
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t('settings.item.resetUi')}
      tooltip={$t('settings.tip.resetUi')}
    >
      <button
        class="m-1 rounded-md border-2 border-current/40 p-2 text-danger"
        on:click={resetUiSettings}
      >
        {$t('settings.button.resetAndReload')}
        <Ripple />
      </button>
    </SettingsItemGroup>

    <SettingsSectionHeader title={$t('settings.section.importExport')} hint={$t('settings.section.importExportHint')} />
    <SettingsItemGroup title={$t('settings.item.epubFix')} tooltip={importHTMLFixModeTooltip}>
      <ButtonToggleGroup
        options={optionsForImportHTMLFixes}
        bind:selectedOptionId={importHTMLFixMode}
      />
    </SettingsItemGroup>
    {#if importHTMLFixMode !== ImportHTMLFixMode.OFF}
      <SettingsItemGroup
        title={$t('settings.item.linkOnly')}
        tooltip={$t('settings.tip.linkOnly')}
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={restrictImportFixToAnchor}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup title={$t('settings.item.autoImportExport')} tooltip={autoReplicationTypeTooltip}>
      <ButtonToggleGroup
        options={optionsForAutoReplicationType}
        bind:selectedOptionId={autoReplication}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.importExportStrategy')} tooltip={replicationSaveBehaviorTooltip}>
      <ButtonToggleGroup
        options={optionsForReplicationSaveBehavior}
        bind:selectedOptionId={replicationSaveBehavior}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.cacheData')} tooltip={cacheStorageDataTooltip}>
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={cacheStorageData} />
    </SettingsItemGroup>

    <SettingsSectionHeader title={$t('settings.section.readerBehaviorData')} hint={$t('settings.section.readerBehaviorDataHint')} />
    <SettingsItemGroup
      title={$t('settings.item.hideExternalHint')}
      tooltip={$t('settings.item.hideExternalHint')}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={hideExternalReadHint} />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t('settings.item.showPlaceholderCards')} tooltip={showExternalPlaceholderToolTip}>
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={showExternalPlaceholder}
      />
    </SettingsItemGroup>

    <SettingsSectionHeader title={$t('settings.section.diagnostics')} hint={$t('settings.section.diagnosticsHint')} />
    <SettingsItemGroup title={$t('settings.item.diagnosticLog')} tooltip={$t('settings.tip.diagnosticLog')}>
      <button
        class="m-1 rounded-md border-2 border-current/40 p-2"
        on:click={() =>
          dialogManager.dialogs$.next([
            {
              component: LogReportDialog,
              props: {
                title: tImmediate('settings.button.exportDiagnostics'),
                message: tImmediate('settings.tip.exportDiagnosticsMsg')
              }
            }
          ])}
      >
        {$t('settings.button.exportDiagnostics')}
        <Ripple />
      </button>
    </SettingsItemGroup>
  {:else}
    <SettingsSectionHeader title={$t('settings.section.statsBasics')} hint={$t('settings.section.statsBasicsHint')} />
    <SettingsItemGroup
      title={$t('settings.item.keepDataOnDelete')}
      tooltip={$t('settings.tip.keepDataOnDelete')}
    >
      <div class="flex items-center">
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={keepLocalStatisticsOnDeletion}
        />
        <div
          tabindex="0"
          role="button"
          class="ml-4 hover:underline"
          on:click={() => {
            showSpinner = true;
            database
              .clearZombieStatistics()
              .catch(({ message }) =>
                dialogManager.dialogs$.next([
                  {
                    component: MessageDialog,
                    props: {
                      title: tImmediate('common.error'),
                      message: `${tImmediate('settings.tip.clearZombieError')}: ${message}`
                    }
                  }
                ])
              )
              .finally(() => (showSpinner = false));
          }}
          on:keyup={() => {}}
        >
          {$t('settings.button.clearZombieStats')}
        </div>
      </div>
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t('settings.item.overwriteBookCompletion')}
      tooltip={$t('settings.tip.overwriteBookCompletion')}
    >
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={overwriteBookCompletion}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t('settings.item.startOfDayHour', { n: startOfDayHours })}
      tooltip={$t('settings.tip.startOfDayHour')}
    >
      <input
        type="range"
        step="1"
        min="0"
        max="23"
        class={inputClasses}
        bind:value={startDayHoursForTracker}
      />
    </SettingsItemGroup>
    <SettingsSectionHeader title={$t('settings.section.statsSync')} hint={$t('settings.section.statsSyncHint')} />
    <SettingsItemGroup
      title={$t('settings.item.statsMergeMode')}
      tooltip={$t('settings.tip.statsMergeMode')}
    >
      <ButtonToggleGroup
        options={optionsForMergeMode}
        bind:selectedOptionId={statisticsMergeMode}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t('settings.item.readingGoalMergeMode')}
      tooltip={$t('settings.tip.readingGoalMergeMode')}
    >
      <ButtonToggleGroup
        options={optionsForMergeMode}
        bind:selectedOptionId={readingGoalsMergeMode}
      />
    </SettingsItemGroup>
    <SettingsSectionHeader title={$t('settings.section.statsTracking')} hint={$t('settings.section.statsTrackingHint')} />
    <SettingsItemGroup
      title={$t('settings.item.enableStats')}
      tooltip={$t('settings.tip.enableStats')}
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={statisticsEnabled} />
    </SettingsItemGroup>
    {#if statisticsEnabled}
      <SettingsSectionHeader title={$t('settings.section.trackerBehavior')} hint={$t('settings.section.trackerBehaviorHint')} />
      <SettingsItemGroup title={$t('settings.item.statsAutoPause')} tooltip={trackerAutoPauseTooltip}>
        <ButtonToggleGroup
          options={optionsForTrackerAutoPause}
          bind:selectedOptionId={trackerAutoPause}
        />
      </SettingsItemGroup>
      <SettingsItemGroup title={$t('settings.item.statsOnComplete')}>
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={openTrackerOnCompletion}
        />
      </SettingsItemGroup>
      <SettingsItemGroup
        title={$t('settings.item.updateOnComplete')}
        tooltip={$t('settings.tip.updateOnComplete')}
      >
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={addCharactersOnCompletion}
        />
      </SettingsItemGroup>
      <SettingsSectionHeader title={$t('settings.section.autoThreshold')} hint={$t('settings.section.autoThresholdHint')} />
      <SettingsItemGroup
        title={$t('settings.item.autoStartSec')}
        tooltip={$t('settings.tip.autoStartSec')}
      >
        <input
          type="number"
          class={inputClasses}
          step="1"
          min="0"
          bind:value={trackerAutoStartTime}
          on:blur={() => {
            const newValue = Number.parseFloat(`${trackerAutoStartTime ?? 0}`);

            if (isNaN(newValue) || newValue < 1) {
              trackerAutoStartTime = 0;
            }
          }}
        />
      </SettingsItemGroup>
      <SettingsItemGroup
        title="空闲时间 (分钟)"
        tooltip={'无页面交互达到此分钟数后统计自动暂停（0 = 关闭，最大 12 小时）'}
      >
        <input
          type="number"
          class={inputClasses}
          step="0.5"
          min="0"
          bind:value={trackerIdleTimeInMin}
          on:blur={() => {
            if (!trackerIdleTimeInMin || trackerIdleTimeInMin < 0) {
              trackerIdleTime = 0;
            } else if (trackerIdleTimeInMin > 43200) {
              trackerIdleTime = 900;
            } else {
              trackerIdleTime = Math.floor(trackerIdleTimeInMin * 60);
            }
          }}
        />
      </SettingsItemGroup>
      <SettingsSectionHeader title="跳过检测" hint="单次采样字数突变（跳读 / 后退）的判定阈值与动作" />
      <SettingsItemGroup
        title="正向跳过阈值"
        tooltip={'两次采样间正向字数增量超过此阈值触发相应动作（0 = 关闭）'}
      >
        <input
          type="number"
          class={inputClasses}
          step="1"
          min="0"
          bind:value={trackerForwardSkipThreshold}
          on:blur={() => {
            if (trackerForwardSkipThreshold === 0) {
              trackerForwardSkipThreshold = 0;
            } else if (!trackerForwardSkipThreshold || trackerForwardSkipThreshold < 0) {
              trackerForwardSkipThreshold = 2700;
            }
          }}
        />
      </SettingsItemGroup>
      <SettingsItemGroup
        title="反向跳过阈值"
        tooltip={'两次采样间负向字数差超过此阈值触发相应动作（0 = 关闭）'}
      >
        <input
          type="number"
          class={inputClasses}
          step="1"
          bind:value={trackerBackwardSkipThreshold}
          on:blur={() => {
            if (trackerBackwardSkipThreshold < 0) {
              trackerBackwardSkipThreshold = Math.abs(trackerBackwardSkipThreshold);
            } else if (trackerBackwardSkipThreshold === 0) {
              trackerBackwardSkipThreshold = 0;
            } else if (!trackerBackwardSkipThreshold) {
              trackerBackwardSkipThreshold = 2700;
            }
          }}
        />
      </SettingsItemGroup>
      {#if trackerForwardSkipThreshold || trackerBackwardSkipThreshold}
        <SettingsItemGroup
          title="阈值动作"
          tooltip={'达到阈值时执行的动作'}
        >
          <ButtonToggleGroup
            options={optionsForTrackerSkipThresholdAction}
            bind:selectedOptionId={trackerSkipThresholdAction}
          />
        </SettingsItemGroup>
      {/if}
      {#if trackerAutoPause !== TrackerAutoPause.OFF}
        <SettingsItemGroup
          title="词典检测"
          tooltip={'开启后，检测到 Yomitan / jpdb-browser-reader 打开时跳过自动暂停（Yomitan 需关闭 Secure Container）'}
        >
          <ButtonToggleGroup
            options={optionsForToggle}
            bind:selectedOptionId={trackerPopupDetection}
          />
        </SettingsItemGroup>
      {/if}
      {#if trackerIdleTime > 0}
        <SettingsItemGroup
          title="空闲时回滚统计"
          tooltip={'开启后，会从本次会话中扣除空闲时间以回滚统计'}
        >
          <ButtonToggleGroup
            options={optionsForToggle}
            bind:selectedOptionId={adjustStatisticsAfterIdleTime}
          />
        </SettingsItemGroup>
      {/if}
      <SettingsSectionHeader title="阅读目标" hint="按日 / 周设定的字数与时长目标" />
      <div class="lg:col-span-3">
        <SettingsReadingGoals on:spinner={({ detail }) => (showSpinner = detail)} />
      </div>
    {/if}
  {/if}
  {#if showSpinner}
    <div class="tap-highlight-transparent fixed inset-0 bg-black/[.2]" />
    <div class="fixed inset-0 flex h-full w-full items-center justify-center text-7xl">
      <Fa icon={faSpinner} spin />
    </div>
  {/if}
</div>
