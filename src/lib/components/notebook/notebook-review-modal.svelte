<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';
  import { t } from '$lib/i18n';
  import { faChevronRight, faCheck, faTimes } from '@fortawesome/free-solid-svg-icons';
  import type { BooksDbHighlight } from '$lib/data/database/books-db/versions/books-db';

  export let queue: BooksDbHighlight[] = [];

  const dispatch = createEventDispatcher<{
    markReviewed: number;
    close: void;
  }>();

  let idx = 0;
  $: current = queue[idx];

  function next() {
    if (idx < queue.length - 1) idx += 1;
    else dispatch('close');
  }

  function markAndNext() {
    if (current) dispatch('markReviewed', current.id);
    next();
  }

  function handleKeydown(ev: KeyboardEvent) {
    if (!current) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      markAndNext();
    } else if (ev.key === 'ArrowRight' || ev.key === ' ') {
      ev.preventDefault();
      next();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      dispatch('close');
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="fixed inset-0 z-[90] flex items-center justify-center bg-black/60"
  on:click|self={() => dispatch('close')}
>
  <div
    class="flex w-full max-w-xl flex-col rounded-lg p-6 shadow-xl"
    style="background:var(--background-color,#fff);color:var(--font-color,#333);"
  >
    <div class="mb-3 flex items-baseline justify-between">
      <h3 class="text-lg font-medium">{$t('notebook.review.title')}</h3>
      <span class="text-sm text-muted">{idx + 1} / {queue.length}</span>
    </div>
    {#if !current}
      <p class="py-8 text-center text-muted">{$t('notebook.reviewEmpty')}</p>
    {:else}
      <p class="mb-2 text-xs text-muted">{current.bookTitle || $t('notebook.standalone')}</p>
      <div class="mb-4 max-h-[50vh] overflow-y-auto rounded border border-current/10 p-4">
        {#if current.kind === 'note'}
          <p class="whitespace-pre-wrap break-words text-base leading-relaxed">{current.memo}</p>
        {:else}
          <p class="whitespace-pre-wrap break-words text-base leading-relaxed">{current.text}</p>
          {#if current.memo}
            <p class="mt-3 whitespace-pre-wrap break-words rounded bg-current/5 px-3 py-2 text-sm italic opacity-80">📝 {current.memo}</p>
          {/if}
        {/if}
        {#if current.tags && current.tags.length}
          <div class="mt-3 flex flex-wrap gap-1">
            {#each current.tags as tag (tag)}
              <span class="rounded-full border border-current/20 px-2 py-0.5 text-xs opacity-70">#{tag}</span>
            {/each}
          </div>
        {/if}
      </div>
      <p class="mb-2 text-right text-xs text-muted">{$t('notebook.review.keys')}</p>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="flex items-center gap-1 rounded border border-current/20 px-4 py-1.5 text-sm hover-soft"
          title={$t('notebook.review.skipTitle')}
          on:click={next}
        ><Fa icon={faTimes} size="xs" /> {$t('notebook.review.skip')}</button>
        <button
          type="button"
          class="flex items-center gap-1 rounded px-4 py-1.5 text-sm font-medium"
          style="background:var(--menu-background);color:var(--menu-foreground);"
          title={$t('notebook.review.doneTitle')}
          on:click={markAndNext}
        ><Fa icon={faCheck} size="xs" /> {$t('notebook.review.done')} <Fa icon={faChevronRight} size="xs" /></button>
      </div>
    {/if}
  </div>
</div>
