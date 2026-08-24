<script lang="ts">
  import { browser } from '$app/environment';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import {
    optionsForToggle,
    type ToggleOption
  } from '$lib/components/button-toggle-group/toggle-option';
  import SettingsDimensionPopover from '$lib/components/settings/settings-dimension-popover.svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSectionHeader from '$lib/components/settings/settings-section-header.svelte';
  import { inputClasses } from '$lib/css-classes';
  import { BlurMode } from '$lib/data/blur-mode';
  import {
    autoBookmark$,
    autoBookmarkTime$,
    autoPositionOnResize$,
    avoidPageBreak$,
    confirmClose$,
    customReadingPointEnabled$,
    disableWheelNavigation$,
    enableReaderWakeLock$,
    enableTapEdgeToFlip$,
    firstDimensionMargin$,
    hideSpoilerImage$,
    hideSpoilerImageMode$,
    horizontalCustomReadingPosition$,
    lastBookHasImages$,
    manualBookmark$,
    pageColumns$,
    pauseTrackerOnCustomPointChange$,
    prioritizeReaderStyles$,
    secondDimensionMaxValue$,
    selectionToBookmarkEnabled$,
    showCharacterCounter$,
    showFooterChapterCharacterCounter$,
    showFooterChapterPercentage$,
    showPercentage$,
    statisticsEnabled$,
    swipeThreshold$,
    verticalCustomReadingPosition$,
    viewMode$,
    writingMode$
  } from '$lib/data/store';
  import { ViewMode } from '$lib/data/view-mode';
  import { activateOnKeyup } from '$lib/functions/utils';
  import { t } from '$lib/i18n';

  /** Off inside the reader drawer, which titles itself — same as settings-tts. */
  export let showSectionHeader = true;

  $: verticalMode = $writingMode$ === 'vertical-rl';
  $: wakeLockSupported = browser && 'wakeLock' in navigator;

  $: optionsForViewMode = [
    { id: ViewMode.Continuous, text: $t('settings.value.viewMode.continuous') },
    { id: ViewMode.Paginated, text: $t('settings.value.viewMode.paginated') }
  ] as ToggleOption<ViewMode>[];

  $: optionsForBlurMode = [
    { id: BlurMode.ALL, text: $t('settings.value.blur.all') },
    { id: BlurMode.AFTER_TOC, text: $t('settings.value.blur.cover') },
    { id: BlurMode.NONE, text: $t('settings.value.blur.none') }
  ] as ToggleOption<BlurMode>[];

  $: autoBookmarkTooltip = $t('settings.tip.autoBookmark', { n: $autoBookmarkTime$ });
  $: avoidPageBreakTooltip = $avoidPageBreak$
    ? $t('settings.tip.avoidBreak.on')
    : $t('settings.tip.avoidBreak.off');
</script>

{#if showSectionHeader}
  <SettingsSectionHeader title={$t('settings.section.viewMode')} hint={$t('settings.section.viewModeHint')} />
{/if}
<div class="h-full">
  <SettingsItemGroup title={$t('settings.item.readerView')}>
    <ButtonToggleGroup options={optionsForViewMode} bind:selectedOptionId={$viewMode$} />
  </SettingsItemGroup>
</div>


<!-- 视图模式专属 -->
<SettingsSectionHeader title={$t($viewMode$ === ViewMode.Continuous ? 'settings.section.readerBehavior.continuous' : 'settings.section.readerBehavior.paginated')} hint={$t($viewMode$ === ViewMode.Continuous ? 'settings.section.readerBehavior.continuousHint' : 'settings.section.readerBehavior.paginatedHint')} />
{#if $viewMode$ === ViewMode.Continuous}
  <SettingsItemGroup
    title={$t('settings.item.customReadingPoint')}
    tooltip={$t('settings.tip.customReadingPoint')}
  >
    <div class="flex items-center">
      <ButtonToggleGroup
        options={optionsForToggle}
        bind:selectedOptionId={$customReadingPointEnabled$}
      />
      {#if $customReadingPointEnabled$}
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
      bind:selectedOptionId={$autoPositionOnResize$}
    />
  </SettingsItemGroup>
{:else}
  <SettingsItemGroup title={$t('settings.item.avoidPaginationBreak')} tooltip={avoidPageBreakTooltip}>
    <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$avoidPageBreak$} />
  </SettingsItemGroup>
  <SettingsItemGroup
    title="选中即书签"
    tooltip={'开启后，书签会落在当前/上次选中文本附近段落，而不是页首'}
  >
    <ButtonToggleGroup
      options={optionsForToggle}
      bind:selectedOptionId={$selectionToBookmarkEnabled$}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t('settings.item.tapToTurnPage')} tooltip={$t('settings.tip.tapToTurnPage')}>
    <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$enableTapEdgeToFlip$} />
  </SettingsItemGroup>
  {#if !verticalMode}
    <SettingsItemGroup title={$t('settings.item.columnCount')} tooltip={$t('settings.tip.columnCount')}>
      <input type="number" class={inputClasses} step="1" min="0" bind:value={$pageColumns$} />
    </SettingsItemGroup>
  {/if}
  <SettingsItemGroup title={$t('settings.item.swipeThreshold')} tooltip={$t('settings.tip.swipeThreshold')}>
    <input
      type="number"
      step="1"
      min="10"
      class={inputClasses}
      bind:value={$swipeThreshold$}
      on:blur={() => {
        if ($swipeThreshold$ < 10 || typeof $swipeThreshold$ !== 'number') $swipeThreshold$ = 10;
      }}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t('settings.item.disableWheelPageTurn')}>
    <ButtonToggleGroup
      options={optionsForToggle}
      bind:selectedOptionId={$disableWheelNavigation$}
    />
  </SettingsItemGroup>
{/if}

