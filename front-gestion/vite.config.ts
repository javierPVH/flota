import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Front de gestión (VPN). Puerto 5173. Habla con el back por cookies de sesión
// + CSRF, que exigen MISMO ORIGEN: en dev, vite hace de proxy hacia Django
// (patrón de list) y el cliente http usa rutas relativas (VITE_BACKEND_BASE_URL
// vacío). En producción sirve el mismo dominio (nginx).
//
// A dónde proxya /api,/admin,/media,/static (el puerto del `runserver` de Django).
// Se toma, por orden: `VITE_PROXY_TARGET` de un `.env.local` (o del entorno) →
// default 127.0.0.1:8000. loadEnv() incluye también las VITE_* de process.env,
// así que `$env:VITE_PROXY_TARGET=...` en la terminal sigue funcionando.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000'
  const proxy = {
    '/api': { target: proxyTarget, changeOrigin: false, secure: false },
    '/media': { target: proxyTarget, changeOrigin: false, secure: false },
    '/admin': { target: proxyTarget, changeOrigin: false, secure: false },
    '/static': { target: proxyTarget, changeOrigin: false, secure: false },
  }

  return {
    plugins: [react()],
    server: { port: 5173, proxy },
    preview: { port: 5173, proxy },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
  }
})
