<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import Fa from 'svelte-fa';
  import { faTimes, faPaperPlane, faStop, faTrash, faCog } from '@fortawesome/free-solid-svg-icons';
  import { fly } from 'svelte/transition';
  import { quintInOut } from 'svelte/easing';
  import { clickOutside } from '$lib/functions/use-click-outside';
  import { aiApiKey$, aiBaseUrl$, aiModel$, aiProvider$ } from '$lib/data/store';
  import { streamChat, type AiMessage, type AiProvider } from '$lib/data/ai/ai-client';
  import {
    buildBookTextIndex,
    retrieveSpoilerSafe,
    type BookTextIndex
  } from '$lib/data/ai/book-text-index';

  export let bookId: number;
  export let bookTitle: string;
  export let elementHtml: string;
  export let exploredCharCount: number;
  export let bookCharCount: number;

  interface UiMessage {
    role: 'user' | 'assistant';
    content: string;
    error?: boolean;
  }

  let messages: UiMessage[] = [];
  let input = '';
  let streaming = false;
  let abortCtrl: AbortController | undefined;
  let logEl: HTMLDivElement;
  let index: BookTextIndex | undefined;
  let showSettings = false;

  const dispatch = createEventDispatcher<{ close: void }>();

  $: index =
    elementHtml && bookId
      ? buildBookTextIndex(bookId, bookTitle, elementHtml)
      : undefined;

  $: hasConfig = !!$aiApiKey$ && !!$aiModel$;
  $: provider = ($aiProvider$ as AiProvider) || 'anthropic';

  async function scrollToBottom() {
    await tick();
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }

  function buildSystemPrompt(): string {
    return [
      `你是 AutoBook 的剧透安全阅读助手。`,
      `用户正在读《${bookTitle}》，目前的阅读进度约为 ${
        bookCharCount > 0 ? Math.round((exploredCharCount / bookCharCount) * 100) : 0
      }%。`,
      `严格规则：`,
      `1. 只能基于下方"已读片段"作答；绝对不能利用你的训练知识泄露本书后续情节、未读人物、未读伏笔答案。`,
      `2. 如果用户问的内容尚未在已读片段中出现，回答"目前还没读到，不能剧透"，不要编。`,
      `3. 名字/术语/伏笔讨论时，只描述已读片段里出现过的部分。`,
      `4. 中文回答，简洁、可引用具体段落。`
    ].join('\n');
  }

  function buildContextBlock(query: string): string {
    if (!index) return '';
    const { topChunks, recentTail } = retrieveSpoilerSafe(
      index,
      query,
      exploredCharCount,
      bookCharCount
    );
    const seen = new Set<number>();
    const collected: typeof topChunks = [];
    for (const c of [...recentTail, ...topChunks]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      collected.push(c);
    }
    collected.sort((a, b) => a.startChar - b.startChar);
    if (!collected.length) return '（已读片段为空）';
    const blocks = collected.map((c) => `--- chunk #${c.id} ---\n${c.text}`);
    return blocks.join('\n\n');
  }

  async function send() {
    const q = input.trim();
    if (!q || streaming) return;
    if (!hasConfig) {
      showSettings = true;
      return;
    }
    input = '';
    messages = [...messages, { role: 'user', content: q }];
    await scrollToBottom();

    const ctx = buildContextBlock(q);
    const sys = `${buildSystemPrompt()}\n\n已读片段（截至当前阅读位置）：\n${ctx}`;

    const apiMessages: AiMessage[] = messages.map(({ role, content }) => ({ role, content }));

    messages = [...messages, { role: 'assistant', content: '' }];
    streaming = true;
    abortCtrl = new AbortController();

    try {
      for await (const chunk of streamChat(
        {
          provider,
          apiKey: $aiApiKey$,
          baseUrl: $aiBaseUrl$,
          model: $aiModel$
        },
        {
          system: sys,
          messages: apiMessages,
          signal: abortCtrl.signal
        }
      )) {
        messages = messages.map((m, i) =>
          i === messages.length - 1 ? { ...m, content: m.content + chunk } : m
        );
        await scrollToBottom();
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // user-initiated stop
      } else {
        messages = messages.map((m, i) =>
          i === messages.length - 1
            ? { role: 'assistant', content: `[请求失败] ${err?.message || err}`, error: true }
            : m
        );
      }
    } finally {
      streaming = false;
      abortCtrl = undefined;
      await scrollToBottom();
    }
  }

  function stop() {
    abortCtrl?.abort();
  }

  function clearChat() {
    if (streaming) return;
    messages = [];
  }

  function handleKey(ev: KeyboardEvent) {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      send();
    }
  }

  function onProviderChange(ev: Event) {
    aiProvider$.next((ev.currentTarget as HTMLSelectElement).value);
  }
  function onKeyInput(ev: Event) {
    aiApiKey$.next((ev.currentTarget as HTMLInputElement).value);
  }
  function onBaseInput(ev: Event) {
    aiBaseUrl$.next((ev.currentTarget as HTMLInputElement).value);
  }
  function onModelInput(ev: Event) {
    aiModel$.next((ev.currentTarget as HTMLInputElement).value);
  }
