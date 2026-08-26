import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8011', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8011', ws: true },
      '/health': { target: 'http://127.0.0.1:8011', changeOrigin: true },
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        // Keep the 3D stack out of the initial parse so the command center
        // paints before the renderer is ready.
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
          charts: ['echarts'],
        },
      },
    },
  },
})
