import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri uses port 5173 for dev. Production build outputs to dist/ which Tauri bundles.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: false,
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 5173,
    },
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    target: ['es2021', 'chrome105', 'safari13'],
    minify: 'esbuild',
    sourcemap: false,
    outDir: 'dist',
  },
});