</script>

<div
  class="fixed top-0 right-0 z-[80] flex h-full w-full max-w-md flex-col border-l border-current/10 shadow-2xl"
  style="color:var(--font-color);background:var(--background-color);"
  in:fly|local={{ x: 100, duration: 200, easing: quintInOut }}
  use:clickOutside={() => dispatch('close')}
>
  <div class="flex items-center gap-2 border-b border-current/10 px-4 py-3">
    <h2 class="text-lg font-medium">AI 助手</h2>
    <span class="text-xs opacity-50"
      >剧透安全 · 已读 {bookCharCount > 0
        ? Math.round((exploredCharCount / bookCharCount) * 100)
        : 0}%</span
    >
    <div class="flex-1" />
    <button
      type="button"
      class="rounded p-1.5 opacity-60 hover:bg-black/5 hover:opacity-100"
      title="设置"
      on:click={() => (showSettings = !showSettings)}
    ><Fa icon={faCog} size="xs" /></button>
    <button
      type="button"
      class="rounded p-1.5 opacity-60 hover:bg-black/5 hover:opacity-100"
      title="清空对话"
      disabled={streaming}
      on:click={clearChat}
    ><Fa icon={faTrash} size="xs" /></button>
    <button
      type="button"
      class="rounded p-1.5 opacity-60 hover:bg-black/5 hover:opacity-100"
      on:click={() => dispatch('close')}
    ><Fa icon={faTimes} /></button>
  </div>

  {#if showSettings}
    <div class="border-b border-current/10 px-4 py-3 text-sm">
      <label class="mb-2 flex items-center gap-2">
        Provider
        <select
          class="rounded border border-current/20 bg-transparent px-2 py-1"
          value={$aiProvider$}
          on:change={onProviderChange}
        >
          <option value="anthropic" style="color:#000;">Anthropic</option>
          <option value="openai" style="color:#000;">OpenAI 兼容（含 OpenRouter / Ollama）</option>
        </select>
      </label>
      <label class="mb-2 flex flex-col gap-1">
        <span>API Key</span>
        <input
          type="password"
          class="rounded border border-current/20 bg-transparent px-2 py-1"
          value={$aiApiKey$}
          on:input={onKeyInput}
          placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-... 或 ollama 任意'}
        />
      </label>
      <label class="mb-2 flex flex-col gap-1">
        <span>Base URL（OpenAI 兼容时填，留空用官方）</span>
        <input
          type="text"
          class="rounded border border-current/20 bg-transparent px-2 py-1"
          value={$aiBaseUrl$}
          on:input={onBaseInput}
          placeholder="https://openrouter.ai/api/v1 / http://localhost:11434/v1"
        />
      </label>
      <label class="mb-2 flex flex-col gap-1">
        <span>Model</span>
        <input
          type="text"
          class="rounded border border-current/20 bg-transparent px-2 py-1"
          value={$aiModel$}
          on:input={onModelInput}
          placeholder={provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o / qwen2.5'}
        />
      </label>
      <p class="text-xs opacity-50">仅本地保存。Anthropic 在浏览器中直连用了 dangerous-direct-browser-access 头。</p>
    </div>
  {/if}

  <div bind:this={logEl} class="flex-1 overflow-y-auto px-4 py-3">
    {#if !messages.length}
      <div class="py-8 text-center text-sm opacity-50">
        <p>问我关于已读内容的任何问题。</p>
        <p class="mt-2 text-xs">「这个人是谁？」「之前提过 X 吗？」「这条线索什么意思？」</p>
      </div>
    {/if}
    {#each messages as m, i (i)}
      <div class="mb-3 text-sm">
        {#if m.role === 'user'}
          <div class="rounded-lg bg-current/10 px-3 py-2">{m.content}</div>
        {:else}
          <div
            class="whitespace-pre-wrap break-words leading-relaxed"
            class:text-red-500={m.error}
          >{m.content || (streaming && i === messages.length - 1 ? '…' : '')}</div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="border-t border-current/10 px-3 py-3">
    <div class="flex items-end gap-2">
      <textarea
        bind:value={input}
        rows="2"
        class="flex-1 resize-none rounded border border-current/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-current/40"
        placeholder="问点什么…  Ctrl+Enter 发送"
        on:keydown={handleKey}
        disabled={streaming}
      />
      {#if streaming}
        <button
          type="button"
          class="flex h-9 items-center gap-1 rounded px-3 text-sm"
          style="background:rgba(180,80,80,0.85);color:#f0efe6;"
          on:click={stop}
        ><Fa icon={faStop} size="xs" /> 停止</button>
      {:else}
        <button
          type="button"
          class="flex h-9 items-center gap-1 rounded px-3 text-sm font-medium"
          style="background:rgba(95,126,123,0.9);color:#f0efe6;"
          on:click={send}
          disabled={!input.trim()}
        ><Fa icon={faPaperPlane} size="xs" /> 发送</button>
      {/if}
    </div>
  </div>
</div>
