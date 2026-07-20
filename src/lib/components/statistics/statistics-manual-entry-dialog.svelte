<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import { buttonClasses, inputClasses } from '$lib/css-classes';
  import { getDateString, getStartHoursDate } from '$lib/functions/statistic-util';
  import type { ManualStatisticEntry } from '$lib/components/statistics/statistics-types';
  import { createEventDispatcher, tick } from 'svelte';

  export let existingTitles: string[] = [];
  export let startDayHoursForTracker = 0;
  export let resolver: (value: ManualStatisticEntry | undefined) => void;

  const dispatch = createEventDispatcher<{ close: void }>();

  const todayKey = getDateString(getStartHoursDate(startDayHoursForTracker));

  let title = '';
  let dateKey = todayKey;
  let minutes: number | null = null;
  let characters: number | null = 0;
  let markCompleted = false;
  let conflictStrategy: 'append' | 'overwrite' = 'append';
  let error = '';
  let titleInputEl: HTMLInputElement | undefined;

  $: trimmedTitle = title.trim();
  $: hasConflict = !!trimmedTitle && existingTitles.includes(`${trimmedTitle}__${dateKey}`);

  tick().then(() => titleInputEl?.focus());

  function close(result?: ManualStatisticEntry) {
    resolver(result);
    dispatch('close');
  }

  function submit() {
    if (!trimmedTitle) {
      error = '请输入书名';
      return;
    }
    if (!dateKey) {
      error = '请选择日期';
      return;
    }
    if (dateKey > todayKey) {
      error = '日期不能晚于今天';
      return;
    }
    const readingTimeSeconds = Math.max(0, Math.round(((minutes ?? 0) as number) * 60));
    if (readingTimeSeconds <= 0) {
      error = '请输入阅读时长（分钟）';
      return;
    }
    const charactersRead = Math.max(0, Math.floor((characters ?? 0) as number));

    close({
      title: trimmedTitle,
      dateKey,
      readingTimeSeconds,
      charactersRead,
      markCompleted,
      conflictStrategy
    });
  }
</script>

<DialogTemplate>
  <svelte:fragment slot="header">手动添加阅读记录</svelte:fragment>
  <div class="flex flex-col gap-3 text-sm sm:text-base w-72 sm:w-96" slot="content">
    <label class="flex flex-col">
      <span class="text-xs opacity-70">书名（纸质书可自定义）</span>
      <input
        type="text"
        class={inputClasses}
        bind:value={title}
        bind:this={titleInputEl}
        list="manual-existing-titles"
        placeholder="例如：三体（纸质）"
      />
      <datalist id="manual-existing-titles">
        {#each Array.from(new Set(existingTitles.map((k) => k.split('__')[0]))) as t (t)}
          <option value={t} />
        {/each}
      </datalist>
    </label>

    <label class="flex flex-col">
      <span class="text-xs opacity-70">日期</span>
      <input type="date" class={inputClasses} max={todayKey} bind:value={dateKey} />
    </label>

    <div class="flex gap-3">
      <label class="flex flex-col flex-1">
        <span class="text-xs opacity-70">时长（分钟）</span>
        <input
          type="number"
          min="0"
          step="1"
          class={inputClasses}
          bind:value={minutes}
          placeholder="30"
        />
      </label>
      <label class="flex flex-col flex-1">
        <span class="text-xs opacity-70">字数（可留空）</span>
        <input
          type="number"
          min="0"
          step="1"
          class={inputClasses}
          bind:value={characters}
          placeholder="0"
        />
      </label>
    </div>

    <label class="flex items-center gap-2 mt-1">
      <input type="checkbox" bind:checked={markCompleted} />
      <span>标记为读完</span>
    </label>

    {#if hasConflict}
      <div class="mt-2 border border-yellow-500/60 rounded p-2 text-xs">
        <div class="mb-1 font-medium text-yellow-600">
          该书籍在 {dateKey} 已有一条记录：
        </div>
        <label class="flex items-center gap-2">
          <input type="radio" bind:group={conflictStrategy} value="append" />
          <span>追加到已有记录（时长与字数相加）</span>
        </label>
        <label class="flex items-center gap-2">
          <input type="radio" bind:group={conflictStrategy} value="overwrite" />
          <span>覆盖已有记录</span>
        </label>
      </div>
    {/if}

    {#if error}
      <div class="text-red-500 text-xs">{error}</div>
    {/if}
  </div>
  <div class="flex grow justify-between" slot="footer">
    <button class={buttonClasses} on:click={() => close(undefined)}>
      取消
      <Ripple />
    </button>
    <button class={buttonClasses} on:click={submit}>
      添加
      <Ripple />
    </button>
  </div>
</DialogTemplate>
