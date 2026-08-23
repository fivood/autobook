<script lang="ts">
  import Fa from 'svelte-fa';
  import { createEventDispatcher } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import Popover from '$lib/components/popover/popover.svelte';
  import { baseIconClasses } from '$lib/css-classes';
  import { pagePath } from '$lib/data/env';
  import { activateOnKeyup } from '$lib/functions/utils';
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
  /** Keep the popover on every width instead of fanning the items out as
   * inline icons at lg. The reader header uses it so its icon row stays the
   * short list of things you reach for mid-book. */
  export let alwaysCollapse = false;

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

  if (!alwaysCollapse && actionItems.length === 1 && actionItems[0].routeId) {
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
  <div class={alwaysCollapse ? 'hidden' : 'hidden lg:flex'}>
    {#each actionItems as actionItem (actionItem.label)}
      <div
        tabindex="0"
        role="button"
        title={actionItem.titleKey ? $t(actionItem.titleKey) : actionItem.title}
        class={baseIconClasses}
        on:click={() => handleActionMenuItem(actionItem.label)}
        on:keyup={activateOnKeyup}
      >
        <Fa icon={actionItem.icon} />
      </div>
    {/each}
  </div>
  <div class={alwaysCollapse ? 'flex' : 'flex lg:hidden'}>
    <Popover
      placement="bottom"
      fallbackPlacements={['bottom-end', 'bottom-start']}
      yOffset={0}
      bind:this={menuElm}
    >
      <div
        slot="icon"
        class={baseIconClasses}
        aria-label={mergeTo.titleKey ? $t(mergeTo.titleKey) : mergeTo.title}
        title={mergeTo.titleKey ? $t(mergeTo.titleKey) : mergeTo.title}
      >
        <Fa icon={mergeTo.icon} />
      </div>
      <div class="menu-list w-40 md:w-32" slot="content">
        {#each actionItems as actionItem (actionItem.label)}
          <div
            tabindex="0"
            role="button"
            class="menu-item"
            title={actionItem.titleKey ? $t(actionItem.titleKey) : actionItem.title}
            on:click={() => handleActionMenuItem(actionItem.label)}
            on:keyup={activateOnKeyup}
          >
            {actionItem.labelKey ? $t(actionItem.labelKey) : actionItem.label}
          </div>
        {/each}
      </div>
    </Popover>
  </div>
{/if}
