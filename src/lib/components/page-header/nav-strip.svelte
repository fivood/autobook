<script lang="ts">
  /**
   * The ways between the main pages, identical on every page that has them.
   *
   * Each page used to list the others minus itself, so every icon moved one
   * slot depending on where you were — the gear was the rightmost icon on the
   * library and second from the right on the statistics page — and nothing
   * on screen said which page you were on. Position could not be learned
   * because it kept changing, and the icons had no words. Now the five never
   * move, the current one is marked instead of dropped, and wide windows
   * name them.
   */
  import Fa from 'svelte-fa';
  import { page } from '$app/stores';
  import { NAV_DESTINATIONS } from '$lib/components/merged-header-icon/merged-entries';
  import { pagePath } from '$lib/data/env';
  import { t } from '$lib/i18n';
</script>

<nav class="flex h-full items-stretch" aria-label={$t('menu.nav.aria')}>
  {#each NAV_DESTINATIONS as destination (destination.routeId)}
    {#if $page.route.id === destination.routeId}
      <span
        class="chrome-tab is-active flex items-center gap-2 px-3 text-xl xl:px-2.5 xl:text-lg"
        aria-current="page"
        title={$t(destination.titleKey)}
      >
        <Fa icon={destination.icon} />
        <span class="hidden text-sm xl:inline">{$t(destination.labelKey)}</span>
      </span>
    {:else}
      <a
        href={`${pagePath}${destination.routeId}`}
        class="chrome-tab is-inactive flex items-center gap-2 px-3 text-xl opacity-80 hover:opacity-100 nav-link xl:px-2.5 xl:text-lg"
        title={$t(destination.titleKey)}
      >
        <Fa icon={destination.icon} />
        <span class="hidden text-sm xl:inline">{$t(destination.labelKey)}</span>
      </a>
    {/if}
  {/each}
</nav>

<style>
  /* Beats the global a:link colour; the shared .chrome-tab hover still wins. */
  .nav-link {
    color: inherit;
  }
</style>
