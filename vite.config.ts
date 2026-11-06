import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Relative base so the build works from any folder, inside the desktop app, or on GitHub Pages.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', outDir: 'dist', sourcemap: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
