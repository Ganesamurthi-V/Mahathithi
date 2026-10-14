import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 (Vite's default) falls inside a Windows-reserved TCP exclusion range
    // on this machine (Hyper-V/WSL), so binding it fails with EACCES. 4173 is
    // outside every reserved range.
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // PERF: split stable third-party libs into their own chunk so they stay
        // cached across app deploys (app code changes far more often than vendor).
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'data-vendor': ['@tanstack/react-query', 'axios'],
        },
      },
    },
  },
});
