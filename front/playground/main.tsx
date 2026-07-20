import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { LanguageProvider } from './demo-i18n.ts'
import { AuthProvider, demoBootstrap } from './demo-auth.ts'
import '@/styles/tokens.css'
import './styles.css'

// Punto de entrada del playground. Monta los providers de @gs/base (Fase 3):
// i18n reactivo + auth desacoplado (bootstrap inyectado).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <AuthProvider bootstrap={demoBootstrap}>
          <App />
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  </StrictMode>,
)
