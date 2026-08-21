import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vitest/config'
import { loadEnv } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

/** BG5: estampa un id de build único en dist/sw.js (versiona la caché del SW).
 * sw.js vive en public/ (Vite lo copia tal cual), así que el reemplazo se hace
 * al cerrar el bundle. */
function stampServiceWorker(): Plugin {
  return {
    name: 'stamp-sw-build-id',
    apply: 'build',
    closeBundle() {
      const path = resolve(__dirname, 'dist/sw.js')
      try {
        const source = readFileSync(path, 'utf8')
        writeFileSync(path, source.replaceAll('__BUILD_ID__', Date.now().toString(36)))
      } catch {
        // Sin dist/sw.js (p. ej. build de librería) no hay nada que estampar.
      }
    },
  }
}

// Front de conductores (internet). Puerto 5175 (¡5174 lo ocupa otra app del equipo!). Habla con el back por cookies
// de sesión + CSRF, que exigen MISMO ORIGEN: en dev, vite hace de proxy hacia
// Django (patrón de list) y el cliente http usa rutas relativas
// (VITE_BACKEND_BASE_URL vacío). En producción sirve el mismo dominio (nginx).
//
// A dónde proxya /api,/media (el puerto del `runserver` de Django). Se toma, por
// orden: `VITE_PROXY_TARGET` de un `.env.local` (o del entorno) → default
// 127.0.0.1:8000. Igual que en gestión: con `process.env` a secas el
// `.env.local` se ignoraba y el front se quedaba sin back (login sin selector).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000'
  const proxy = {
    '/api': { target: proxyTarget, changeOrigin: false, secure: false },
    '/media': { target: proxyTarget, changeOrigin: false, secure: false },
  }

  return {
    // Compilador de React (mismo montaje que el DS en front/vite.config.ts).
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      stampServiceWorker(),
    ],
    server: { port: 5175, proxy },
    preview: { port: 5175, proxy },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
  }
})
