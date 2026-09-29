<script lang="ts">
  /**
   * Read-only memo shown next to its highlight on hover.
   *
   * Before this the only ways to read a memo were the edit dialog and the
   * sidebar, so an annotated passage looked exactly like an unannotated one
   * and you had to go looking. Clicking a mark is already taken (it opens the
   * edit menu), hence hover.
   *
   * Deliberately not interactive: no buttons, no selection, `pointer-events:
   * none`. That keeps it out of the way of the click target underneath and
   * means it never needs dismiss logic.
   */
  import { t } from '$lib/i18n';

  /** Viewport coordinates of the hovered mark. */
  export let anchor: { left: number; right: number; top: number; bottom: number } | undefined;
  export let memo = '';
  export let tags: string[] = [];

  const WIDTH = 260;
  const GAP = 8;

  /**
   * Placed against the viewport, since the card is fixed-position. Flips above
   * the mark when there isn't room below, and clamps horizontally so a
   * highlight near either edge still shows the whole card.
   */
  $: style = (() => {
    if (!anchor) return '';
    const vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const vh = typeof window === 'undefined' ? 768 : window.innerHeight;
    const left = Math.max(GAP, Math.min(anchor.left, vw - WIDTH - GAP));
    const below = anchor.bottom + GAP;
    // 160 is the max-height below; flipping on the estimate is enough because
    // the card scrolls internally rather than growing without bound.
    const flip = below + 160 > vh && anchor.top > 160;
    const top = flip ? Math.max(GAP, anchor.top - 160 - GAP) : below;
    return `left:${left}px; top:${top}px; width:${WIDTH}px;`;
  })();
</script>

{#if anchor && memo}
  <div class="memo-card" style={style} role="tooltip">
    <div class="memo-label">{$t('bookCard.memoLabel')}</div>
    <div class="memo-body">{memo}</div>
    {#if tags.length}
      <div class="memo-tags">
        {#each tags as tag (tag)}<span class="memo-tag">{tag}</span>{/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .memo-card {
    position: fixed;
    z-index: 70;
    max-height: 160px;
    overflow-y: auto;
    padding: 0.5rem 0.6rem;
    border-radius: 0.375rem;
    /* Menu palette: this floats over the reading surface and should read as
       chrome, not as part of the text. */
    background: var(--menu-background);
    color: var(--menu-foreground);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    font-size: 0.8rem;
    line-height: 1.5;
    /* Never intercept the click that opens the edit menu underneath. */
    pointer-events: none;
  }
  .memo-label {
    font-size: 0.65rem;
    letter-spacing: 0.04em;
    opacity: 0.6;
    margin-bottom: 0.15rem;
  }
  .memo-body {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .memo-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.35rem;
  }
  .memo-tag {
    padding: 0 0.3rem;
    border-radius: 999px;
    border: 1px solid currentColor;
    opacity: 0.7;
    font-size: 0.65rem;
  }
</style>
