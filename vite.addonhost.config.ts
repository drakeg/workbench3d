// Builds the add-on host for the native Mac app (src/addonhost) as one classic script and one
// stylesheet in mac/Resources/AddOnHost, loaded from the app bundle by a WebKit view.
// npm run build:addonhost
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'mac/Resources/AddOnHost',
    emptyOutDir: false,
    lib: {
      entry: 'src/addonhost/main.ts',
      name: 'Workbench3DAddOnHost',
      formats: ['iife'],
      fileName: () => 'addonhost.js',
    },
    cssCodeSplit: false,
    rollupOptions: {
      output: { inlineDynamicImports: true, assetFileNames: 'addonhost[extname]' },
    },
    sourcemap: false,
    minify: true,
  },
});
