<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount, onDestroy } from 'svelte';
  import Fa from 'svelte-fa';
  import { faTimes, faKeyboard } from '@fortawesome/free-solid-svg-icons';
  import { bookReaderKeybindMap$, ttsShortcut$ } from '$lib/data/store';
  import { BookReaderAvailableKeybind } from '$lib/data/book-reader-keybind';

  const ACTION_LABELS: Record<BookReaderAvailableKeybind, string> = {
    [BookReaderAvailableKeybind.AUTO_SCROLL_TOGGLE]: '播放 / 暂停（滚动模式自动播放）',
    [BookReaderAvailableKeybind.AUTO_SCROLL_INCREASE]: '加快自动滚动速度',
    [BookReaderAvailableKeybind.AUTO_SCROLL_DECREASE]: '降低自动滚动速度',
    [BookReaderAvailableKeybind.AUTO_READER_TOGGLE]: '播放 / 暂停（分页模式 TTS 朗读）',
    [BookReaderAvailableKeybind.BOOKMARK]: '设置书签',
    [BookReaderAvailableKeybind.JUMP_TO_BOOKMARK]: '跳到书签',
    [BookReaderAvailableKeybind.NEXT_CHAPTER]: '下一章',
    [BookReaderAvailableKeybind.NEXT_PAGE]: '下一页',
    [BookReaderAvailableKeybind.PREV_CHAPTER]: '上一章',
    [BookReaderAvailableKeybind.PREV_PAGE]: '上一页',
    [BookReaderAvailableKeybind.SET_READING_POINT]: '设置自定义阅读点',
    [BookReaderAvailableKeybind.TOGGLE_TRACKING]: '统计开关',
    [BookReaderAvailableKeybind.TOGGLE_TRACKING_FREEZE]: '统计暂停 / 继续'
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
  $: rows = (() => {
    const byAction = new Map<BookReaderAvailableKeybind, Set<string>>();
    for (const [code, action] of Object.entries($bookReaderKeybindMap$)) {
      const keys = byAction.get(action) || new Set<string>();
      keys.add(pretty(code));
      byAction.set(action, keys);
    }
    return Array.from(byAction.entries())
      .map(([action, keys]) => ({
        action,
        label: ACTION_LABELS[action] || action,
        keys: Array.from(keys).filter((k, i, arr) => arr.indexOf(k) === i)
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh'));
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
  title="显示键盘快捷键（?）"
  aria-label="键盘快捷键"
  on:click={open}
>
  <Fa icon={faKeyboard} />
</button>

{#if visible}
  <div class="overlay" on:click={close} on:keyup={() => {}} role="presentation"></div>
  <div class="panel" role="dialog" aria-label="键盘快捷键">
    <div class="head">
      <h2><Fa icon={faKeyboard} class="mr-2" /> 键盘快捷键</h2>
      <button class="close" on:click={close} title="关闭（Esc）"><Fa icon={faTimes} /></button>
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
              <td class="action">TTS 朗读全局开关</td>
              <td class="keys">
                {#each $ttsShortcut$.split('+') as k (k)}
                  <kbd>{k.toUpperCase()}</kbd>
                {/each}
              </td>
            </tr>
          {/if}
          <tr>
            <td class="action">本面板开 / 关</td>
            <td class="keys"><kbd>?</kbd></td>
          </tr>
        </tbody>
      </table>
      <p class="hint">按 <kbd>Esc</kbd> 关闭。绑定可在「设置 → 阅读」里调整。</p>
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
