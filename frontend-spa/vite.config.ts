import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      // Все запросы из SPA на /api будут идти на http://localhost (nginx),
      // а он уже проксит на backend.
      '/api': {
        target: 'http://localhost',
        changeOrigin: true
      }
    }
  }
})
