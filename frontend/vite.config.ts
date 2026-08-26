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
    /*
     * Chunking is left to Rollup on purpose.
     *
     * A manualChunks group of ['three', '@react-three/fiber', '@react-three/drei']
     * looks reasonable and is not: fiber depends on react, zustand and the JSX
     * runtime, so Rollup pulls all of them into that chunk. The entry then
     * statically imports it and cannot execute until a megabyte of renderer has
     * arrived - a blank page on every cold load, worst of all on the cinematic
     * routes, which are the first thing anyone sees.
     *
     * Pinning the pieces back out by hand produced a circular chunk
     * initialisation and a dead app instead. The lazy boundaries in App.tsx
     * already put the renderer, the console and the chart stack behind dynamic
     * imports, which is the information Rollup needs to split this correctly by
     * itself. So it does.
     */
  },
})
