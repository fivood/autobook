<script lang="ts">
  /**
   * @license BSD-3-Clause
   * Copyright (c) 2026, ッツ Reader Authors
   * All rights reserved.
   *
   * Inline theme editor — renders directly under the theme picker so users
   * don't have to deal with a modal dialog for routine tweaks. Edits a single
   * theme by id; built-ins are saved as a same-id override in customThemes.
   */
  import Ripple from '$lib/components/ripple.svelte';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import SettingsCustomThemeInput from '$lib/components/settings/settings-custom-theme-input.svelte';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { customThemes$, theme$ } from '$lib/data/store';
  import { availableThemes, type CustomThemeValue, type ThemeOption } from '$lib/data/theme-option';
  import { createEventDispatcher, onMount } from 'svelte';

  export let themeId: string;

  const dispatch = createEventDispatcher<{ close: void; saved: string; deleted: string }>();

  const blank: CustomThemeValue = {
    hexExpression: '#ffffff',
    alphaValue: 1,
    rgbaExpression: 'rgba(255,255,255,1)'
  };

  let customTheme: Record<keyof ThemeOption, CustomThemeValue> = {
    fontColor: { ...blank },
    backgroundColor: { ...blank },
    selectionFontColor: { ...blank },
    selectionBackgroundColor: { ...blank },
    menuBackgroundColor: { ...blank },
    menuFontColor: { ...blank },
    buttonSelectedColor: { ...blank },
    buttonHoverColor: { ...blank },
    linkColor: { ...blank },
    hintFuriganaShadowColor: { ...blank },
    hintFuriganaFontColor: { ...blank },
    tooltipTextFontColor: { ...blank }
  };

  $: themeStyle = `color: ${customTheme.fontColor.rgbaExpression}; background-color: ${customTheme.backgroundColor.rgbaExpression}`;
  $: isCustom = themeId in $customThemes$;

  onMount(() => {
    const source = $customThemes$[themeId] || availableThemes.get(themeId);
    if (source) customTheme = themeDataFromTheme(source);
  });

  function themeDataFromTheme(
    referenceObject: ThemeOption
  ): Record<keyof ThemeOption, CustomThemeValue> {
    const result: any = { ...customTheme };
    for (const [key, value] of Object.entries(referenceObject)) {
      if (typeof value !== 'string') continue;
      const [r, g, b, a] = (value.match(/rgba\((.+)\)/)?.[1] || '0,0,0,1')
        .split(',')
        .map((x: string) => parseFloat(x.trim()));
      result[key] = {
        hexExpression: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b
          .toString(16)
          .padStart(2, '0')}`,
        alphaValue: a,
        rgbaExpression: value
      };
    }
    return result;
  }

  function hexToRGB(h: string, alpha: number) {
    let r = '0';
    let g = '0';
    let b = '0';
    if (h.length === 4) {
      r = `0x${h[1]}${h[1]}`;
      g = `0x${h[2]}${h[2]}`;
      b = `0x${h[3]}${h[3]}`;
    } else if (h.length === 7) {
      r = `0x${h[1]}${h[2]}`;
      g = `0x${h[3]}${h[4]}`;
      b = `0x${h[5]}${h[6]}`;
    }
    return `rgba(${+r},${+g},${+b},${alpha})`;
  }

  function handleColorChange(event: CustomEvent<{ attribute: keyof ThemeOption; value: string }>) {
    const { attribute, value } = event.detail;
    const entry = customTheme[attribute];
    customTheme = {
      ...customTheme,
      [attribute]: {
        hexExpression: value,
        alphaValue: entry.alphaValue,
        rgbaExpression: hexToRGB(value, entry.alphaValue)
      }
    };
  }

  function handleAlphaChange(event: CustomEvent<{ attribute: keyof ThemeOption; value: number }>) {
    const { attribute, value } = event.detail;
    const entry = customTheme[attribute];
    customTheme = {
      ...customTheme,
      [attribute]: {
        hexExpression: entry.hexExpression,
        alphaValue: value,
        rgbaExpression: hexToRGB(entry.hexExpression, value)
      }
    };
  }

  function handleSave() {
    const newTheme: any = {};
    for (const [key, value] of Object.entries(customTheme)) {
      newTheme[key] = value.rgbaExpression;
    }
    $customThemes$ = { ...$customThemes$, [themeId]: newTheme };
    $theme$ = themeId;
    dispatch('saved', themeId);
  }

  function handleReset() {
    const builtin = availableThemes.get(themeId);
    if (!builtin) return;
    customTheme = themeDataFromTheme(builtin);
  }

  function handleDelete() {
    if (!isCustom) return;
    dialogManager.dialogs$.next([
      {
        component: ConfirmDialog,
        props: {
          dialogHeader: '删除主题',
          dialogMessage: `确认删除主题「${themeId}」？`,
          resolver: (wasCanceled: boolean) => {
            if (wasCanceled) return;
            const next = { ...$customThemes$ };
            delete next[themeId];
            $customThemes$ = next;
            dispatch('deleted', themeId);
          }
        }
      }
    ]);
  }
</script>

<div class="mt-2 rounded-lg border border-current/20 p-4 bg-soft-active">
  <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
    <div class="text-sm font-medium">
      正在编辑：<span class="font-mono">{themeId}</span>
      {#if !isCustom}
        <span class="ml-2 text-xs opacity-70">（保存将覆盖内置主题）</span>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      <button
        class="settings-btn"
        style={themeStyle}
        title="预览"
      >
        中字
      </button>
    </div>
  </div>
  <div class="grid grid-cols-1 gap-2 items-center sm:grid-cols-[auto_auto_5rem] sm:gap-4">
    <span class="hidden sm:block text-xs opacity-70">属性</span>
    <span class="hidden sm:block text-xs opacity-70">颜色</span>
    <span class="hidden sm:block text-xs opacity-70">透明度</span>
    <SettingsCustomThemeInput
      label="正文字体色"
      attribute="fontColor"
      values={customTheme.fontColor}
      on:color={handleColorChange}
      on:alpha={handleAlphaChange}
    />
    <SettingsCustomThemeInput
      label="正文背景色"
      attribute="backgroundColor"
      values={customTheme.backgroundColor}
      on:color={handleColorChange}
      on:alpha={handleAlphaChange}
    />
    <SettingsCustomThemeInput
      label="菜单背景色"
      attribute="menuBackgroundColor"
      values={customTheme.menuBackgroundColor}
      on:color={handleColorChange}
      on:alpha={handleAlphaChange}
    />
    <SettingsCustomThemeInput
      label="菜单文字色"
      attribute="menuFontColor"
      values={customTheme.menuFontColor}
      on:color={handleColorChange}
      on:alpha={handleAlphaChange}
    />
    <SettingsCustomThemeInput
      label="按钮选中色"
      attribute="buttonSelectedColor"
      values={customTheme.buttonSelectedColor}
      on:color={handleColorChange}
      on:alpha={handleAlphaChange}
    />
    <SettingsCustomThemeInput
      label="按钮悬停色"
      attribute="buttonHoverColor"
      values={customTheme.buttonHoverColor}
      on:color={handleColorChange}
      on:alpha={handleAlphaChange}
    />
    <SettingsCustomThemeInput
      label="选中文字背景"
      attribute="selectionBackgroundColor"
      values={customTheme.selectionBackgroundColor}
      on:color={handleColorChange}
      on:alpha={handleAlphaChange}
    />
    <SettingsCustomThemeInput
      label="选中文字颜色"
      attribute="selectionFontColor"
      values={customTheme.selectionFontColor}
      on:color={handleColorChange}
      on:alpha={handleAlphaChange}
    />
    <SettingsCustomThemeInput
      label="超链接颜色"
      attribute="linkColor"
      values={customTheme.linkColor}
      on:color={handleColorChange}
      on:alpha={handleAlphaChange}
    />
  </div>
  <div class="mt-4 flex flex-wrap justify-end gap-2">
    {#if isCustom}
      <button
        class="settings-btn"
        style="border-color:var(--danger-color);color:var(--danger-color);"
        on:click={handleDelete}
      >
        删除
        <Ripple />
      </button>
    {:else}
      <button
        class="settings-btn"
        title="还原为内置主题的初始颜色"
        on:click={handleReset}
      >
        还原默认
        <Ripple />
      </button>
    {/if}
    <button
      class="settings-btn"
      on:click={() => dispatch('close')}
    >
      关闭
      <Ripple />
    </button>
    <button
      class="settings-btn"
      style="background-color: var(--button-selected); border-color: var(--button-border, var(--button-selected)); color: var(--menu-foreground);"
      on:click={handleSave}
    >
      保存
      <Ripple />
    </button>
  </div>
</div>
