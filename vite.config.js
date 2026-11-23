import dns from 'dns';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';

const nodeVersion = Number.parseInt(process.versions.node.match(/^(\d+)\./)?.[1] || '17', 10);

if (nodeVersion < 17) {
  dns.setDefaultResultOrder('verbatim');
}

// Read package.json version at config-load time and inject as a compile-time
// constant. Avoids a runtime `import '../../../package.json'`, which Vite dev
// refuses to serve because package.json sits outside server.fs.allow.
const pkgVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')
).version;

/** @type {import('vite').UserConfig} */
const config = {
  plugins: [sveltekit()],
  // 5173 gets held by NetEase HYPERS on some Windows setups; move to a port
  // outside common third-party ranges and lock it so any mismatch with
  // tauri.conf.json's devUrl fails loud instead of silently 404-ing.
  server: {
    port: 5281,
    strictPort: true
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion)
  },
  build: {
    minify: false,
    cssMinify: false
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler'
      }
    }
  },
  ssr: {
    // https://github.com/FortAwesome/Font-Awesome/issues/18677
    noExternal: ['@fortawesome/*', '@popperjs/*']
  },
  // Reached only through dynamic import, so Vite discovers them on first use,
  // re-optimizes and reloads the page — mid-import, which dropped half of a
  // batch import (and the first smoke run after a lockfile change).
  optimizeDeps: {
    include: ['pdfjs-dist', 'fast-xml-parser', 'kokoro-js', 'ua-parser-js']
  },
  experimental: {
    prebundleSvelteLibraries: true
  }
};

export default config;
