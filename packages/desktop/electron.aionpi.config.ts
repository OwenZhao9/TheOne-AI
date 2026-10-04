import { defineConfig } from 'electron-vite';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import UnoCSS from 'unocss/vite';
import unoConfig from '../../uno.config';

const alias = {
  '@': resolve('packages/desktop/src'),
  '@renderer': resolve('packages/desktop/src/renderer'),
  '@process': resolve('packages/desktop/src/process'),
};
export default defineConfig({
  main: {
    plugins: [
      {
        name: 'aionpi-build-mcp-servers',
        closeBundle() {
          execSync(`node "${resolve('scripts/build-mcp-servers.js')}"`, { stdio: 'inherit' });
        },
      },
    ],
    resolve: { alias },
    build: {
      externalizeDeps: { exclude: ['js-yaml'] },
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve('packages/desktop/src/process/services/pi/app.ts') },
        external: ['electron'],
      },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: { index: resolve('packages/desktop/src/preload/pi.ts') }, external: ['electron'] },
    },
  },
  renderer: {
    root: 'packages/desktop/src/renderer',
    resolve: { alias, dedupe: ['react', 'react-dom', 'react-router-dom'] },
    plugins: [UnoCSS(unoConfig)],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env.env': JSON.stringify('production'),
      'process.env.AIONUI_MULTI_INSTANCE': JSON.stringify(''),
      'process.env.SENTRY_DSN': JSON.stringify(''),
      __APP_VERSION__: JSON.stringify('2.2.2-pi.1'),
      __IS_DISCONTINUED_BUILD__: 'false',
      global: 'globalThis',
    },
    build: {
      outDir: resolve('out/renderer'),
      chunkSizeWarningLimit: 2500,
      rollupOptions: { input: resolve('packages/desktop/src/renderer/pages/PiDesktop/index.html') },
    },
  },
});
