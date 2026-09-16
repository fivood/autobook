<script lang="ts">
  import {
    StatisticsRangeTemplate,
    statisticsRangeTemplates
  } from '$lib/components/statistics/statistics-types';
  import { lastStatisticsRangeTemplate$ } from '$lib/data/store';
  import { t } from '$lib/i18n';

  const LABEL_KEY: Record<StatisticsRangeTemplate, string> = {
    [StatisticsRangeTemplate.TODAY]: 'stats.period.today',
    [StatisticsRangeTemplate.WEEK]: 'stats.period.week',
    [StatisticsRangeTemplate.MONTH]: 'stats.period.month',
    [StatisticsRangeTemplate.YEAR]: 'stats.period.year',
    [StatisticsRangeTemplate.ALL]: 'stats.period.all',
    [StatisticsRangeTemplate.CUSTOM]: 'stats.period.custom'
  };
  const HINT_KEY: Record<StatisticsRangeTemplate, string> = {
    [StatisticsRangeTemplate.TODAY]: 'stats.period.hint.today',
    [StatisticsRangeTemplate.WEEK]: 'stats.period.hint.week',
    [StatisticsRangeTemplate.MONTH]: 'stats.period.hint.month',
    [StatisticsRangeTemplate.YEAR]: 'stats.period.hint.year',
    [StatisticsRangeTemplate.ALL]: 'stats.period.hint.all',
    [StatisticsRangeTemplate.CUSTOM]: 'stats.period.hint.custom'
  };

  function pick(t: StatisticsRangeTemplate) {
    $lastStatisticsRangeTemplate$ = t;
  }
</script>

<div class="flex flex-wrap gap-1.5 py-2 items-center">
  <span class="text-xs opacity-60 mr-1">{$t('stats.period.label')}</span>
  {#each statisticsRangeTemplates as tpl (tpl)}
    {@const active = $lastStatisticsRangeTemplate$ === tpl}
    <button
      type="button"
      class="chip"
      class:active
      title={$t(HINT_KEY[tpl])}
      on:click={() => pick(tpl)}
    >
      {$t(LABEL_KEY[tpl])}
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
