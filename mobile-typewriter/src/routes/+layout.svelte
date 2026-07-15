<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n';

  // beforeinstallprompt fires (Chrome/Android) when the browser thinks the PWA
  // is installable. We capture it, show a small "安装" chip, and prompt on tap.
  // iOS Safari never fires it (uses manual "Add to Home Screen") — no chip there.
  interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }
  let deferredInstall: BeforeInstallPromptEvent | null = null;
  let showInstallChip = false;

  function isStandalone(): boolean {
    // navigator.standalone is iOS; the media query is everyone else.
    const nav = navigator as Navigator & { standalone?: boolean };
    return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  }

  async function promptInstall() {
    if (!deferredInstall) return;
    await deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    showInstallChip = false;
  }

  onMount(async () => {
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      try {
        await navigator.serviceWorker.register('/service-worker.js', { type: 'module' });
      } catch (err) {
        console.warn('[sw] register failed', err);
      }
    }

    if (isStandalone()) return; // already installed to home screen
    const handler = (e: Event) => {
      e.preventDefault();
      deferredInstall = e as BeforeInstallPromptEvent;
      showInstallChip = true;
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => {
      deferredInstall = null;
      showInstallChip = false;
    });
    // Listeners live for the app's lifetime (layout is a singleton); async
    // onMount can't return a teardown Svelte would honor, so no cleanup here.
  });
</script>

<slot />

{#if showInstallChip}
  <div class="install-chip">
    <button type="button" class="install-btn" on:click={promptInstall}>
      {$t('install.prompt')}
    </button>
    <button
      type="button"
      class="install-dismiss"
      on:click={() => (showInstallChip = false)}
      aria-label={$t('install.dismiss')}
    >×</button>
  </div>
{/if}

<style global>
  :root {
    --bg: #f0efe6;
    --fg: #405a5c;
    --fg-dim: rgba(64, 90, 92, 0.55);
    --accent: #5f7e7b;
    --accent-text: #f0efe6;
    --chip-bg: rgba(195, 193, 175, 0.9);
    --chip-text: #405a5c;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1d2226;
      --fg: #d4d3c5;
      --fg-dim: rgba(212, 211, 197, 0.55);
      --accent: #5f7e7b;
      --accent-text: #f0efe6;
      --chip-bg: rgba(64, 78, 80, 0.92);
      --chip-text: #d4d3c5;
    }
  }
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Serif CJK SC',
      'Microsoft YaHei', sans-serif;
    -webkit-font-smoothing: antialiased;
    overscroll-behavior: none;
  }
  :global(*) {
    box-sizing: border-box;
  }
  :global(button) {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .install-chip {
    position: fixed;
    bottom: max(1rem, env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 0.15rem;
    background: var(--chip-bg);
    color: var(--chip-text);
    padding: 0.35rem 0.35rem 0.35rem 0.85rem;
    border-radius: 999px;
    font-size: 0.85rem;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
  }
  .install-btn {
    font-weight: 600;
  }
  .install-dismiss {
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    opacity: 0.6;
    font-size: 1.1rem;
    line-height: 1;
  }
  .install-dismiss:hover {
    opacity: 1;
  }
</style>
