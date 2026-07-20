<script lang="ts">
  import { onMount } from 'svelte';

  onMount(async () => {
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      try {
        await navigator.serviceWorker.register('/service-worker.js', { type: 'module' });
      } catch (err) {
        console.warn('[sw] register failed', err);
      }
    }
  });
</script>

<slot />

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
</style>