<SettingsSectionHeader title={$t('settings.section.readerArea')} hint={$t('settings.section.readerAreaHint')} />
<SettingsItemGroup title={verticalMode ? $t('settings.item.readerPaddingH') : $t('settings.item.readerPaddingV')}>
  <SettingsDimensionPopover
    slot="header"
    isFirstDimension
    isVertical={verticalMode}
    bind:dimensionValue={$firstDimensionMargin$}
  />
  <input
    type="number"
    class={inputClasses}
    step="1"
    min="0"
    bind:value={$firstDimensionMargin$}
  />
</SettingsItemGroup>
<SettingsItemGroup title={verticalMode ? $t('settings.item.readerMaxHeight') : $t('settings.item.readerMaxWidth')}>
  <SettingsDimensionPopover
    slot="header"
    isVertical={verticalMode}
    bind:dimensionValue={$secondDimensionMaxValue$}
  />
  <input
    type="number"
    class={inputClasses}
    step="1"
    min="0"
    bind:value={$secondDimensionMaxValue$}
  />
</SettingsItemGroup>

<SettingsSectionHeader title={$t('settings.section.bookmarks')} hint={$t('settings.section.bookmarksHint')} />
<SettingsItemGroup title={$t('settings.item.autoBookmark')} tooltip={autoBookmarkTooltip}>
  <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$autoBookmark$} />
</SettingsItemGroup>
{#if $autoBookmark$}
  <SettingsItemGroup title={$t('settings.item.autoBookmarkDelay')} tooltip={$t('settings.tip.autoBookmarkDelay')}>
    <input
      type="number"
      step="1"
      min="1"
      class={inputClasses}
      bind:value={$autoBookmarkTime$}
      on:blur={() => {
        if ($autoBookmarkTime$ < 1 || typeof $autoBookmarkTime$ !== 'number') $autoBookmarkTime$ = 3;
      }}
    />
  </SettingsItemGroup>
{/if}
<SettingsItemGroup
  title={$t('settings.item.manualOnlyBookmark')}
  tooltip={$t('settings.tip.manualOnlyBookmark')}
>
  <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$manualBookmark$} />
</SettingsItemGroup>

<SettingsSectionHeader title={$t('settings.section.footerDisplay')} hint={$t('settings.section.footerDisplayHint')} />
<SettingsItemGroup title={$t('settings.item.showCharacters')}>
  <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$showCharacterCounter$} />
</SettingsItemGroup>
<SettingsItemGroup title={$t('settings.item.showPercent')}>
  <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$showPercentage$} />
</SettingsItemGroup>
<SettingsItemGroup title={$t('settings.item.footerChapterChars')}>
  <ButtonToggleGroup
    options={optionsForToggle}
    bind:selectedOptionId={$showFooterChapterCharacterCounter$}
  />
</SettingsItemGroup>
<SettingsItemGroup title={$t('settings.item.footerChapterPercent')}>
  <ButtonToggleGroup
    options={optionsForToggle}
    bind:selectedOptionId={$showFooterChapterPercentage$}
  />
</SettingsItemGroup>

<SettingsSectionHeader title={$t('settings.section.imagesReadingPoint')} hint={$t('settings.section.imagesReadingPointHint')} />
{#if $lastBookHasImages$}
  <SettingsItemGroup
    title={$t('settings.item.blurImages')}
    tooltip={$t('settings.tip.blurImages')}
  >
    <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$hideSpoilerImage$} />
  </SettingsItemGroup>
  {#if $hideSpoilerImage$}
    <SettingsItemGroup title={$t('settings.item.blurScope')} tooltip={$t('settings.tip.blurScope')}>
      <ButtonToggleGroup options={optionsForBlurMode} bind:selectedOptionId={$hideSpoilerImageMode$} />
    </SettingsItemGroup>
  {/if}
{/if}
{#if $statisticsEnabled$}
  <SettingsItemGroup
    title={$t('settings.item.customReadingPointPause')}
    tooltip={$t('settings.tip.customReadingPointPause')}
  >
    <ButtonToggleGroup
      options={optionsForToggle}
      bind:selectedOptionId={$pauseTrackerOnCustomPointChange$}
    />
  </SettingsItemGroup>
{/if}

<SettingsSectionHeader title={$t('settings.section.miscReader')} hint={$t('settings.section.miscReaderHint')} />
{#if wakeLockSupported}
  <SettingsItemGroup
    title={$t('settings.item.keepAwake')}
    tooltip={$t('settings.tip.keepAwake')}
  >
    <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$enableReaderWakeLock$} />
  </SettingsItemGroup>
{/if}
<SettingsItemGroup
  title={$t('settings.item.confirmClose')}
  tooltip={$t('settings.tip.confirmClose')}
>
  <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$confirmClose$} />
</SettingsItemGroup>
<SettingsItemGroup
  title={$t('settings.item.preferReaderStyle')}
  tooltip={$t('settings.tip.preferReaderStyle')}
>
  <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$prioritizeReaderStyles$} />
</SettingsItemGroup>

