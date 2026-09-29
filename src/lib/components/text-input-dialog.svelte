<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import { buttonClasses, inputClasses } from '$lib/css-classes';
  import { t } from '$lib/i18n';
  import { createEventDispatcher, tick } from 'svelte';

  export let dialogHeader: string;
  export let placeholder = '';
  export let initialValue = '';
  export let confirmLabel: string | undefined = undefined;
  export let cancelLabel: string | undefined = undefined;
  export let resolver: (value: string | undefined) => void;

  let value = initialValue;
  let inputEl: HTMLInputElement | undefined;

  const dispatch = createEventDispatcher<{ close: void }>();

  tick().then(() => inputEl?.focus());

  function close(result: string | undefined) {
    resolver(result);
    dispatch('close');
  }
</script>

<DialogTemplate>
  <svelte:fragment slot="header">{dialogHeader}</svelte:fragment>
  <div class="flex flex-col text-sm sm:text-base" slot="content">
    <input
      type="text"
      class={inputClasses}
      {placeholder}
      bind:value
      bind:this={inputEl}
      on:keyup={(ev) => {
        if (ev.key === 'Enter') close(value.trim() || undefined);
        if (ev.key === 'Escape') close(undefined);
      }}
    />
  </div>
  <div class="flex grow justify-between" slot="footer">
    <button class={buttonClasses} on:click={() => close(undefined)}>
      {cancelLabel ?? $t('dialog.cancel')}
      <Ripple />
    </button>
    <button class={buttonClasses} on:click={() => close(value.trim() || undefined)}>
      {confirmLabel ?? $t('dialog.confirm')}
      <Ripple />
    </button>
  </div>
</DialogTemplate>
