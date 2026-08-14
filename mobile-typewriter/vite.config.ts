import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5174,
    // src/lib/sync-client.ts re-exports the repo-level shared/sync-protocol.ts,
    // which sits above this project's root.
    fs: { allow: ['..'] }
  }
});
