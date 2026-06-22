import { defineConfig } from 'vite';
import { resolve }       from 'path';

// TAURI_DEV_HOST is set by Tauri when running on a remote device / WSL
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // Prevent Vite from obscuring Rust error messages
  clearScreen: false,

  server: {
    port:       1420,
    strictPort: true,
    host:       host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: {
      // Don't watch src-tauri so Rust rebuilds don't trigger Vite
      ignored: ['**/src-tauri/**'],
    },
  },

  // Multi-page: both windows have their own HTML entry
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ui:   resolve(__dirname, 'ui.html'),
      },
    },
    // Tauri on Windows uses NSIS / WiX which can struggle with sourcemaps
    sourcemap: process.env.TAURI_ENV_DEBUG === 'true' ? 'inline' : false,
    // Tauri needs a non-module script for the main entry on some targets
    target: ['es2022', 'chrome110', 'safari16'],
    minify: process.env.TAURI_ENV_DEBUG === 'true' ? false : 'esbuild',
  },

  // Forward TAURI_ENV_* variables to the frontend
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
});