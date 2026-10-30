<script lang="ts">
  import {
    StatisticsRangeTemplate,
    statisticsRangeTemplateLabelKey as LABEL_KEY,
    statisticsRangeTemplates
  } from '$lib/components/statistics/statistics-types';
  import { lastStatisticsRangeTemplate$ } from '$lib/data/store';
  import { t } from '$lib/i18n';

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
  <span class="text-xs text-muted mr-1">{$t('stats.period.label')}</span>
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
    /* 20% put the body text at 4.4:1 on its own wash. */
    background: color-mix(in srgb, var(--accent-color, #5f7e7b) 12%, transparent);
    border-color: var(--accent-color, #5f7e7b);
    /* Not the accent: no theme sets --accent-color, and it on its own 20%
       wash read 3.7:1. Weight and border carry the selection. */
    font-weight: 600;
  }
</style>
