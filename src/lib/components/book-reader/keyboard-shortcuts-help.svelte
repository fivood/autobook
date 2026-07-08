<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount, onDestroy } from 'svelte';
  import Fa from 'svelte-fa';
  import { faTimes, faKeyboard } from '@fortawesome/free-solid-svg-icons';
  import { bookReaderKeybindMap$, ttsShortcut$ } from '$lib/data/store';
  import { BookReaderAvailableKeybind } from '$lib/data/book-reader-keybind';
  import { t, locale$ } from '$lib/i18n';

  // Maps each keybind to its i18n key. The concrete label is resolved
  // reactively via $t inside the row builder so a locale switch redraws.
  const ACTION_LABEL_KEYS: Record<BookReaderAvailableKeybind, string> = {
    [BookReaderAvailableKeybind.AUTO_SCROLL_TOGGLE]: 'shortcuts.action.autoScrollToggle',
    [BookReaderAvailableKeybind.AUTO_SCROLL_INCREASE]: 'shortcuts.action.autoScrollIncrease',
    [BookReaderAvailableKeybind.AUTO_SCROLL_DECREASE]: 'shortcuts.action.autoScrollDecrease',
    [BookReaderAvailableKeybind.AUTO_READER_TOGGLE]: 'shortcuts.action.autoReaderToggle',
    [BookReaderAvailableKeybind.BOOKMARK]: 'shortcuts.action.bookmark',
    [BookReaderAvailableKeybind.JUMP_TO_BOOKMARK]: 'shortcuts.action.jumpToBookmark',
    [BookReaderAvailableKeybind.NEXT_CHAPTER]: 'shortcuts.action.nextChapter',
    [BookReaderAvailableKeybind.NEXT_PAGE]: 'shortcuts.action.nextPage',
    [BookReaderAvailableKeybind.PREV_CHAPTER]: 'shortcuts.action.prevChapter',
    [BookReaderAvailableKeybind.PREV_PAGE]: 'shortcuts.action.prevPage',
    [BookReaderAvailableKeybind.SET_READING_POINT]: 'shortcuts.action.setReadingPoint',
    [BookReaderAvailableKeybind.TOGGLE_TRACKING]: 'shortcuts.action.toggleTracking',
    [BookReaderAvailableKeybind.TOGGLE_TRACKING_FREEZE]: 'shortcuts.action.toggleTrackingFreeze'
  };

  // Pretty-print a key code returned by KeyboardEvent.code or .key.
  function pretty(code: string): string {
    if (code === ' ') return 'Space';
    if (code === 'pagedown' || code === 'pageup') return code === 'pagedown' ? 'PgDn' : 'PgUp';
    if (code === 'PageDown') return 'PgDn';
    if (code === 'PageUp') return 'PgUp';
    if (code === 'Space') return 'Space';
    if (code.startsWith('Key')) return code.slice(3);
    return code.toUpperCase();
  }

  let visible = false;

  // Group binds by action so the same action's multiple key codes (case
  // variants like KeyB + b) collapse into a single row.
  // Depend on $locale$ so a locale switch re-runs the sort with the new
  // labels; without this the initial ordering (built when the component
  // first rendered) would stay pinned to the original locale.
  $: rows = (() => {
    void $locale$;
    const byAction = new Map<BookReaderAvailableKeybind, Set<string>>();
    for (const [code, action] of Object.entries($bookReaderKeybindMap$)) {
      const keys = byAction.get(action) || new Set<string>();
      keys.add(pretty(code));
      byAction.set(action, keys);
    }
    return Array.from(byAction.entries())
      .map(([action, keys]) => ({
        action,
        label: $t(ACTION_LABEL_KEYS[action] || action),
        keys: Array.from(keys).filter((k, i, arr) => arr.indexOf(k) === i)
      }))
      .sort((a, b) => a.label.localeCompare(b.label, $locale$));
  })();

  function open() {
    visible = true;
  }
  function close() {
    visible = false;
  }
  function onKeydown(e: KeyboardEvent) {
    // ? key (Shift + /) — but only when not typing in an input
    const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) {
      return;
    }
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      visible = !visible;
    } else if (e.key === 'Escape' && visible) {
      e.preventDefault();
      close();
    }
  }

  onMount(() => {
    if (!browser) return;
    document.addEventListener('keydown', onKeydown);
  });
  onDestroy(() => {
    if (!browser) return;
    document.removeEventListener('keydown', onKeydown);
  });
