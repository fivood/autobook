<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import DomainHint from '$lib/components/domain-hint.svelte';
  import OcrMiniStatus from '$lib/components/ocr-mini-status.svelte';
  import UpdateDialog from '$lib/components/updater/update-dialog.svelte';
  import { basePath, clearConsoleOnReload, isTauri, pagePath } from '$lib/data/env';
  import { dialogManager, type Dialog } from '$lib/data/dialog-manager';
  import { checkForUpdate } from '$lib/functions/updater/check-for-update';
  import { goto } from '$app/navigation';
  import {
    customThemes$,
    pendingLaunchFiles$,
    syncEnabled$,
    syncToken$,
    theme$,
    ttsShortcut$,
    ttsToggleRequest$
  } from '$lib/data/store';
  import { startSyncLoop } from '$lib/data/sync/sync-manager';
  import { availableThemes } from '$lib/data/theme-option';
  import { userFontsCacheName, type UserFont } from '$lib/data/fonts';
  import { fontFamilyGroupOne$, isOnline$, userFonts$ } from '$lib/data/store';
  import { dummyFn, isMobile, isMobile$ } from '$lib/functions/utils';
  import { MetaTags } from 'svelte-meta-tags';
  import '../app.scss';

  let path = '';
  let dialogs: Dialog[] = [];
  let clickOnCloseDisabled = false;
  let zIndex = '';

  $: if (browser) {
    isMobile$.next(isMobile(window));
    addUserFonts($userFonts$);
  }

  $: if (browser) {
    const fallback =
      availableThemes.get('sage-green-theme') || availableThemes.get('light-theme') || {};
    const picked = $customThemes$[$theme$] || availableThemes.get($theme$) || fallback;
    // Merge so legacy custom themes (missing menu/button/link fields) still resolve correctly.
    const theme = { ...fallback, ...picked } as Record<string, string>;
    const s = document.documentElement.style;
    const setVar = (name: string, val: string | undefined, def?: string) => {
      s.setProperty(name, val || def || '');
    };
    setVar('--background-color', theme.backgroundColor, '#f0efe6');
    setVar('--font-color', theme.fontColor, '#405a5c');
    setVar('--menu-background', theme.menuBackgroundColor, '#2b5a69');
    setVar('--menu-foreground', theme.menuFontColor, '#f0efe6');
    setVar('--button-selected', theme.buttonSelectedColor, '#2b5a69');
    setVar('--button-border', (theme as any).buttonBorderColor, theme.buttonSelectedColor); // optional/legacy theme key not on the Theme type
    setVar('--button-hover', theme.buttonHoverColor, 'rgba(95,126,123,0.18)');
    setVar('--selection-background', theme.selectionBackgroundColor, '#5f7e7b');
    setVar('--selection-foreground', theme.selectionFontColor, '#f0efe6');
    setVar('--link-color', theme.linkColor, '#2b5a69');
  }

  if (clearConsoleOnReload && import.meta.hot) {
    // eslint-disable-next-line no-console
    import.meta.hot.on('vite:beforeUpdate', () => console.clear());
  }

  function addUserFonts(userFonts: UserFont[]) {
    let styleContent = '';

    for (let index = 0, { length } = userFonts; index < length; index += 1) {
      const userFont = userFonts[index];
      const ext = userFont.fileName.split('.').pop() || '';

      let format = '';

      switch (ext) {
        case 'otf':
          format = 'opentype';
          break;
        case 'ttf':
          format = 'truetype';
          break;
        default:
          format = ext;
          break;
      }

      styleContent += `@font-face{font-family: '${userFont.name}';font-style: normal;font-weight: 400;font-display: swap;src: local(''), url('${userFont.path}') format('${format}')}\n`;
    }

    let styleElement = document.getElementById(userFontsCacheName);

    if (!styleContent) {
      styleElement?.remove();
      return;
    }

    const textNode = document.createTextNode(styleContent);

    if (styleElement) {
      styleElement.replaceChild(textNode, styleElement.childNodes[0]);
    } else {
      styleElement = document.createElement('style');
      styleElement.id = userFontsCacheName;

      styleElement.appendChild(textNode);
      document.head.append(styleElement);
    }
  }

  function closeAllDialogs() {
    dialogManager.dialogs$.next([]);
    clickOnCloseDisabled = false;
    zIndex = '';
  }

  dialogManager.dialogs$.subscribe((d) => {
    clickOnCloseDisabled = d[0]?.disableCloseOnClick ?? false;
    zIndex = d[0]?.zIndex ?? '';
    dialogs = d;
  });

  page.subscribe((p) => (path = p.url.pathname));

  onMount(async () => {
    if (browser && syncEnabled$.getValue() && syncToken$.getValue()) {
      startSyncLoop();
    }
    if (!isTauri()) return;

    // Books opened via file association / CLI: queue paths and land on the
    // manager, which performs the actual import.
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      const queueLaunchFiles = (paths: string[]) => {
        if (!paths?.length) return;
        pendingLaunchFiles$.next([...pendingLaunchFiles$.getValue(), ...paths]);
        goto(`${pagePath}/manage`);
      };

      queueLaunchFiles(await invoke<string[]>('take_launch_files'));
      listen<string[]>('open-files', (event) => queueLaunchFiles(event.payload));

      // Tray + global shortcut fan into the same store; per-page handlers
      // subscribe and act when they can (e.g. /b toggles TTS).
      listen('tts-toggle', () => ttsToggleRequest$.next(Date.now()));

      // Apply current shortcut, then keep it in sync with user changes.
      const applyShortcut = (accel: string) =>
        invoke('set_tts_shortcut', { accelerator: accel }).catch((err) =>
          console.warn('[tts-shortcut] register failed:', err)
        );
      applyShortcut(ttsShortcut$.getValue());
      ttsShortcut$.subscribe(applyShortcut);
    } catch (err) {
      console.warn('[launch-files] init failed:', err);
    }

    try {
      const update = await checkForUpdate();
      if (update) {
        dialogManager.dialogs$.next([
          { component: UpdateDialog, props: { update } }
        ]);
      }
    } catch (err) {
      // silent — no banner on check failure
      console.warn('[updater] check failed:', err);
    }
  });
