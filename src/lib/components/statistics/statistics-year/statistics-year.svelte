<script lang="ts">
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import { database, startDayHoursForTracker$ } from '$lib/data/store';
  import { toTimeString } from '$lib/functions/statistic-util';
  import {
    computeYearSummary,
    type YearSummary
  } from '$lib/components/statistics/statistics-year/year-summary';

  const monthLabels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  const today = new Date();
  let year = today.getFullYear();
  let summary: YearSummary | null = null;
  let loading = true;

  onMount(() => {
    load();
    const sub = database.sessionsChanged$.subscribe(() => load());
    const sub2 = database.statisticsChanged$.subscribe(() => load());
    return () => {
      sub.unsubscribe();
      sub2.unsubscribe();
    };
  });

  async function load() {
    loading = true;
    try {
      const startKey = `${year}-01-01`;
      const endKey = `${year}-12-31`;
      const [statistics, sessions] = await Promise.all([
        database.getStatisticsForTimeWindow(startKey, endKey),
        database.getSessionsForRange(startKey, endKey)
      ]);
      summary = computeYearSummary({
        year,
        startDayHours: $startDayHoursForTracker$,
        statistics,
        sessions
      });
    } finally {
      loading = false;
    }
  }

  function shift(delta: number) {
    year += delta;
    load();
  }

  function h(seconds: number): string {
    if (!seconds) return '0';
    const h1 = seconds / 3600;
    if (h1 >= 100) return `${Math.round(h1)}`;
    if (h1 >= 10) return h1.toFixed(1);
    return h1.toFixed(2);
  }

  $: monthlyMax = summary
    ? Math.max(1, ...summary.monthly.map((m) => m.seconds))
    : 1;

  $: hourMax =
    summary?.sessionStats
      ? Math.max(1, ...summary.sessionStats.hourHistogram)
      : 1;
</script>

