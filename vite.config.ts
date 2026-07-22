import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// В dev фронт крутится на 5173, а бэкенд с ffmpeg — на 3001.
// Прокси перенаправляет запросы API и медиа-файлов (кадры, аудио, экспорт) на бэкенд.
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
