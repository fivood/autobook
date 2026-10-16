<script lang="ts">
  import { customThemes$, theme$ } from '$lib/data/store';
  import { availableThemes } from '$lib/data/theme-option';

  // Resolve the active theme directly instead of relying on CSS variable
  // cascade — in some WebView2 contexts the inline `var(--background-color)`
  // wasn't picking up the JS-set root override, leaving dialogs white in dark
  // themes (white text on white card = invisible).
  $: resolved = (() => {
    const fallback =
      availableThemes.get('sage-green-theme') || availableThemes.get('light-theme') || ({} as any); // empty fallback if no built-in theme registered
    const picked = $customThemes$[$theme$] || availableThemes.get($theme$) || fallback;
    return { ...fallback, ...picked } as Record<string, string>;
  })();
</script>

<!--
  The host centres dialogs at `top: 38%` with a -50% translate, so anything
  taller than 76vh pushes its own top edge off-screen — and nothing here
  scrolled, which made the header unreachable once a dialog grew (expanding the
  manual entry form's book-info section was enough). Capping at 72vh keeps the
  top edge on screen at 2vh in the worst case, and only the content scrolls so
  the title and the buttons stay put.
-->
<section
  role="dialog"
  aria-modal="true"
  class="mdc-elevation--z24 flex max-h-[72vh] flex-col rounded p-6"
  style="background-color: {resolved.backgroundColor || '#fff'}; color: {resolved.fontColor || '#000'};"
>
  <h2 class="weight-medium mb-5 shrink-0 text-xl"><slot name="header" /></h2>
  <div class="min-h-0 flex-1 overflow-y-auto"><slot name="content" /></div>
  <footer class="flex shrink-0 flex-wrap items-center justify-end pt-5">
    <slot name="footer" />
  </footer>
</section>
