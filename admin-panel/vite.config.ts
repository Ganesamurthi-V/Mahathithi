import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Windows (Hyper-V/WSL) reserves shifting blocks of TCP ports and binding one
    // fails with EACCES. 5173 and then 4173 both ended up inside a reserved block.
    // If this one is ever hit too, run `netsh interface ipv4 show excludedportrange
    // protocol=tcp` and pick a port outside every range, or reserve this one for good
    // from an Administrator shell:
    //   netsh int ipv4 add excludedportrange protocol=tcp startport=5175 numberofports=1
    port: 5175,
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
