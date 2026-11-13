<script lang="ts">
  /**
   * The top bar shared by every non-reader page (statistics, notebook,
   * translate, settings, changelog).
   *
   * Before this, those five pages had three different bars between them: two
   * on the dark menu colour with tabs, three on the page colour with an `<h1>`
   * and text buttons. Navigating between them looked like navigating between
   * apps.
   *
   * The layout rule is one line: this page's own sub-views and actions go
   * left, the ways out of this page go right, ending in NavStrip — the same
   * five pages in the same places everywhere, with this one marked.
   */
  import Fa from 'svelte-fa';
  import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
  import { page } from '$app/stores';
  import NavStrip from '$lib/components/page-header/nav-strip.svelte';
  import { mergeEntries, NAV_DESTINATIONS } from '$lib/components/merged-header-icon/merged-entries';
  import { baseHeaderClasses, baseIconClasses, translateXHeaderFa } from '$lib/css-classes';
  import { t } from '$lib/i18n';

  /** Identity of a page that is not in NavStrip (更新历史); the strip's
   *  marked entry says which page this is for the others. */
  export let icon: IconDefinition;
  export let titleKey: string;
  /**
   * Where the back arrow goes — usually the page you came from, so opening
   * the notebook mid-book still returns you to the book. Empty hides it.
   */
  export let backLink = '';

  $: inNav = NAV_DESTINATIONS.some((destination) => destination.routeId === $page.route.id);
</script>

<div class="elevation-4 fixed inset-x-0 top-0 z-40">
  <div class={baseHeaderClasses}>
    <!-- Same box as the library header's, so NavStrip lands in the same
         place on every page: this used to be the content column, which is
         narrower than the window from lg to xl. -->
    <div class="mx-auto flex px-4 md:px-8 xl:max-w-none 2xl:max-w-6xl">
      <div class="flex h-12 min-w-0 grow items-center xl:h-10">
        {#if !inNav}
          <div class="{baseIconClasses} !cursor-default !opacity-100" title={$t(titleKey)}>
            <Fa {icon} />
          </div>
          {#if $$slots.left}
            <div class="mr-1 h-5 w-px shrink-0 bg-current/30"></div>
          {/if}
        {/if}
        <slot name="left" />
      </div>
      <div class="flex h-12 shrink-0 transform-gpu items-center xl:h-10 {translateXHeaderFa}">
        <!-- Rules keep "what this page does" apart from "where to go". -->
        <slot name="right" />
        {#if backLink}
          <a href={backLink} style="color: inherit;" title={$t('menu.back.title')}>
            <div class={baseIconClasses}>
              <Fa icon={mergeEntries.BACK.icon} />
            </div>
          </a>
        {/if}
        {#if $$slots.right || backLink}
          <div class="mx-1 h-5 w-px shrink-0 bg-current/30"></div>
        {/if}
        <NavStrip />
      </div>
    </div>
  </div>
</div>
