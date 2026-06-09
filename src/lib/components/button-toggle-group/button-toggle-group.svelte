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
        class="toggle-btn m-1 rounded-md border-2 border-gray-400 p-2 text-black text-lg transition-colors"
        class:selected={option.id === selectedOptionId}
        class:border-4={option.thickBorders && option.id === selectedOptionId}
        class:text-white={(option.id === selectedOptionId && !invertColors) ||
          (option.id !== selectedOptionId && invertColors)}
        class:bg-white={(option.id === selectedOptionId && invertColors) ||
          (option.id !== selectedOptionId && !invertColors)}
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
  .toggle-btn:not(.selected):hover {
    filter: brightness(0.92);
  }
</style>
