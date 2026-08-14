import adapter from '@sveltejs/adapter-static';
import preprocess from 'svelte-preprocess';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: {
    immutable: true
  },

  // Consult https://github.com/sveltejs/svelte-preprocess
  // for more information about preprocessors
  preprocess: [
    preprocess({
      postcss: true
    })
  ],

  kit: {
    adapter: adapter({
      fallback: '404.html'
    }),

    // Books are untrusted HTML rendered inside a webview that can reach the
    // filesystem and the Tauri IPC bridge, so the app ships a real CSP.
    // `script-src` deliberately has no 'unsafe-inline': hashes cover
    // SvelteKit's own bootstrap script and nothing else, which is what stops
    // an `onerror=` handler smuggled inside an EPUB from running.
    //
    // `connect-src` stays wide because the AI provider base URL and the custom
    // TTS endpoint are user-configured (OpenAI, OpenRouter, a LAN box, Ollama
    // on localhost); blocking script execution is the defense that matters.
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ['self'],
        'script-src': ['self', 'wasm-unsafe-eval'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': ['self', 'blob:', 'data:'],
        'font-src': ['self', 'data:'],
        'media-src': ['self', 'blob:', 'data:'],
        'worker-src': ['self', 'blob:'],
        'child-src': ['self', 'blob:'],
        'connect-src': ['self', 'https:', 'http://localhost:*', 'http://127.0.0.1:*', 'blob:', 'data:', 'ipc:', 'http://ipc.localhost'],
        'object-src': ['none'],
        'frame-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['none']
      }
    },
    paths: {
      base: process.env.BASE_PATH || ''
    }
  }
};

export default config;
