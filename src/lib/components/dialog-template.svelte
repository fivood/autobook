<script lang="ts">
  import { customThemes$, theme$ } from '$lib/data/store';
  import { availableThemes } from '$lib/data/theme-option';

  // Resolve the active theme directly instead of relying on CSS variable
  // cascade — in some WebView2 contexts the inline `var(--background-color)`
  // wasn't picking up the JS-set root override, leaving dialogs white in dark
  // themes (white text on white card = invisible).
  $: resolved = (() => {
    const fallback =
      availableThemes.get('sage-green-theme') || availableThemes.get('light-theme') || ({} as any);
    const picked = $customThemes$[$theme$] || availableThemes.get($theme$) || fallback;
    return { ...fallback, ...picked } as Record<string, string>;
  })();
</script>

<section
  class="mdc-elevation--z24 rounded p-6"
  style="background-color: {resolved.backgroundColor || '#fff'}; color: {resolved.fontColor || '#000'};"
>
  <h2 class="weight-medium mb-5 text-xl"><slot name="header" /></h2>
  <slot name="content" />
  <footer class="flex flex-wrap items-center justify-end pt-5">
    <slot name="footer" />
  </footer>
</section>
