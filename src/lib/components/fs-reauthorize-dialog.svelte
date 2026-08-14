<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';
  import { faFolderOpen, faCheck } from '@fortawesome/free-solid-svg-icons';
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import { buttonClasses } from '$lib/css-classes';
  import { applyReauthorizedPath, type ReauthTarget } from '$lib/functions/fs-reauthorize';
  import { pickUserDir } from '$lib/functions/pick-user-dir';
  import { t, tImmediate } from '$lib/i18n';

  export let targets: ReauthTarget[];

  const dispatch = createEventDispatcher<{ close: void }>();

  let done = new Set<string>();
  let busy = '';
  let error = '';

  async function repick(target: ReauthTarget) {
    busy = target.id;
    error = '';
    try {
      const picked = await pickUserDir({
        title: tImmediate(target.labelKey),
        defaultPath: target.path
      });
      if (!picked) return;
      applyReauthorizedPath(target.id, picked);
      // New array and new object: mutating in place and reassigning the same
      // reference leaves the keyed each block showing the old path when the
      // user picks a different folder than the one that broke.
      targets = targets.map((entry) =>
        entry.id === target.id ? { ...entry, path: picked } : entry
      );
      done = new Set([...done, target.id]);
    } catch (err: any) {
      error = tImmediate('fsReauth.failed', { err: err?.message || err });
    } finally {
      busy = '';
    }
  }

  $: allDone = targets.every((target) => done.has(target.id));
</script>

<DialogTemplate>
  <svelte:fragment slot="header">{$t('fsReauth.title')}</svelte:fragment>

  <svelte:fragment slot="content">
    <p class="max-w-lg text-sm leading-relaxed opacity-80">{$t('fsReauth.message')}</p>

    <ul class="mt-4 flex max-w-lg flex-col gap-2">
      {#each targets as target (target.id)}
        <li class="flex items-center justify-between gap-4 rounded border border-current/20 p-2">
          <div class="min-w-0">
            <div class="text-sm">{$t(target.labelKey)}</div>
            <div class="truncate text-xs opacity-60" title={target.path}>{target.path}</div>
          </div>

          {#if done.has(target.id)}
            <span class="inline-flex shrink-0 items-center gap-1.5 text-xs" style="color:var(--link-color)">
              <Fa icon={faCheck} size="xs" />
              {$t('fsReauth.restored')}
            </span>
          {:else}
            <button
              class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-current/30 px-2 py-1 text-xs hover-soft disabled:opacity-50"
              disabled={!!busy}
              on:click={() => repick(target)}
            >
              <Fa icon={faFolderOpen} size="xs" />
              {$t('fsReauth.repick')}
            </button>
          {/if}
        </li>
      {/each}
    </ul>

    {#if error}
      <p class="mt-3 max-w-lg text-xs" style="color:var(--danger-color);">{error}</p>
    {/if}

    <p class="mt-4 max-w-lg text-xs opacity-50 leading-relaxed">{$t('fsReauth.note')}</p>
  </svelte:fragment>

  <div class="flex grow justify-end" slot="footer">
    <button class={buttonClasses} on:click={() => dispatch('close')}>
      {allDone ? $t('dialog.confirm') : $t('fsReauth.later')}
      <Ripple />
    </button>
  </div>
</DialogTemplate>
