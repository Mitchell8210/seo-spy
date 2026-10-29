import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': { target: process.env.BACKEND_LAB_API_TARGET ?? 'http://127.0.0.1:3001', changeOrigin: false } },
  },
  preview: {
    proxy: { '/api': { target: process.env.BACKEND_LAB_API_TARGET ?? 'http://127.0.0.1:3001', changeOrigin: false } },
  },
})
