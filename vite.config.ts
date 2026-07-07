import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    // ES-module worker so the worker build can code-split. This lets the
    // ~1.2MB venueProximity dataset live in its own lazy chunk instead of
    // being inlined into BOTH the main bundle and the worker bundle.
    format: 'es',
  },
  optimizeDeps: {
    // Pre-bundle leaflet so the first switch to the Map tab in dev doesn't
    // spend 10–20s transforming the module on-demand.
    include: ['leaflet'],
  },
})
