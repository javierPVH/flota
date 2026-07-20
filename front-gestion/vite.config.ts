import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Front de gestión (VPN). Puerto 5173. Habla con el back por cookies de sesión
// + CSRF; el origen se resuelve desde VITE_BACKEND_BASE_URL (ver .env).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
})
