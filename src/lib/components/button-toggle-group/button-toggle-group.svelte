<script lang="ts">
  import { faPen, faTrash } from '@fortawesome/free-solid-svg-icons';
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import Ripple from '$lib/components/ripple.svelte';
  import { availableThemes } from '$lib/data/theme-option';
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';

  export let options: ToggleOption<any>[];
  export let selectedOptionId: any;
  export let invertColors = false;

  const dispatch = createEventDispatcher<{
    edit: string;
    delete: string;
  }>();

  function mapToStyleString(style: Record<string, any> | undefined) {
    if (!style) return '';

    return Object.entries(style)
      .map(([key, value]) => `${key}: ${value}`)
      .join(';');
  }

  function btnStyle(isSelected: boolean, optStyle: Record<string, any> | undefined) {
    const base = isSelected
      ? 'background-color: var(--button-selected); border-color: var(--button-border, var(--button-selected)); color: var(--menu-foreground);'
      : '';
    return base + mapToStyleString(optStyle);
  }
</script>

<div class="-m-1 flex flex-wrap">
  {#each options as option}
    <div class="flex">
      <button
        title={option.id}
        class="toggle-btn m-1 rounded-md border-2 p-2 text-lg transition-colors"
        class:selected={option.id === selectedOptionId}
        class:invert-mode={invertColors}
        class:border-4={option.thickBorders && option.id === selectedOptionId}
        style={btnStyle(option.id === selectedOptionId, option.style)}
        on:click={() => (selectedOptionId = option.id)}
      >
        {option.text}
        <Ripple />
      </button>
      {#if option.showIcons && option.id === selectedOptionId}
        <div class="flex flex-col justify-around mr-2 gap-1">
          <button
            title={availableThemes.has(option.id) ? '编辑（基于内置主题创建覆盖）' : '编辑主题'}
            class="p-1 opacity-70 hover:opacity-100"
            on:click={() => dispatch('edit', option.id)}
          >
            <Fa icon={faPen} />
          </button>
          {#if !availableThemes.has(option.id)}
            <button
              title="删除主题"
              class="p-1 opacity-70 hover:opacity-100 text-red-600"
              on:click={() => dispatch('delete', option.id)}
            >
              <Fa icon={faTrash} />
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  <slot />
</div>

<style>
  /* Default mode (invertColors=false):
     - selected = solid accent (inline style sets bg/color), bold, full opacity
     - unselected = transparent box with dim text + dim border, no white fill
       so dark theme doesn't make the "off" option look brighter than "on". */
  .toggle-btn {
    background: transparent;
    color: currentColor;
    border-color: color-mix(in srgb, currentColor 32%, transparent);
    opacity: 0.5;
    font-weight: 400;
  }
  .toggle-btn.selected {
    opacity: 1;
    font-weight: 600;
    /* bg-color, border-color, color come from the inline style via btnStyle()
       which uses --button-selected / --menu-foreground; keep those winning. */
  }
  .toggle-btn:not(.selected):hover {
    opacity: 0.85;
    background: color-mix(in srgb, currentColor 7%, transparent);
  }

  /* Inverted mode: caller wants the "selected" pill to be the bright white one
     and the unselected ones to share the menu accent. Kept for the statistics
     "keep which side" picker. */
  .toggle-btn.invert-mode.selected {
    background: #ffffff;
    color: #000000;
    border-color: #ffffff;
  }
  .toggle-btn.invert-mode:not(.selected) {
    opacity: 0.55;
  }
</style>