</script>

<button
  class="trigger"
  title={$t('shortcuts.trigger')}
  aria-label={$t('shortcuts.triggerAria')}
  on:click={open}
>
  <Fa icon={faKeyboard} />
</button>

{#if visible}
  <div class="overlay" on:click={close} on:keyup={() => {}} role="presentation"></div>
  <div class="panel" role="dialog" aria-label={$t('shortcuts.triggerAria')}>
    <div class="head">
      <h2><Fa icon={faKeyboard} class="mr-2" /> {$t('shortcuts.title')}</h2>
      <button class="close" on:click={close} title={$t('shortcuts.close')}><Fa icon={faTimes} /></button>
    </div>
    <div class="body">
      <table>
        <tbody>
          {#each rows as r (r.action)}
            <tr>
              <td class="action">{r.label}</td>
              <td class="keys">
                {#each r.keys as k (k)}
                  <kbd>{k}</kbd>
                {/each}
              </td>
            </tr>
          {/each}
          {#if $ttsShortcut$}
            <tr>
              <td class="action">{$t('shortcuts.tts.action')}</td>
              <td class="keys">
                {#each $ttsShortcut$.split('+') as k (k)}
                  <kbd>{k.toUpperCase()}</kbd>
                {/each}
              </td>
            </tr>
          {/if}
          <tr>
            <td class="action">{$t('shortcuts.panel.action')}</td>
            <td class="keys"><kbd>?</kbd></td>
          </tr>
        </tbody>
      </table>
      <p class="hint">{$t('shortcuts.hintPrefix')}<kbd>Esc</kbd>{$t('shortcuts.hintSuffix')}</p>
    </div>
  </div>
{/if}

<style>
  /* Stacks on top of BookImageZoom on the left rail when both visible;
     otherwise sits alone at the bottom-left corner. The right side is
     reserved for play controls. */
  .trigger {
    position: fixed;
    left: env(safe-area-inset-left, 0.6rem);
    bottom: calc(env(safe-area-inset-bottom, 0.6rem) + 3.2rem);
    z-index: 20;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: var(--menu-background, rgba(0, 0, 0, 0.55));
    color: var(--menu-foreground, #fff);
    border-radius: 999px;
    opacity: 0.22;
    cursor: pointer;
    font-size: 0.85rem;
    transition: opacity 0.3s ease;
  }
  .trigger:hover {
    opacity: 1;
  }
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 40;
  }
  .panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 50;
    width: min(560px, 92vw);
    max-height: 80vh;
    overflow: auto;
    background: var(--background-color, #fff);
    color: var(--font-color, #111);
    border-radius: 0.6rem;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.9rem 1rem;
    border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  }
  .head h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin: 0;
  }
  .close {
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    padding: 0.3rem 0.5rem;
    opacity: 0.7;
  }
  .close:hover {
    opacity: 1;
  }
  .body {
    padding: 0.5rem 0.5rem 1rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  td {
    padding: 0.45rem 0.7rem;
    vertical-align: top;
    border-bottom: 1px solid color-mix(in srgb, currentColor 8%, transparent);
    font-size: 0.85rem;
  }
  td.action {
    width: 65%;
  }
  td.keys {
    text-align: right;
    white-space: nowrap;
  }
  kbd {
    display: inline-block;
    padding: 0.1rem 0.45rem;
    margin-left: 0.25rem;
    background: color-mix(in srgb, currentColor 12%, transparent);
    border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
    border-radius: 0.3rem;
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    line-height: 1.2;
  }
  .hint {
    margin: 0.75rem 0.7rem 0;
    font-size: 0.72rem;
    opacity: 0.6;
  }
</style>
