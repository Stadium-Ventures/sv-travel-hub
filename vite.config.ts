import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // Pre-bundle leaflet so the first switch to the Map tab in dev doesn't
    // spend 10–20s transforming the module on-demand.
    include: ['leaflet'],
  },
})
