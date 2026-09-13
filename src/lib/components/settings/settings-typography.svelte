<script lang="ts">
  import { browser } from '$app/environment';
  import { faComputer } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import { optionsForToggle, type ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import SettingsFontSelector from '$lib/components/settings/settings-font-selector.svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSectionHeader from '$lib/components/settings/settings-section-header.svelte';
  import SettingsUserFontDialog from '$lib/components/settings/settings-user-font-dialog.svelte';
  import { inputClasses } from '$lib/css-classes';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { LocalFont } from '$lib/data/fonts';
  import { FuriganaStyle } from '$lib/data/furigana-style';
  import {
    enableFontVPAL$,
    enableTextJustification$,
    enableTextWrapPretty$,
    enableVerticalFontKerning$,
    fontFamilyGroupOne$,
    fontFamilyGroupTwo$,
    fontSize$,
    fontWeight$,
    furiganaStyle$,
    hideFurigana$,
    lineHeight$,
    textIndentation$,
    textMarginMode$,
    textMarginValue$,
    verticalTextOrientation$,
    writingMode$
  } from '$lib/data/store';
  import type { TextMarginMode } from '$lib/data/text-margin-mode';
  import type { VerticalTextOrientation } from '$lib/data/vertical-text-orientation';
  import type { WritingMode } from '$lib/data/writing-mode';
  import { activateOnKeyup } from '$lib/functions/utils';
  import { t } from '$lib/i18n';

  /** Off inside the reader drawer, which titles itself — same as settings-tts. */
  export let showSectionHeader = true;

  $: verticalMode = $writingMode$ === 'vertical-rl';
  $: fontCacheSupported = browser && 'caches' in window;

  $: optionsForTextMarginMode = [
    { id: 'auto', text: $t('settings.value.textMargin.auto') },
    { id: 'manual', text: $t('settings.value.textMargin.manual') }
  ] as ToggleOption<TextMarginMode>[];

  $: optionsForWritingMode = [
    { id: 'horizontal-tb', text: $t('settings.value.wm.horizontal') },
    { id: 'vertical-rl', text: $t('settings.value.wm.vertical') }
  ] as ToggleOption<WritingMode>[];

  $: optionsForVerticalTextOrientation = [
    { id: 'mixed', text: $t('settings.value.vto.mixed') },
    { id: 'upright', text: $t('settings.value.vto.upright') }
  ] as ToggleOption<VerticalTextOrientation>[];

  $: optionsForFuriganaStyle = [
    { id: FuriganaStyle.Hide, text: $t('settings.value.furigana.hide') },
    { id: FuriganaStyle.Partial, text: $t('settings.value.furigana.partial') },
    { id: FuriganaStyle.Toggle, text: $t('settings.value.furigana.toggle') },
    { id: FuriganaStyle.Full, text: $t('settings.value.furigana.full') }
  ] as ToggleOption<FuriganaStyle>[];

  $: verticalTextOrientationTooltip =
    $verticalTextOrientation$ === 'mixed'
      ? $t('settings.tip.vto.mixed')
      : $t('settings.tip.vto.upright');

  let furiganaStyleTooltip = '';
  $: switch ($furiganaStyle$) {
    case FuriganaStyle.Hide:
      furiganaStyleTooltip = $t('settings.tip.furigana.hide');
      break;
    case FuriganaStyle.Toggle:
      furiganaStyleTooltip = $t('settings.tip.furigana.toggle');
      break;
    case FuriganaStyle.Full:
      furiganaStyleTooltip = $t('settings.tip.furigana.full');
      break;
    default:
      furiganaStyleTooltip = $t('settings.tip.furigana.partial');
      break;
  }
</script>

{#if showSectionHeader}
  <SettingsSectionHeader title={$t('settings.section.fontsTypography')} />
{/if}
<SettingsItemGroup title={$t('settings.item.fontGroup1')}>
  <div slot="header" class="flex items-center">
    <SettingsFontSelector
      availableFonts={[
        LocalFont.NOTOSANSSC,
        LocalFont.NOTOSERIFJP,
        LocalFont.KZUDMINCHO,
        LocalFont.SERIF
      ]}
      bind:fontValue={$fontFamilyGroupOne$}
    />
    {#if fontCacheSupported}
      <div
        tabindex="0"
        role="button"
        title="打开自定义字体对话框"
        on:click={() =>
          dialogManager.dialogs$.next([
            {
              component: SettingsUserFontDialog,
              props: { fontFamily: fontFamilyGroupOne$ }
            }
          ])}
        on:keyup={activateOnKeyup}
      >
        <Fa icon={faComputer} />
      </div>
    {/if}
  </div>
  <input
    type="text"
    class={inputClasses}
    placeholder="Noto Sans SC"
    bind:value={$fontFamilyGroupOne$}
  />
</SettingsItemGroup>
<SettingsItemGroup title={$t('settings.item.fontGroup2')}>
  <div slot="header" class="flex items-center">
    <SettingsFontSelector
      availableFonts={[LocalFont.NOTOSANSSC, LocalFont.NOTOSANSJP, LocalFont.KZUDGOTHIC, LocalFont.SANSSERIF]}
      bind:fontValue={$fontFamilyGroupTwo$}
    />
    {#if fontCacheSupported}
      <div
        tabindex="0"
        role="button"
        on:click={() =>
          dialogManager.dialogs$.next([
            {
              component: SettingsUserFontDialog,
              props: { fontFamily: fontFamilyGroupTwo$ }
            }
          ])}
        on:keyup={activateOnKeyup}
      >
        <Fa icon={faComputer} />
      </div>
    {/if}
  </div>
  <input
    type="text"
    class={inputClasses}
    placeholder="Noto Sans SC"
    bind:value={$fontFamilyGroupTwo$}
  />
</SettingsItemGroup>
<SettingsItemGroup title={$t('settings.item.fontSize')}>
  <input type="number" class={inputClasses} step="1" min="1" bind:value={$fontSize$} />
</SettingsItemGroup>
<SettingsItemGroup title={$t('settings.item.lineHeight')}>
  <input
    type="number"
    class={inputClasses}
    step="0.05"
    min="1"
    bind:value={$lineHeight$}
    on:change={() => {
      if (!$lineHeight$ || $lineHeight$ < 1) {
        $lineHeight$ = 1.65;
      }
    }}
  />
</SettingsItemGroup>
<SettingsItemGroup title={$t('settings.item.fontWeight')} tooltip={$t('settings.tip.fontWeight')}>
  <input
    type="number"
    placeholder="默认"
    class={inputClasses}
    step="100"
    min="100"
    max="1000"
    bind:value={$fontWeight$}
    on:change={() => {
      if ($fontWeight$ === null) return;
      if ($fontWeight$ < 100) $fontWeight$ = 100;
      else if ($fontWeight$ > 1000) $fontWeight$ = 1000;
    }}
  />
</SettingsItemGroup>
<SettingsSectionHeader title={$t('settings.section.paragraphs')} />
<SettingsItemGroup title={$t('settings.item.paraIndent')} tooltip={$t('settings.tip.paraIndent')}>
  <input
    type="number"
    class={inputClasses}
    step=".5"
    min="0"
    bind:value={$textIndentation$}
    on:blur={() => {
      const newValue = Number.parseFloat(`${$textIndentation$ ?? 0}`);
      if (isNaN(newValue) || newValue < 1) $textIndentation$ = 0;
    }}
  />
</SettingsItemGroup>
<SettingsItemGroup title={$t('settings.item.paraSpacingMode')} tooltip={$t('settings.tip.paraSpacingMode')}>
  <ButtonToggleGroup
    options={optionsForTextMarginMode}
    bind:selectedOptionId={$textMarginMode$}
  />
</SettingsItemGroup>
{#if $textMarginMode$ === 'manual'}
  <SettingsItemGroup title={$t('settings.item.paraSpacing')} tooltip={$t('settings.tip.paraSpacing')}>
    <input
      type="number"
      class={inputClasses}
      step=".5"
      min="0"
      bind:value={$textMarginValue$}
      on:blur={() => {
        const newValue = Number.parseFloat(`${$textMarginValue$ ?? 0}`);
        if (isNaN(newValue) || newValue < 1) $textMarginValue$ = 0;
      }}
    />
  </SettingsItemGroup>
{/if}
<SettingsItemGroup title={$t('settings.item.justify')} tooltip={$t('settings.tip.justify')}>
  <ButtonToggleGroup
    options={optionsForToggle}
    bind:selectedOptionId={$enableTextJustification$}
  />
</SettingsItemGroup>
<SettingsItemGroup title={$t('settings.item.prettyWrap')} tooltip={$t('settings.tip.prettyWrap')}>
  <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$enableTextWrapPretty$} />
</SettingsItemGroup>
<SettingsItemGroup title={$t('settings.item.writingDirection')}>
  <ButtonToggleGroup options={optionsForWritingMode} bind:selectedOptionId={$writingMode$} />
</SettingsItemGroup>
{#if verticalMode}
  <SettingsItemGroup title={$t('settings.item.enableKerning')} tooltip={$t('settings.tip.enableKerning')}>
    <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$enableVerticalFontKerning$} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t('settings.item.enableVpal')} tooltip={$t('settings.tip.enableVpal')}>
    <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$enableFontVPAL$} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t('settings.item.textOrientation')} tooltip={verticalTextOrientationTooltip}>
    <ButtonToggleGroup
      options={optionsForVerticalTextOrientation}
      bind:selectedOptionId={$verticalTextOrientation$}
    />
  </SettingsItemGroup>
{/if}
<SettingsSectionHeader title={$t('settings.section.furigana')} />
<SettingsItemGroup title={$t('settings.item.hideFurigana')}>
  <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$hideFurigana$} />
</SettingsItemGroup>
{#if $hideFurigana$}
  <SettingsItemGroup title={$t('settings.item.furiganaStyle')} tooltip={furiganaStyleTooltip}>
    <ButtonToggleGroup
      options={optionsForFuriganaStyle}
      bind:selectedOptionId={$furiganaStyle$}
    />
  </SettingsItemGroup>
{/if}
