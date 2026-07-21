<script lang="ts">
  /**
   * Period preset chip row (Phase D, 1.20.1). Sits at the top of the
   * statistics panel and drives `lastStatisticsRangeTemplate$` — the
   * existing `setSelectedStatisticsDays` in /statistics/+page.svelte
   * reacts to that store to update start/end dates. So this is pure UI:
   * user picks a chip → store changes → dates recompute → all tabs
   * re-render off the new period.
   *
   * "今年" replaces the standalone 年度 tab (removed in 1.20.1): the
   * narrative-回顾 cards on main view already cover most of what the
   * old year tab showed.
   */
  import {
    StatisticsRangeTemplate,
    statisticsRangeTemplates
  } from '$lib/components/statistics/statistics-types';
  import { lastStatisticsRangeTemplate$ } from '$lib/data/store';

  const CHIP_HINTS: Partial<Record<StatisticsRangeTemplate, string>> = {
    [StatisticsRangeTemplate.TODAY]: '今天',
    [StatisticsRangeTemplate.WEEK]: '本周 7 天',
    [StatisticsRangeTemplate.MONTH]: '本月 1 日至今',
    [StatisticsRangeTemplate.YEAR]: '今年 1 月 1 日至 12 月 31 日',
    [StatisticsRangeTemplate.ALL]: '从 2000-01-01 到今天',
    [StatisticsRangeTemplate.CUSTOM]: '在右上设置抽屉里选起止日期'
  };

  function pick(t: StatisticsRangeTemplate) {
    $lastStatisticsRangeTemplate$ = t;
  }
</script>

<div class="flex flex-wrap gap-1.5 py-2 items-center">
  <span class="text-xs opacity-60 mr-1">时段</span>
  {#each statisticsRangeTemplates as t (t)}
    {@const active = $lastStatisticsRangeTemplate$ === t}
    <button
      type="button"
      class="chip"
      class:active
      title={CHIP_HINTS[t]}
      on:click={() => pick(t)}
    >
      {t}
    </button>
  {/each}
</div>

<style>
  .chip {
    padding: 0.2rem 0.75rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
    font-size: 0.78rem;
    background: transparent;
    color: inherit;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .chip:hover {
    background: color-mix(in srgb, var(--accent-color, #5f7e7b) 12%, transparent);
  }
  .chip.active {
    background: color-mix(in srgb, var(--accent-color, #5f7e7b) 20%, transparent);
    border-color: var(--accent-color, #5f7e7b);
    color: var(--accent-color, #5f7e7b);
    font-weight: 600;
  }
</style>
