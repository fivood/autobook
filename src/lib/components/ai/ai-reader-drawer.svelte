<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faTimes,
    faPaperPlane,
    faStop,
    faTrash,
    faCog,
    faEye,
    faEyeSlash
  } from '@fortawesome/free-solid-svg-icons';
  import { fly } from 'svelte/transition';
  import { quintInOut } from 'svelte/easing';
  import { clickOutside } from '$lib/functions/use-click-outside';
  import {
    aiApiKey$,
    aiBaseUrl$,
    aiMaxTokens$,
    aiModel$,
    aiProvider$,
    aiSpoilerSafeTitles$,
    aiTimeoutSec$
  } from '$lib/data/store';
  import { streamChat, type AiMessage, type AiProvider } from '$lib/data/ai/ai-client';
  import { hasCloudCredentials, resolveEndpoint } from '$lib/data/ai/endpoint';
  import { probeLocalModels } from '$lib/data/ai/local-model';
  import { plaintextSecrets$ } from '$lib/data/internal/writable-secret-subject';
  import {
    clampInt,
    estimateTokens,
    ollamaContextFor,
    trimHistory
  } from '$lib/data/ai/chat-budget';
  import {
    buildBookTextIndex,
    retrieveSpoilerSafe,
    type BookTextIndex
  } from '$lib/data/ai/book-text-index';
  import { t, tImmediate } from '$lib/i18n';

  export let bookId: number;
  export let bookTitle: string;
  export let elementHtml: string;
  export let exploredCharCount: number;
  export let bookCharCount: number;
  /** A passage to start the question box with — the highlight toolbar's
   *  「问 AI」. Applied when it changes, so it also reaches a drawer that is
   *  already open; anything else the reader typed is theirs and left alone. */
  export let initialInput = '';

  interface UiMessage {
    role: 'user' | 'assistant';
    content: string;
    error?: boolean;
  }

  let messages: UiMessage[] = [];
  let input = '';
  let appliedInput = '';
  $: if (initialInput && initialInput !== appliedInput) {
    appliedInput = initialInput;
    input = initialInput;
  }
  let streaming = false;
  let abortCtrl: AbortController | undefined;
  let logEl: HTMLDivElement;
  let index: BookTextIndex | undefined;
  let showSettings = false;
  /** i18n key of the notice shown when a question can't be sent yet. */
  let configNotice = '';
  /** What answered (or would answer): shown so a fallback to local is visible. */
  let endpointLabel = '';

  /**
   * Below this a local model is not offered for the assistant: it has to
   * follow a multi-rule system prompt over ~8k chars of retrieved text, and
   * smaller models ignore the spoiler rules. An explicit choice in settings
   * still wins (resolveLocalModel honours it).
   */
  const LOCAL_MIN_BILLIONS = 7;

  function pickEndpoint() {
    const ep = resolveEndpoint('prefer-cloud', LOCAL_MIN_BILLIONS);
    endpointLabel = ep
      ? ep.isLocal
        ? tImmediate('ai.endpointLocal', { model: ep.label })
        : ep.label
      : '';
    return ep;
  }

  // Closing the drawer (its button or any click outside it) destroys this
  // component; without this the request ran on — still billed, local GPU
  // still busy — with nowhere left to show the answer.
  onDestroy(() => abortCtrl?.abort());

  onMount(() => {
    probeLocalModels()
      .catch(() => {
        // Folded into localProbe$; no local runtime just means no fallback.
      })
      .then(pickEndpoint);
  });

  const dispatch = createEventDispatcher<{ close: void }>();

  $: index =
    elementHtml && bookId
      ? buildBookTextIndex(bookId, bookTitle, elementHtml)
      : undefined;

  $: provider = ($aiProvider$ as AiProvider) || 'anthropic';
  // Re-resolve whenever the cloud fields change, so the label and the notice
  // follow what is typed in the settings panel.
  $: $aiApiKey$, $aiBaseUrl$, $aiModel$, $aiProvider$, pickEndpoint();
  $: if (configNotice && endpointLabel) configNotice = '';

  async function scrollToBottom() {
    await tick();
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }

  /**
   * Spoiler-safety is opt-in per book. It earns its keep on a mystery and gets
   * in the way everywhere else: with it on, asking a non-fiction book what its
   * argument is gets 「目前还没读到，不能剧透」.
   */
  $: spoilerSafe = $aiSpoilerSafeTitles$.has(bookTitle);

  function toggleSpoilerSafe() {
    const next = new Set($aiSpoilerSafeTitles$);
    if (next.has(bookTitle)) next.delete(bookTitle);
    else next.add(bookTitle);
    aiSpoilerSafeTitles$.next(next);
  }

  /** Written in the UI language, so the model answers in it — and so the
   *  refusal it is told to quote reads naturally to this reader. */
  function buildSystemPrompt(): string {
    const pct = bookCharCount > 0 ? Math.round((exploredCharCount / bookCharCount) * 100) : 0;
    return tImmediate(spoilerSafe ? 'ai.prompt.safe' : 'ai.prompt.open', { title: bookTitle, pct });
  }

  function buildContextBlock(query: string): string {
    if (!index) return '';
    // Same retrieval either way; with spoiler-safety off the cutoff simply
    // sits at the end of the book, so the whole text is searchable. With it on
    // and the length not measured yet (0), nothing counts as read: the gate
    // used to fail open here and hand over the whole book.
    const readRatio = !spoilerSafe ? 1 : bookCharCount > 0 ? exploredCharCount / bookCharCount : 0;
    const { topChunks, recentTail } = retrieveSpoilerSafe(index, query, readRatio);
    const seen = new Set<number>();
    const collected: typeof topChunks = [];
    for (const c of [...recentTail, ...topChunks]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      collected.push(c);
    }
    collected.sort((a, b) => a.startChar - b.startChar);
    if (!collected.length) return tImmediate('ai.emptyContext');
    const blocks = collected.map((c) => `--- chunk #${c.id} ---\n${c.text}`);
    return blocks.join('\n\n');
  }

  async function send() {
    const q = input.trim();
    if (!q || streaming) return;
    const endpoint = pickEndpoint();
    if (!endpoint) {
      // Say what is missing rather than just popping the panel open: an empty
      // model name used to surface as a failed request, or as nothing at all.
      const credentialsOk = hasCloudCredentials(provider, $aiApiKey$, $aiBaseUrl$);
      configNotice = credentialsOk && !$aiModel$.trim() ? 'ai.needModel' : 'ai.needConfig';
      showSettings = true;
      return;
    }
    configNotice = '';
    input = '';
    messages = [...messages, { role: 'user', content: q }];
    await scrollToBottom();

    const ctx = buildContextBlock(q);
    // The heading has to match what was actually retrieved — calling the whole
    // book 「已读片段」 would invite the model to refuse on things it can see.
    const ctxHeading = tImmediate(spoilerSafe ? 'ai.prompt.headingSafe' : 'ai.prompt.headingOpen');
    const sys = `${buildSystemPrompt()}\n\n${ctxHeading}\n${ctx}`;

    // Failed turns hold our own error text, and a reply stopped before its
    // first token is empty — Anthropic rejects empty content with a 400, so
    // one early Stop used to break every later question in the chat.
    // History is capped (chat-budget.ts); the system prompt and retrieved
    // context are rebuilt per question and always sent whole.
    const apiMessages: AiMessage[] = trimHistory(
      messages.filter((m) => !m.error && m.content.trim())
    ).map(({ role, content }) => ({ role, content }));
    const maxTokens = clampInt($aiMaxTokens$, 256, 32000, 4096);
    const promptTokens =
      estimateTokens(sys) + apiMessages.reduce((n, m) => n + estimateTokens(m.content), 0);

    messages = [...messages, { role: 'assistant', content: '' }];
    streaming = true;
    abortCtrl = new AbortController();

    try {
      for await (const chunk of streamChat(endpoint.opts, {
        system: sys,
        messages: apiMessages,
        maxTokens,
        silenceTimeoutMs: clampInt($aiTimeoutSec$, 30, 900, 180) * 1000,
        contextTokens: ollamaContextFor(promptTokens, maxTokens),
        signal: abortCtrl.signal
      })) {
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
            ? { role: 'assistant', content: tImmediate('ai.requestFailed', { err: err?.message || err }), error: true }
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
    <h2 class="text-lg font-medium">{$t('ai.title')}</h2>
    <span class="text-xs text-muted"
      >{$t(spoilerSafe ? 'ai.subtitle' : 'ai.subtitleOpen', {
        pct: bookCharCount > 0 ? Math.round((exploredCharCount / bookCharCount) * 100) : 0
      })}</span
    >
    <div class="flex-1" />
    <button
      type="button"
      class="rounded p-1.5 hover-soft"
      class:opacity-60={!spoilerSafe}
      title={spoilerSafe ? $t('ai.spoilerSafeOn') : $t('ai.spoilerSafeOff')}
      on:click={toggleSpoilerSafe}
    ><Fa icon={spoilerSafe ? faEyeSlash : faEye} size="xs" /></button>
    <button
      type="button"
      class="rounded p-1.5 opacity-60 hover-soft hover:opacity-100"
      title={$t('ai.settings')}
      on:click={() => (showSettings = !showSettings)}
    ><Fa icon={faCog} size="xs" /></button>
    <button
      type="button"
      class="rounded p-1.5 opacity-60 hover-soft hover:opacity-100"
      title={$t('ai.clearChat')}
      disabled={streaming}
      on:click={clearChat}
    ><Fa icon={faTrash} size="xs" /></button>
    <button
      type="button"
      class="rounded p-1.5 opacity-60 hover-soft hover:opacity-100"
      title={$t('dialog.close')}
      on:click={() => dispatch('close')}
    ><Fa icon={faTimes} /></button>
  </div>

  {#if showSettings}
    <div class="border-b border-current/10 px-4 py-3 text-sm">
      {#if configNotice}
        <p class="mb-2 text-danger" role="alert">{$t(configNotice)}</p>
      {/if}
      <label class="mb-2 flex items-center gap-2">
        {$t('settings.ai.provider')}
        <select
          class="min-w-0 flex-1 rounded border border-current/20 bg-transparent px-2 py-1"
          value={$aiProvider$}
          on:change={onProviderChange}
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai">{$t('ai.providerOpenaiLabel')}</option>
        </select>
      </label>
      <label class="mb-2 flex flex-col gap-1">
        <span>{$t('settings.ai.apiKey')}</span>
        <input
          type="password"
          class="rounded border border-current/20 bg-transparent px-2 py-1"
          value={$aiApiKey$}
          on:input={onKeyInput}
          placeholder={provider === 'anthropic' ? 'sk-ant-...' : $t('ai.keyPlaceholder')}
          autocomplete="off"
        />
      </label>
      <label class="mb-2 flex flex-col gap-1">
        <span>{$t('ai.baseUrlLabel')}</span>
        <input
          type="text"
          class="rounded border border-current/20 bg-transparent px-2 py-1"
          value={$aiBaseUrl$}
          on:input={onBaseInput}
          title={$t('ai.baseUrlTooltip')}
          spellcheck="false"
        />
      </label>
      <label class="mb-2 flex flex-col gap-1">
        <span>{$t('settings.ai.model')}</span>
        <input
          type="text"
          class="rounded border border-current/20 bg-transparent px-2 py-1"
          value={$aiModel$}
          on:input={onModelInput}
          spellcheck="false"
        />
      </label>
      {#if $plaintextSecrets$.includes('aiApiKey')}
        <p class="text-xs" style="color:var(--danger-color);" role="alert">{$t('ai.keyPlaintext')}</p>
      {:else}
        <p class="text-xs opacity-50">{$t('ai.privacyNote')}</p>
      {/if}
      <p class="mt-1 text-xs opacity-60">{$t('ai.localHint')}</p>
      <!-- These four inputs are the same stores the settings page writes, kept
           here only so a first-run user can start chatting without leaving the
           book. Everything else (local runtime, per-feature switches) lives in
           settings — this panel is deliberately not growing to match it. -->
      <p class="mt-2 text-xs opacity-60">
        <a href="/settings" class="underline">{$t('ai.moreInSettings')}</a>
      </p>
    </div>
  {/if}

  <div bind:this={logEl} class="flex-1 overflow-y-auto px-4 py-3">
    {#if !messages.length}
      <div class="py-8 text-center text-sm text-muted">
        <p>{$t(spoilerSafe ? 'ai.emptyHint1' : 'ai.emptyHint1Open')}</p>
        <p class="mt-2 text-xs">{$t('ai.emptyHint2')}</p>
        {#if endpointLabel}
          <p class="mt-4 text-xs opacity-70">{$t('ai.usingModel', { model: endpointLabel })}</p>
        {/if}
      </div>
    {/if}
    {#each messages as m, i (i)}
      <div class="mb-3 text-sm">
        {#if m.role === 'user'}
          <div class="rounded-lg bg-current/10 px-3 py-2">{m.content}</div>
        {:else}
          <div
            class="whitespace-pre-wrap break-words leading-relaxed"
            class:text-danger={m.error}
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
        placeholder={$t('ai.inputPlaceholder')}
        on:keydown={handleKey}
      />
      {#if streaming}
        <button
          type="button"
          class="flex h-9 items-center gap-1 rounded border border-current/20 px-3 text-sm hover-soft-strong"
          style="color:var(--danger-color);"
          on:click={stop}
        ><Fa icon={faStop} size="xs" /> {$t('ai.stop')}</button>
      {:else}
        <button
          type="button"
          class="flex h-9 items-center gap-1 rounded px-3 text-sm font-medium"
          style="background:var(--menu-background);color:var(--menu-foreground);"
          on:click={send}
          disabled={!input.trim()}
        ><Fa icon={faPaperPlane} size="xs" /> {$t('ai.send')}</button>
      {/if}
    </div>
  </div>
</div>
