import adapter from '@sveltejs/adapter-static';
import preprocess from 'svelte-preprocess';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [preprocess({ postcss: false })],
  kit: {
    adapter: adapter({
      fallback: '200.html',
      strict: true
    }),
    prerender: {
      handleHttpError: 'warn'
    }
  }
};

export default config;
