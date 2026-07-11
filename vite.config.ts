import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'HIVA Medichat',
        short_name: 'HIVA',
        description: 'Intelligence. Connected. Trusted.',
        theme_color: '#163A28',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: './index.html',
        scope: '.',
        icons: [
          { src: './icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 // 5MB
      }
    }),
    {
      name: 'wasm-content-type',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
          }
          next();
        });
      },
    }
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'es2020',
    minify: 'terser',
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/__tests__/setup.ts',
    alias: {
      '@capacitor/core': path.resolve(__dirname, './src/__mocks__/@capacitor/core.ts'),
      '@capacitor/filesystem': path.resolve(__dirname, './src/__mocks__/@capacitor/filesystem.ts'),
      '@capacitor/network': path.resolve(__dirname, './src/__mocks__/@capacitor/network.ts'),
    },
  },
});
