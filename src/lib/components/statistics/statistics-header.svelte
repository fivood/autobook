<script lang="ts">
  import { goto } from '$app/navigation';
  import {
    faBook,
    faCalendarDays,
    faChartPie,
    faClock,
    faFileArrowDown,
    faHighlighter,
    faPenToSquare,
    faSliders,
    faUserPen,
    faGaugeHigh
  } from '@fortawesome/free-solid-svg-icons';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import PageHeader from '$lib/components/page-header/page-header.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import {
    StatisticsTab,
    exportYearReport$,
    openManualStatisticsEntry$
  } from '$lib/components/statistics/statistics-types';
  import { baseIconClasses } from '$lib/css-classes';
  import { pagePath } from '$lib/data/env';
  import { lastStatisticsTab$ } from '$lib/data/store';
  import { activateOnKeyup } from '$lib/functions/utils';
  import Fa from 'svelte-fa';
  import { t } from '$lib/i18n';

  export let currentBookId: number | undefined;
  export let showStatisticsSettings: boolean;

  /**
   * `tab` is the stored value (the enum carries the Chinese literals that end
   * up in localStorage) — only `labelKey` goes through $t, and only as the
   * tooltip: the bar is icons now, on every width. The labels used to need
   * three responsive rules to avoid being clipped, and they still were in ja.
   */
  const tabs = [
    { tab: StatisticsTab.MAIN, labelKey: 'stats.tab.main', icon: faGaugeHigh },
    { tab: StatisticsTab.SUMMARY, labelKey: 'stats.tab.summary', icon: faCalendarDays },
    { tab: StatisticsTab.BOOKS, labelKey: 'stats.tab.books', icon: faBook },
    { tab: StatisticsTab.AUTHORS, labelKey: 'stats.tab.authors', icon: faUserPen },
    { tab: StatisticsTab.SESSIONS, labelKey: 'stats.tab.sessions', icon: faClock },
    { tab: StatisticsTab.YEAR, labelKey: 'stats.tab.year', icon: faChartPie },
    { tab: StatisticsTab.HIGHLIGHTS, labelKey: 'stats.tab.highlights', icon: faHighlighter }
  ];
</script>

<PageHeader icon={mergeEntries.STATISTICS.icon} titleKey="menu.statistics.title">
  <svelte:fragment slot="left">
    {#each tabs as item (item.tab)}
      <button
        type="button"
        class="chrome-tab flex h-full items-center justify-center px-3 text-lg xl:px-2.5 {$lastStatisticsTab$ ===
        item.tab
          ? 'is-active'
          : 'is-inactive'}"
        title={$t(item.labelKey)}
        aria-label={$t(item.labelKey)}
        aria-pressed={$lastStatisticsTab$ === item.tab}
        on:click={() => ($lastStatisticsTab$ = item.tab)}
      >
        <Fa icon={item.icon} />
        <Ripple />
      </button>
    {/each}
  </svelte:fragment>

  <svelte:fragment slot="right">
    <!--
      Every other tab renders `statistic` rows, so adding one is visible
      straight away. The highlights tab reads the `highlight` store and takes
      no statistics at all — the button there produced no feedback whatsoever,
      which is worse than it being absent.
    -->
    {#if $lastStatisticsTab$ !== StatisticsTab.HIGHLIGHTS}
      <div
        tabindex="0"
        role="button"
        aria-label={$t('stats.header.manualEntry')}
        title={$t('stats.header.manualEntry')}
        class={baseIconClasses}
        on:click={() => openManualStatisticsEntry$.next()}
        on:keyup={activateOnKeyup}
      >
        <Fa icon={faPenToSquare} />
      </div>
    {/if}
    <div
      tabindex="0"
      role="button"
      aria-label={$t('stats.header.exportReport')}
      title={$t('stats.header.exportReport')}
      class={baseIconClasses}
      on:click={() => exportYearReport$.next()}
      on:keyup={activateOnKeyup}
    >
      <Fa icon={faFileArrowDown} />
    </div>
    <div
      tabindex="0"
      role="button"
      aria-label={$t('stats.header.openSettings')}
      title={$t('stats.header.openSettings')}
      class={baseIconClasses}
      on:click={() => (showStatisticsSettings = true)}
      on:keyup={activateOnKeyup}
    >
      <Fa icon={faSliders} />
    </div>
    {#if currentBookId}
      <svg
        tabindex="0"
        role="button"
        aria-label={$t('stats.header.backToBook')}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        class={baseIconClasses}
        on:click={() => goto(`${pagePath}/b?id=${currentBookId}`)}
        on:keyup={activateOnKeyup}
      >
        <title>{$t('stats.header.backToBook')}</title>
        <path
          class="fill-current"
          d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5zm-3.5-8c.88 0 1.73.09 2.5.26V9.24c-.79-.15-1.64-.24-2.5-.24-1.7 0-3.24.29-4.5.83v1.66c1.13-.64 2.7-.99 4.5-.99zM13 12.49v1.66c1.13-.64 2.7-.99 4.5-.99.88 0 1.73.09 2.5.26V11.9c-.79-.15-1.64-.24-2.5-.24-1.7 0-3.24.3-4.5.83zm4.5 1.84c-1.7 0-3.24.29-4.5.83v1.66c1.13-.64 2.7-.99 4.5-.99.88 0 1.73.09 2.5.26v-1.52c-.79-.16-1.64-.24-2.5-.24z"
        />
      </svg>
    {/if}
  </svelte:fragment>
</PageHeader>
