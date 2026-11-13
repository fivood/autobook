<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { buttonClasses } from '$lib/css-classes';
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import { t } from '$lib/i18n';

  export let title: string;

  export let message: string;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();
</script>

<DialogTemplate>
  <svelte:fragment slot="header">{title}</svelte:fragment>
  <svelte:fragment slot="content">
    <!-- pre-line, because callers do pass 
-separated messages (engine error
         + what to try next) and a plain <p> ran them together. -->
    <p class="whitespace-pre-line">{message}</p>
  </svelte:fragment>
  <svelte:fragment slot="footer">
    <button class={buttonClasses} on:click={() => dispatch('close')}>
      {$t('dialog.close')}
      <Ripple />
    </button>
  </svelte:fragment>
</DialogTemplate>
