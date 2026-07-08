
<script lang="ts">
  // Language chip in the top nav. Sits alongside the sort / filter / cover
  // popovers so it reads as another "how the library looks" preference,
  // not a global settings surface — three items, no icon lookup, no
  // storage-source-style conditional list. Persisted via locale$.
  import Popover from '$lib/components/popover/popover.svelte';
  import { baseIconClasses } from '$lib/css-classes';
  import { locale$, LOCALES, t, type Locale } from '$lib/i18n';
  import { faLanguage } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { dummyFn } from '$lib/functions/utils';

  let picker: Popover;

  function pick(loc: Locale) {
    locale$.set(loc);
    picker.toggleOpen();
  }
</script>

<Popover
  placement="bottom"
  fallbackPlacements={['bottom-end', 'bottom-start']}
  yOffset={0}
  bind:this={picker}
>
  <div slot="icon" class={baseIconClasses} title={$t('locale.label')}>
    <Fa icon={faLanguage} />
  </div>
  <div class="w-32 bg-menu text-menu" slot="content">
    {#each LOCALES as loc (loc)}
      <div
        tabindex="0"
        role="button"
        class="cursor-pointer px-4 py-2 text-sm hover-menu-inverted"
        class:bg-menu-inverted={$locale$ === loc}
        class:text-menu-inverted={$locale$ === loc}
        on:click={() => pick(loc)}
        on:keyup={dummyFn}
      >
        {$t('locale.' + loc)}
      </div>
    {/each}
  </div>
</Popover>
