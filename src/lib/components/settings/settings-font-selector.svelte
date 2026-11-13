<script lang="ts">
  import { faFont } from '@fortawesome/free-solid-svg-icons';
  import Popover from '$lib/components/popover/popover.svelte';
  import { LocalFont } from '$lib/data/fonts';
  import { activateOnKeyup } from '$lib/functions/utils';
  import Fa from 'svelte-fa';
  import { t } from '$lib/i18n';

  export let availableFonts: LocalFont[] = [LocalFont.NOTOSANSJP];
  export let fontValue: string;

  let element: Popover;
</script>

<Popover bind:this={element} placement="bottom">
  <div slot="icon" class="mx-2" title={$t('fonts.showDefaults')}>
    <Fa icon={faFont} />
  </div>
  <div class="menu-list" slot="content">
    {#each availableFonts as font (font)}
      <div
        tabindex="0"
        role="button"
        class="menu-item"
        class:menu-item-active={font === fontValue}
        on:click={() => {
          fontValue = font;
          element.toggleOpen();
        }}
        on:keyup={activateOnKeyup}
      >
        {font}
      </div>
    {/each}
  </div>
</Popover>
