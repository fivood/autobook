<script lang="ts">
  import Fa from 'svelte-fa';
  import { createEventDispatcher } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import Popover from '$lib/components/popover/popover.svelte';
  import { baseIconClasses } from '$lib/css-classes';
  import { pagePath } from '$lib/data/env';
  import { dummyFn } from '$lib/functions/utils';
  import { t } from '$lib/i18n';

  // Merge-entry items carry sidecar `labelKey` / `titleKey` for i18n
  // (see merge-entries.ts). We MUST reference `$t` directly in the
  // template (inlined below), not via a helper function — Svelte 4 only
  // marks the template as reactive to a store if it sees `$store` in
  // the template AST. A helper that reads `$t` internally captures the
  // current value at mount and never re-fires on locale change.

  // labelKey / titleKey are optional so external callers can build ad-hoc
  // entries without an i18n key; MergedHeaderIcon falls back to the raw
  // label / title fields when the key is absent.
  type Entry = {
    routeId?: string;
    label: string;
    labelKey?: string;
    icon: (typeof mergeEntries.MANAGE)['icon'];
    title: string;
    titleKey?: string;
  };
  export let leavePageLink = '';
  export let items: Entry[] = [mergeEntries.MANAGE, mergeEntries.SETTINGS];
  export let mergeTo: Entry = mergeEntries.MANAGE;
  export let disableRouteNavigation = false;

  const dispatch = createEventDispatcher<{ action: string }>();

  const actionItems = items.filter((item) => item.routeId !== $page.route.id);

  let menuElm: Popover;

  function handleActionMenuItem(target: string) {
    dispatch('action', target);

    if (
      !(target === mergeEntries.FILE_IMPORT.label || target === mergeEntries.FOLDER_IMPORT.label)
    ) {
      menuElm.toggleOpen();
    }

    if (!disableRouteNavigation) {
      const action = actionItems.find((item) => item.label === target);

      if (action?.routeId) {
        goto(`${pagePath}${action.routeId}`);
      }
    }
  }

  if (actionItems.length === 1 && actionItems[0].routeId) {
    leavePageLink = actionItems[0].routeId;
  }
</script>

{#if leavePageLink}
  <a
    href={leavePageLink}
    style="color: inherit;"
    title={mergeTo.titleKey ? $t(mergeTo.titleKey) : mergeTo.title}
  >
    <div class="{baseIconClasses} !opacity-100">
      <Fa icon={mergeTo.icon} />
    </div>
  </a>
{:else}
  <div class="hidden sm:flex">
    {#each actionItems as actionItem (actionItem.label)}
      <div
        tabindex="0"
        role="button"
        title={actionItem.titleKey ? $t(actionItem.titleKey) : actionItem.title}
        class={baseIconClasses}
        on:click={() => handleActionMenuItem(actionItem.label)}
        on:keyup={dummyFn}
      >
        <Fa icon={actionItem.icon} />
      </div>
    {/each}
  </div>
  <div class="flex sm:hidden">
    <Popover
      placement="bottom"
      fallbackPlacements={['bottom-end', 'bottom-start']}
      yOffset={0}
      bind:this={menuElm}
    >
      <div slot="icon" class={baseIconClasses}>
        <Fa icon={mergeTo.icon} />
      </div>
      <div class="w-40 bg-menu text-menu md:w-32" slot="content">
        {#each actionItems as actionItem (actionItem.label)}
          <div
            tabindex="0"
            role="button"
            class="px-4 py-2 text-sm hover:bg-white/10"
            title={actionItem.titleKey ? $t(actionItem.titleKey) : actionItem.title}
            on:click={() => handleActionMenuItem(actionItem.label)}
            on:keyup={dummyFn}
          >
            {actionItem.labelKey ? $t(actionItem.labelKey) : actionItem.label}
          </div>
        {/each}
      </div>
    </Popover>
  </div>
{/if}
