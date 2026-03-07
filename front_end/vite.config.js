import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

function serveAndBundleLive2dCore() {
  const publicPath = '/live2d/core/live2dcubismcore.js';
  const sourcePath = path.resolve(__dirname, './src/live2d/core/live2dcubismcore.js');

  return {
    name: 'serve-and-bundle-live2d-core',
    configureServer(server) {
      server.middlewares.use(publicPath, async (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          next();
          return;
        }

        try {
          const source = await readFile(sourcePath);
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.end(source);
        } catch (error) {
          next(error);
        }
      });
    },
    async generateBundle() {
      const source = await readFile(sourcePath);
      this.emitFile({
        type: 'asset',
        fileName: 'live2d/core/live2dcubismcore.js',
        source,
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), serveAndBundleLive2dCore()],
  define: { 'process.env': {} },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@framework': path.resolve(__dirname, './src/live2d/framework/src'),
    },
    extensions: ['.js', '.json', '.jsx', '.mjs', '.ts', '.tsx'],
  },
  optimizeDeps: {
    exclude: ['live2dcubismcore'],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/chat': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
