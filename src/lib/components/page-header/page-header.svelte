<script lang="ts">
  /**
   * The top bar shared by every non-reader page (statistics, notebook,
   * translate, settings, changelog).
   *
   * Before this, those five pages had three different bars between them: two
   * on the dark menu colour with tabs, three on the page colour with an `<h1>`
   * and text buttons. Navigating between them looked like navigating between
   * apps.
   *
   * The layout rule is one line: this page's own sub-views and actions go
   * left, the ways out of this page go right. Nothing carries a text label —
   * an icon plus its tooltip is enough once the bar is the same everywhere,
   * and the labels were what forced the responsive clipping rules the old
   * headers were full of.
   */
  import Fa from 'svelte-fa';
  import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
  import MergedHeaderIcon from '$lib/components/merged-header-icon/merged-header-icon.svelte';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import { baseHeaderClasses, baseIconClasses, pxScreen } from '$lib/css-classes';
  import { t } from '$lib/i18n';

  /** Identity of the page, since no title text is shown. */
  export let icon: IconDefinition;
  export let titleKey: string;
  /**
   * Where the back arrow goes — usually the page you came from, so opening
   * the notebook mid-book still returns you to the book. Empty hides it.
   */
  export let backLink = '';

  /**
   * The other main pages, minus this one (MergedHeaderIcon drops it).
   * 书库 goes last so it is always the rightmost icon in the window — the
   * way out sits in one fixed place no matter which page you are on.
   */
  const destinations = [
    mergeEntries.STATISTICS,
    mergeEntries.NOTEBOOK,
    mergeEntries.TRANSLATE,
    mergeEntries.SETTINGS,
    mergeEntries.CHANGELOG,
    mergeEntries.MANAGE
  ];
</script>

<div class="elevation-4 fixed inset-x-0 top-0 z-40">
  <div class={baseHeaderClasses}>
    <div class="{pxScreen} flex px-0 md:px-5">
      <div class="flex h-12 min-w-0 grow items-center xl:h-10">
        <div class="{baseIconClasses} !cursor-default !opacity-100" title={$t(titleKey)}>
          <Fa {icon} />
        </div>
        <!--
          Without these rules the bar is one undifferentiated run of icons and
          "which page am I on" reads the same as "what can I press". The
          dividers separate identity | this page | leaving this page.
        -->
        {#if $$slots.left}
          <div class="mr-1 h-5 w-px shrink-0 bg-current/30"></div>
        {/if}
        <slot name="left" />
      </div>
      <div class="flex h-12 shrink-0 items-center xl:h-10">
        <slot name="right" />
        {#if $$slots.right}
          <div class="mx-1 h-5 w-px shrink-0 bg-current/30"></div>
        {/if}
        {#if backLink}
          <a href={backLink} style="color: inherit;" title={$t('menu.back.title')}>
            <div class="{baseIconClasses} !opacity-100">
              <Fa icon={mergeEntries.BACK.icon} />
            </div>
          </a>
        {/if}
        <MergedHeaderIcon items={destinations} mergeTo={mergeEntries.MORE} alwaysCollapse={false} />
      </div>
    </div>
  </div>
</div>
