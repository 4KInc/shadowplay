/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, type Plugin } from 'vite';

/**
 * Serve MediaPipe's hand-tracking runtime from our own origin at
 * /vendor/mediapipe/ (from node_modules in dev, copied into the build), so
 * the family viewer's camera hands never depend on a third-party CDN.
 */
function mediapipeVendor(): Plugin {
  const source = join(process.cwd(), 'node_modules/@mediapipe/tasks-vision/wasm');
  let outDir = 'dist';
  return {
    name: 'shadowplay-mediapipe-vendor',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use('/vendor/mediapipe/', (req, res, next) => {
        const file = join(source, (req.url ?? '').split('?')[0].replace(/^\/+/, ''));
        if (!file.startsWith(source) || !existsSync(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const target = join(process.cwd(), outDir, 'vendor/mediapipe');
      mkdirSync(target, { recursive: true });
      for (const f of readdirSync(source)) copyFileSync(join(source, f), join(target, f));
    },
  };
}

export default defineConfig({
  plugins: [iwsdkDev(), mediapipeVendor()],
  server: {
    host: '0.0.0.0',
    port: 8082,
    open: false,
    // The sharing API runs as its own process in development (npm run server).
    proxy: {
      '/api': 'http://localhost:8787',
      '/live': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (three@0.185 vs app super-three@0.181). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
