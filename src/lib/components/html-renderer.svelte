<script lang="ts">
  import { onMount, tick, createEventDispatcher } from 'svelte';

  export let html: string;

  let el: HTMLDivElement;
  let currentHtml = '';

  const dispatch = createEventDispatcher<{
    load: void;
  }>();

  onMount(() => {
    if (html) {
      currentHtml = html;
      el.innerHTML = html;
      tick().then(() => dispatch('load'));
    }
  });

  $: if (el && html && html !== currentHtml) {
    currentHtml = html;
    el.innerHTML = html;
    tick().then(() => dispatch('load'));
  }
</script>

<div bind:this={el} style="display:contents" />
