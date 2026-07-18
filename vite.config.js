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
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion)
  },
  build: {
    minify: false,
    cssMinify: false
  },
  ssr: {
    // https://github.com/FortAwesome/Font-Awesome/issues/18677
    noExternal: ['@fortawesome/*', '@popperjs/*']
  },
  experimental: {
    prebundleSvelteLibraries: true
  }
};

export default config;