</script>

<svelte:window bind:online={$isOnline$} />

<MetaTags
  title="AutoBook"
  description="本地化电子书阅读器，支持自动打字机播放、本地文件存储与桌面端自动更新"
  canonical="{basePath}{path !== '/' ? path : ''}"
  openGraph={{
    type: 'website',
    images: [
      {
        url: `${basePath}/icons/regular-icon@512x512.png`,
        width: 512,
        height: 512
      }
    ]
  }}
/>

<slot />

<OcrMiniStatus />

{#if dialogs.length > 0}
  <div class="writing-horizontal-tb fixed inset-0 z-50 h-full w-full" style:z-index={zIndex}>
    <div
      tabindex="0"
      role="button"
      class="tap-highlight-transparent absolute inset-0 bg-black/[.32]"
      on:click={() => {
        if (!clickOnCloseDisabled) {
          closeAllDialogs();
        }
      }}
      on:keyup={dummyFn}
    />

    <div
      class="relative top-[38%] left-1/2 inline-block max-w-[80vw] -translate-x-1/2 -translate-y-1/2"
    >
      {#each dialogs as dialog}
        {#if typeof dialog.component === 'string'}
          {@html dialog.component}
        {:else}
          <svelte:component this={dialog.component} {...dialog.props} on:close={closeAllDialogs} />
        {/if}
      {/each}
    </div>
  </div>
{/if}

<span style={`font-family: ${$fontFamilyGroupOne$ || 'Noto Serif JP'}`} />

<DomainHint />
