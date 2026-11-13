<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount, onDestroy } from 'svelte';
  import Fa from 'svelte-fa';
  import { faTimes, faKeyboard } from '@fortawesome/free-solid-svg-icons';
  import { bookReaderKeybindMap$, ttsShortcut$ } from '$lib/data/store';
  import { BookReaderAvailableKeybind } from '$lib/data/book-reader-keybind';
  import { isTypingTarget } from '$lib/functions/is-typing-target';
  import { t } from '$lib/i18n';

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

  const A = BookReaderAvailableKeybind;
  /**
   * Fixed groups in a fixed order. The rows used to be sorted by label, which
   * put 上一页 and 下一页 seven rows apart (and 上一章 N / 下一章 M too) — the
   * pairs you look for together were the ones the sort split up.
   */
  const GROUPS: { titleKey: string; actions: BookReaderAvailableKeybind[] }[] = [
    { titleKey: 'shortcuts.group.move', actions: [A.PREV_PAGE, A.NEXT_PAGE, A.PREV_CHAPTER, A.NEXT_CHAPTER] },
    {
      titleKey: 'shortcuts.group.play',
      actions: [A.AUTO_READER_TOGGLE, A.AUTO_SCROLL_TOGGLE, A.AUTO_SCROLL_INCREASE, A.AUTO_SCROLL_DECREASE]
    },
    { titleKey: 'shortcuts.group.place', actions: [A.BOOKMARK, A.JUMP_TO_BOOKMARK, A.SET_READING_POINT] },
    { titleKey: 'shortcuts.group.timer', actions: [A.TOGGLE_TRACKING, A.TOGGLE_TRACKING_FREEZE] }
  ];

  // Same action's key codes (KeyB + b) collapse into one row.
  $: keysByAction = (() => {
    const byAction = new Map<BookReaderAvailableKeybind, string[]>();
    for (const [code, action] of Object.entries($bookReaderKeybindMap$)) {
      const keys = byAction.get(action) || [];
      const key = pretty(code);
      if (!keys.includes(key)) keys.push(key);
      byAction.set(action, keys);
    }
    return byAction;
  })();

  function open() {
    visible = true;
  }
  function close() {
    visible = false;
  }
  function onKeydown(e: KeyboardEvent) {
    if (isTypingTarget(e.target)) return;
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
        {#each GROUPS as group (group.titleKey)}
          <tbody>
            <tr><th colspan="2">{$t(group.titleKey)}</th></tr>
            {#each group.actions.filter((action) => keysByAction.has(action)) as action (action)}
              <tr>
                <td class="action">{$t(ACTION_LABEL_KEYS[action])}</td>
                <td class="keys">
                  {#each keysByAction.get(action) || [] as k (k)}
                    <kbd>{k}</kbd>
                  {/each}
                </td>
              </tr>
            {/each}
            {#if group.titleKey === 'shortcuts.group.move'}
              <!-- Fixed keys from book-reader-paginated, not remappable. -->
              <tr>
                <td class="action">{$t('shortcuts.arrows.action')}</td>
                <td class="keys"><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd></td>
              </tr>
            {/if}
          </tbody>
        {/each}
        <tbody>
          <tr><th colspan="2">{$t('shortcuts.group.view')}</th></tr>
          <tr>
            <td class="action">{$t('shortcuts.search.action')}</td>
            <td class="keys"><kbd>Ctrl F</kbd></td>
          </tr>
          <tr>
            <td class="action">{$t('shortcuts.header.action')}</td>
            <td class="keys"><kbd>{$t('shortcuts.header.how')}</kbd></td>
          </tr>
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
          <!-- Zoom isn't in the remappable keybind map (it's modifier-based, and
               the reader's own handlers all bail on Ctrl), so it gets fixed rows
               here — otherwise nothing in the UI would ever mention it. -->
          <tr>
            <td class="action">{$t('shortcuts.zoom.action')}</td>
            <td class="keys">
              <kbd>{$t('shortcuts.zoom.wheel')}</kbd><kbd>Ctrl +</kbd><kbd>Ctrl -</kbd>
            </td>
          </tr>
          <tr>
            <td class="action">{$t('shortcuts.zoom.reset')}</td>
            <td class="keys"><kbd>Ctrl 0</kbd></td>
          </tr>
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
    /* Same env()-fallback trap as book-image-zoom (WebView2 reports 0px);
       stacked above the zoom pill, which sits above the bottom status bar. */
    left: max(env(safe-area-inset-left, 0px), 0.6rem);
    bottom: calc(env(safe-area-inset-bottom, 0px) + 5.4rem);
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
  th {
    padding: 0.9rem 0.25rem 0.3rem;
    text-align: left;
    font-size: 0.8rem;
    font-weight: 600;
    opacity: 0.65;
  }
  tbody:first-of-type th {
    padding-top: 0.2rem;
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
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.75rem;
    line-height: 1.2;
  }
  .hint {
    margin: 0.75rem 0.7rem 0;
    font-size: 0.75rem;
    color: var(--muted-text);
  }
</style>
