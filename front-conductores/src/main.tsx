import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import '@flota/ui/styles/tokens.css'
import '@flota/ui/base.css'
import './styles.css'

import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { AuthProvider, bootstrap, onLogout } from './auth.ts'
import { LanguageProvider } from './i18n.tsx'
import { requestPersistentStorage } from './offline/queue.ts'
import { registerServiceWorker } from './sw-update.ts'

// BG4: pide almacenamiento persistente — protege la cola offline (IndexedDB)
// de las purgas del navegador bajo presión de disco.
requestPersistentStorage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <LanguageProvider>
          <AuthProvider bootstrap={bootstrap} onLogout={onLogout}>
            <App />
          </AuthProvider>
        </LanguageProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)

// PWA (M7): solo en producción — en dev el SW cachearía módulos de Vite.
// BG5: el registro detecta versiones nuevas y la UI ofrece recargar.
if (import.meta.env.PROD) {
  registerServiceWorker()
}
