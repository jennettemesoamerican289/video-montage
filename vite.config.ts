import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev the frontend runs on 5173, and the ffmpeg backend on 3001.
// The proxy forwards API and media requests (frames, audio, exports) to the backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/media': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
  },
})