<div class="pb-16">
  <header class="flex items-center justify-between py-6">
    <button class="picker-btn" on:click={() => shift(-1)} title="上一年">
      <Fa icon={faChevronLeft} />
    </button>
    <div class="year-title">{year} 年度回顾</div>
    <button
      class="picker-btn"
      on:click={() => shift(1)}
      disabled={year >= today.getFullYear()}
      title="下一年"
    >
      <Fa icon={faChevronRight} />
    </button>
  </header>

  {#if loading}
    <div class="py-16 text-center opacity-60">加载中…</div>
  {:else if !summary || (summary.totalSeconds === 0 && !summary.sessionStats)}
    <div class="py-16 text-center opacity-60">
      {year} 年还没有阅读记录。
    </div>
  {:else}
    <!-- HERO -->
    <section class="hero">
      <div class="hero-cell">
        <div class="hero-num">{h(summary.totalSeconds)}</div>
        <div class="hero-label">小时</div>
      </div>
      <div class="hero-cell">
        <div class="hero-num">{summary.activeDays}</div>
        <div class="hero-label">阅读天数</div>
      </div>
      <div class="hero-cell">
        <div class="hero-num">{summary.completedBooks}</div>
        <div class="hero-label">完成书数</div>
      </div>
      <div class="hero-cell">
        <div class="hero-num">
          {(summary.totalChars / 10000).toFixed(1)}<span class="hero-unit">万</span>
        </div>
        <div class="hero-label">字数</div>
      </div>
    </section>

    <!-- MONTHLY BARS -->
    <section class="card">
      <div class="card-title">月度节奏</div>
      <div class="bars">
        {#each summary.monthly as m (m.month)}
          {@const pct = Math.round((m.seconds / monthlyMax) * 100)}
          <div class="bar-col" title={`${monthLabels[m.month - 1]}: ${toTimeString(m.seconds)} · ${m.activeDays} 天`}>
            <div class="bar-fill" style="height: {pct}%;"></div>
            <div class="bar-label">{monthLabels[m.month - 1]}</div>
          </div>
        {/each}
      </div>
    </section>

    <!-- STREAK / BEST / FIRST / LAST -->
    <section class="grid-2">
      {#if summary.longestStreak}
        <div class="card">
          <div class="card-title">最长连续</div>
          <div class="big-num">{summary.longestStreak.length} <span class="unit">天</span></div>
          <div class="sub">
            {summary.longestStreak.startDateKey} — {summary.longestStreak.endDateKey}
          </div>
        </div>
      {/if}
      {#if summary.bestDay}
        <div class="card">
          <div class="card-title">最强单日</div>
          <div class="big-num">{h(summary.bestDay.seconds)} <span class="unit">小时</span></div>
          <div class="sub">{summary.bestDay.dateKey}</div>
        </div>
      {/if}
      {#if summary.firstDay}
        <div class="card">
          <div class="card-title">开卷第一天</div>
          <div class="big-num small">{summary.firstDay.dateKey}</div>
          <div class="sub truncate" title={summary.firstDay.titles.join(', ')}>
            {summary.firstDay.titles.join('，')}
          </div>
        </div>
      {/if}
      {#if summary.lastDay}
        <div class="card">
          <div class="card-title">最近一次</div>
          <div class="big-num small">{summary.lastDay.dateKey}</div>
          <div class="sub truncate" title={summary.lastDay.titles.join(', ')}>
            {summary.lastDay.titles.join('，')}
          </div>
        </div>
      {/if}
    </section>

    <!-- TOP BOOKS -->
    {#if summary.topBooks.length}
      <section class="card">
        <div class="card-title">最投入的书 Top {summary.topBooks.length}</div>
        <ol class="top-list">
          {#each summary.topBooks as book, i (book.title)}
            {@const pct = Math.round((book.seconds / summary.topBooks[0].seconds) * 100)}
            <li>
              <div class="top-rank">{i + 1}</div>
              <div class="top-body">
                <div class="top-title" title={book.title}>{book.title}</div>
                <div class="top-bar-wrap">
                  <div class="top-bar-fill" style="width: {pct}%;"></div>
                </div>
                <div class="top-meta">
                  {h(book.seconds)} 小时 · {book.days} 天 · {(book.chars / 10000).toFixed(1)} 万字
                </div>
              </div>
            </li>
          {/each}
        </ol>
      </section>
    {/if}

    <!-- SESSION-DERIVED STATS -->
    {#if summary.sessionStats}
      <section class="card">
        <div class="card-title">阅读时段分布</div>
        <div class="sub -mt-1 mb-3">
          共 {summary.sessionStats.count} 次会话，中位时长 {toTimeString(summary.sessionStats.medianSeconds)}，最长 {toTimeString(summary.sessionStats.longestSeconds)}
        </div>
        <div class="hour-bars">
          {#each summary.sessionStats.hourHistogram as val, hour (hour)}
            {@const pct = Math.round((val / hourMax) * 100)}
            <div class="hour-col" title={`${hour}:00 · ${toTimeString(val)}`}>
              <div class="hour-fill" style="height: {pct}%;"></div>
              <div class="hour-label">{hour % 3 === 0 ? hour : ''}</div>
            </div>
          {/each}
        </div>
      </section>
    {:else if summary.totalSeconds > 0}
      <div class="hint">
        小时分布与会话时长需要新的 session 数据 —— 从这次更新之后的阅读开始会积累。
      </div>
    {/if}
  {/if}
</div>

<style>
  .picker-btn {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--fg-dim, currentColor);
    border-radius: 0.5rem;
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0.75;
  }
  .picker-btn:hover:not(:disabled) {
    opacity: 1;
    background: color-mix(in srgb, var(--accent-color, #5f7e7b) 12%, transparent);
  }
  .picker-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .year-title {
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .hero {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  @media (min-width: 640px) {
    .hero {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .hero-cell {
    padding: 1rem 1.25rem;
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--accent-color, #5f7e7b) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-color, #5f7e7b) 25%, transparent);
  }
  .hero-num {
    font-size: 2rem;
    font-weight: 700;
    line-height: 1;
    color: var(--accent-color, #5f7e7b);
  }
  .hero-unit {
    font-size: 1rem;
    font-weight: 500;
    margin-left: 0.1rem;
    opacity: 0.7;
  }
  .hero-label {
    margin-top: 0.35rem;
    font-size: 0.75rem;
    opacity: 0.7;
  }
  .card {
    padding: 1rem 1.25rem;
    border-radius: 0.75rem;
    border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    background: color-mix(in srgb, currentColor 3%, transparent);
    margin-bottom: 1rem;
  }
  .card-title {
    font-size: 0.85rem;
    font-weight: 600;
    opacity: 0.85;
    margin-bottom: 0.75rem;
  }
  .grid-2 {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  @media (min-width: 640px) {
    .grid-2 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .grid-2 .card {
    margin-bottom: 0;
  }
  .big-num {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--accent-color, #5f7e7b);
    line-height: 1.1;
  }
  .big-num.small {
    font-size: 1.15rem;
  }
  .unit {
    font-size: 0.9rem;
    font-weight: 500;
    opacity: 0.7;
    margin-left: 0.15rem;
  }
  .sub {
    margin-top: 0.35rem;
    font-size: 0.75rem;
    opacity: 0.65;
  }
  .truncate {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 0.35rem;
    height: 8rem;
  }
  .bar-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    height: 100%;
  }
  .bar-fill {
    width: 100%;
    min-height: 2px;
    background: var(--accent-color, #5f7e7b);
    border-radius: 0.2rem 0.2rem 0 0;
    transition: height 0.2s;
  }
  .bar-label {
    margin-top: 0.4rem;
    font-size: 0.65rem;
    opacity: 0.6;
  }
  .top-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .top-list li {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
  .top-rank {
    flex-shrink: 0;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent-color, #5f7e7b) 20%, transparent);
    color: var(--accent-color, #5f7e7b);
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
  }
  .top-body {
    flex: 1;
    min-width: 0;
  }
  .top-title {
    font-size: 0.9rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .top-bar-wrap {
    margin-top: 0.25rem;
    height: 0.35rem;
    border-radius: 0.2rem;
    background: color-mix(in srgb, currentColor 8%, transparent);
    overflow: hidden;
  }
  .top-bar-fill {
    height: 100%;
    background: var(--accent-color, #5f7e7b);
    transition: width 0.2s;
  }
  .top-meta {
    margin-top: 0.25rem;
    font-size: 0.7rem;
    opacity: 0.65;
  }
  .hour-bars {
    display: flex;
    align-items: flex-end;
    gap: 0.15rem;
    height: 6rem;
  }
  .hour-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    height: 100%;
  }
  .hour-fill {
    width: 100%;
    min-height: 1px;
    background: var(--accent-color, #5f7e7b);
    border-radius: 0.15rem 0.15rem 0 0;
  }
  .hour-label {
    margin-top: 0.25rem;
    font-size: 0.6rem;
    opacity: 0.55;
    height: 0.75rem;
  }
  .hint {
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background: color-mix(in srgb, currentColor 5%, transparent);
    font-size: 0.75rem;
    opacity: 0.75;
    border-left: 3px solid var(--accent-color, #5f7e7b);
  }
</style>
