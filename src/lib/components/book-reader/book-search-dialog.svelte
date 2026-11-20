<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import { buttonClasses, inputClasses } from '$lib/css-classes';
  import { t } from '$lib/i18n';
  import { searchBook, type SearchBlock, type SearchHit } from '$lib/functions/book-search';
  import { isCountedCharacter } from '$lib/functions/get-character-count';

  export let blocks: SearchBlock[];
  export let totalChars: number;
  export let initialQuery = '';
  export let resolver: (result: { pos: number; query: string } | undefined) => void;

  const LIMIT = 200;
  const dispatch = createEventDispatcher<{ close: void }>();

  let query = initialQuery;
  let hits: SearchHit[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inputEl: HTMLInputElement;

  // A whole novel is a few hundred thousand characters; scanning it is cheap,
  // but not on every keystroke of an IME composition.
  $: {
    if (timer) clearTimeout(timer);
    const q = query;
    timer = setTimeout(() => (hits = searchBook(blocks, q, isCountedCharacter, LIMIT)), 150);
  }

  onMount(() => {
    inputEl?.focus();
    inputEl?.select();
  });

  function close(hit?: SearchHit) {
    if (timer) clearTimeout(timer);
    resolver(hit ? { pos: hit.pos, query } : undefined);
    dispatch('close');
  }

  function pct(pos: number) {
    return totalChars > 0 ? ((pos / totalChars) * 100).toFixed(1) : '0';
  }
</script>

<DialogTemplate>
  <svelte:fragment slot="header">{$t('bookSearch.title')}</svelte:fragment>
  <div class="flex w-[min(36rem,80vw)] flex-col gap-3 text-sm sm:text-base" slot="content">
    <input
      bind:this={inputEl}
      bind:value={query}
      class={inputClasses}
      placeholder={$t('bookSearch.placeholder')}
      on:keydown={(evt) => {
        if (evt.key === 'Enter' && !evt.isComposing && hits.length === 1) close(hits[0]);
        else if (evt.key === 'Escape') close();
      }}
    />
    {#if query.trim()}
      <div class="text-xs opacity-60">
        {hits.length >= LIMIT
          ? $t('bookSearch.countCapped', { n: LIMIT })
          : $t('bookSearch.count', { n: hits.length })}
      </div>
    {/if}
    <ul class="flex flex-col">
      {#each hits as hit (hit.pos)}
        <li>
          <button
            type="button"
            class="hover-soft flex w-full items-baseline gap-3 rounded px-2 py-1.5 text-left"
            on:click={() => close(hit)}
          >
            <span class="w-12 shrink-0 text-right text-xs tabular-nums opacity-50">{pct(hit.pos)}%</span>
            <span class="min-w-0 flex-1"
              >{hit.before}<mark
                class="rounded px-0.5 font-semibold"
                style="color:inherit;background:color-mix(in srgb, currentColor 18%, transparent);"
                >{hit.match}</mark
              >{hit.after}</span
            >
          </button>
        </li>
      {/each}
    </ul>
  </div>
  <div class="flex grow justify-end" slot="footer">
    <button class={buttonClasses} on:click={() => close()}>{$t('dialog.cancel')}</button>
  </div>
</DialogTemplate>
