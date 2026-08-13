<script lang="ts">
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import SettingsCustomThemeInput from '$lib/components/settings/settings-custom-theme-input.svelte';
  import { customThemes$, theme$ } from '$lib/data/store';
  import { availableThemes, type CustomThemeValue, type ThemeOption } from '$lib/data/theme-option';
  import { createEventDispatcher, onMount } from 'svelte';

  export let selectedTheme: string;
  export let existingThemes: ToggleOption<string>[] = [];

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

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

  let themeToCopy = existingThemes.find((t) => t.id === $theme$)?.id || existingThemes[0].id;
  let themeName = '';
  let themeNameElm: HTMLInputElement;

  $: themeStyle = `color: ${customTheme.fontColor.rgbaExpression}; background-color: ${customTheme.backgroundColor.rgbaExpression}`;

  onMount(() => {
    if (selectedTheme) {
      // Load from custom themes first; fall back to built-in so editing a built-in
      // theme pre-fills the dialog with its actual colors.
      const existingThemeObject =
        $customThemes$[selectedTheme] || availableThemes.get(selectedTheme);

      if (existingThemeObject) {
        customTheme = getThemeData(existingThemeObject);
        themeName = selectedTheme;
        return;
      }
    }

    // New theme: pre-fill from the current active theme so the dialog starts
    // from a coherent palette instead of all white.
    const seed = $customThemes$[$theme$] || availableThemes.get($theme$) || availableThemes.get('sage-green-theme');
    if (seed) {
      customTheme = getThemeData(seed);
    }
  });

  function getThemeData(referenceObject: ThemeOption): Record<keyof ThemeOption, CustomThemeValue> {
    // Start from the default skeleton so legacy themes missing the new
    // menu/button/selection/link fields don't leave undefined slots.
    const result: any = {
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
    const entries = [...Object.entries(referenceObject)];

    for (let index = 0, { length } = entries; index < length; index += 1) {
      const [key, value] = entries[index];
      if (typeof value !== 'string') continue;
      const [r, g, b, a] = (value.match(/rgba\((.+)\)/)?.[1] || '0,0,0,1')
        .split(',')
        .map((x: string) => parseFloat(x.trim()));

      result[key as keyof ThemeOption] = {
        hexExpression: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b
          .toString(16)
          .padStart(2, '0')}`,
        alphaValue: a,
        rgbaExpression: value
      };
    }

    return result;
  }

  function handleCopyTheme() {
    copyTheme(availableThemes.get(themeToCopy) || $customThemes$[themeToCopy]);
  }

  function handleColorValueChange(
    event: CustomEvent<{ attribute: keyof ThemeOption; value: string }>
  ) {
    const { attribute, value } = event.detail;
    const entry = customTheme[attribute];

    customTheme = {
      ...customTheme,
      ...{
        [attribute]: {
          hexExpression: value,
          alphaValue: entry.alphaValue,
          rgbaExpression: hexToRGB(value, entry.alphaValue)
        }
      }
    };
  }

  function handleAlphaValueChange(
    event: CustomEvent<{ attribute: keyof ThemeOption; value: number }>
  ) {
    const { attribute, value } = event.detail;
    const entry = customTheme[attribute];

    customTheme = {
      ...customTheme,
      ...{
        [attribute]: {
          hexExpression: entry.hexExpression,
          alphaValue: value,
          rgbaExpression: hexToRGB(entry.hexExpression, value)
        }
      }
    };
  }

  function handleSave() {
    themeNameElm.setCustomValidity('');

    if (!themeName) {
      themeNameElm.setCustomValidity('请输入名称！');
      themeNameElm.reportValidity();
      return;
    }

    const newTheme: any = {};
    const entries = [...Object.entries(customTheme)];

    for (let index = 0, { length } = entries; index < length; index += 1) {
      const [key, value] = entries[index];

      newTheme[key] = value.rgbaExpression;
    }

    if (selectedTheme && selectedTheme !== themeName) {
      delete $customThemes$[selectedTheme];
    }

    $customThemes$ = { ...$customThemes$, ...{ [themeName]: newTheme } };
    $theme$ = themeName;
    dispatch('close');
  }

  function copyTheme(theme: Record<keyof ThemeOption, string> | undefined) {
    if (!theme) {
      return;
    }

    customTheme = getThemeData(theme);
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
</script>

<DialogTemplate>
  <div slot="content">
    <div
      class="grid grid-cols-1 gap-2 items-center overflow-auto max-h-[60vh] sm:grid-cols-[auto_auto_5rem] sm:gap-4"
    >
      <select class="sm:col-span-2" bind:value={themeToCopy}>
        {#each existingThemes as theme (theme.id)}
          <option value={theme.id}>
            {theme.id}
          </option>
        {/each}
      </select>
      <button
        class="m-1 rounded-md border-2 p-2 text-lg transition-colors"
        style="background-color: var(--button-selected); border-color: var(--button-border, var(--button-selected)); color: var(--menu-foreground);"
        on:click={handleCopyTheme}
      >
        复制
        <Ripple />
      </button>
      <span class="hidden sm:block">属性</span>
      <span class="hidden sm:block">颜色</span>
      <span class="hidden sm:block">透明度</span>
      <SettingsCustomThemeInput
        label="正文字体色"
        attribute="fontColor"
        values={customTheme.fontColor}
        on:color={handleColorValueChange}
        on:alpha={handleAlphaValueChange}
      />
      <SettingsCustomThemeInput
        label="正文背景色"
        attribute="backgroundColor"
        values={customTheme.backgroundColor}
        on:color={handleColorValueChange}
        on:alpha={handleAlphaValueChange}
      />
      <SettingsCustomThemeInput
        label="菜单背景色"
        attribute="menuBackgroundColor"
        values={customTheme.menuBackgroundColor}
        on:color={handleColorValueChange}
        on:alpha={handleAlphaValueChange}
      />
      <SettingsCustomThemeInput
        label="菜单文字色"
        attribute="menuFontColor"
        values={customTheme.menuFontColor}
        on:color={handleColorValueChange}
        on:alpha={handleAlphaValueChange}
      />
      <SettingsCustomThemeInput
        label="按钮选中色"
        attribute="buttonSelectedColor"
        values={customTheme.buttonSelectedColor}
        on:color={handleColorValueChange}
        on:alpha={handleAlphaValueChange}
      />
      <SettingsCustomThemeInput
        label="按钮悬停色"
        attribute="buttonHoverColor"
        values={customTheme.buttonHoverColor}
        on:color={handleColorValueChange}
        on:alpha={handleAlphaValueChange}
      />
      <SettingsCustomThemeInput
        label="选中文字背景"
        attribute="selectionBackgroundColor"
        values={customTheme.selectionBackgroundColor}
        on:color={handleColorValueChange}
        on:alpha={handleAlphaValueChange}
      />
      <SettingsCustomThemeInput
        label="选中文字颜色"
        attribute="selectionFontColor"
        values={customTheme.selectionFontColor}
        on:color={handleColorValueChange}
        on:alpha={handleAlphaValueChange}
      />
      <SettingsCustomThemeInput
        label="超链接颜色"
        attribute="linkColor"
        values={customTheme.linkColor}
        on:color={handleColorValueChange}
        on:alpha={handleAlphaValueChange}
      />
      <input
        class="sm:col-span-2"
        type="text"
        placeholder="主题名称"
        bind:value={themeName}
        bind:this={themeNameElm}
      />
      <button
        class="flex justify-center items-center rounded-md border-2 border-current/40 p-2 text-lg"
        style={themeStyle}
      >
        中字
        <Ripple />
      </button>
    </div>
    <div class="flex mt-4" />
  </div>
  <div class="mt-2 flex grow justify-between" slot="footer">
    <button
      class="m-1 rounded-md border-2 border-current/20 p-2 text-lg transition-colors hover-soft"
      on:click={() => dispatch('close')}
    >
      取消
      <Ripple />
    </button>
    <button
      class="m-1 rounded-md border-2 p-2 text-lg transition-colors"
      style="background-color: var(--button-selected); border-color: var(--button-border, var(--button-selected)); color: var(--menu-foreground);"
      on:click={handleSave}
    >
      保存
      <Ripple />
    </button>
  </div>
</DialogTemplate>
