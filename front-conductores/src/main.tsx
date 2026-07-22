import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import '@flota/ui/styles/tokens.css'
import '@flota/ui/base.css'
import './styles.css'

import App from './App.tsx'
import { AuthProvider, bootstrap, onLogout } from './auth.ts'
import { LanguageProvider } from './i18n.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <AuthProvider bootstrap={bootstrap} onLogout={onLogout}>
          <App />
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  </StrictMode>,
)

// PWA (M7): solo en producción — en dev el SW cachearía módulos de Vite.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
