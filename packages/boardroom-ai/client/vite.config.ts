import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'client',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  optimizeDeps: {
    include: ['@boardroom/shared'],
  },
  build: {
    commonjsOptions: {
      include: [/shared/, /node_modules/],
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'd3': ['d3-force', 'd3-selection', 'd3-zoom'],
          'vendor': ['react', 'react-dom', 'react-router-dom', 'zustand'],
        },
      },
    },
  },
});
