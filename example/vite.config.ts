// example/vite.config.ts
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  base: '/frame-msg-webbluetooth/',
  root: __dirname,
  server: {
    open: true,
  },
  build: {
    // This will output the static site to 'example/dist'
    outDir: 'dist',
  },
  resolve: {
    alias: {
      // Option A: Use built library
      //'frame-msg': path.resolve(__dirname, '../dist/frame-msg.es.js'),

      // Option B Use source code instead of built bundle
      'frame-msg': path.resolve(__dirname, '../src/index.ts'),
    },
  },
});
