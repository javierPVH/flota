import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Front de conductores (internet). Puerto 5175 (¡5174 lo ocupa otra app del equipo!). Habla con el back por cookies
// de sesión + CSRF, que exigen MISMO ORIGEN: en dev, vite hace de proxy hacia
// Django (patrón de list) y el cliente http usa rutas relativas
// (VITE_BACKEND_BASE_URL vacío). En producción sirve el mismo dominio (nginx).
const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000'
const proxy = {
  '/api': { target: proxyTarget, changeOrigin: false, secure: false },
  '/media': { target: proxyTarget, changeOrigin: false, secure: false },
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5175, proxy },
  preview: { port: 5175, proxy },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
