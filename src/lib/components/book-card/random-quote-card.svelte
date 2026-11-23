<script context="module" lang="ts">
  import type { RandomQuote } from '$lib/functions/random-quote-loader';

  // Module-level so leaving for a book and coming back keeps the same quote
  // instead of re-parsing a whole book on every library visit.
  let cached: RandomQuote | undefined;
</script>

<script lang="ts">
  import type { BookCardId } from '$lib/data/book-id';
  import type { StorageKey } from '$lib/data/storage/storage-types';
  import { t } from '$lib/i18n';
  import { loadRandomQuote, type QuoteCandidate } from '$lib/functions/random-quote-loader';
  import { faShuffle } from '@fortawesome/free-solid-svg-icons';
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';

  /** Never-opened books to draw from. */
  export let candidates: QuoteCandidate[];
  export let storageSource: StorageKey;

  const dispatch = createEventDispatcher<{ open: { id: BookCardId; pos: number } }>();

  let quote = cached;
  let loading = false;

  $: if (!quote && !loading && candidates.length) refresh();
  // The cached quote's book was opened, archived or removed since.
  $: if (quote && candidates.length && !candidates.some((c) => c.title === quote?.title)) {
    quote = cached = undefined;
  }

  async function refresh() {
    loading = true;
    try {
      const others = candidates.filter((c) => c.title !== quote?.title);
      quote = cached = await loadRandomQuote(others.length ? others : candidates, storageSource);
    } catch (err) {
      // Best-effort decoration on the library page: a book that will not load
      // should not put an error dialog in front of the shelf.
      console.warn('random quote failed', err);
    } finally {
      loading = false;
    }
  }
</script>

{#if quote}
  <div class="mb-4 flex items-start gap-2 rounded-lg border border-current/20 px-4 py-3">
    <button
      type="button"
      class="flex-1 rounded text-left hover-soft"
      title={$t('library.quote.open', { title: quote.title })}
      on:click={() => quote && dispatch('open', { id: quote.id, pos: quote.pos })}
    >
      <p class="quote-text leading-relaxed">{quote.text}</p>
      <p class="mt-1 text-right text-sm opacity-60">——《{quote.title}》</p>
    </button>
    <button
      type="button"
      class="shrink-0 rounded p-2 opacity-60 hover:opacity-100 hover-soft"
      title={$t('library.quote.shuffle')}
      aria-label={$t('library.quote.shuffle')}
      disabled={loading}
      on:click={refresh}
    >
      <Fa icon={faShuffle} spin={loading} />
    </button>
  </div>
{/if}

<style>
  .quote-text {
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
