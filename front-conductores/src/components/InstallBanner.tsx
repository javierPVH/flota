import { useEffect, useState } from 'react'
import { Smartphone, X } from 'lucide-react'

import { useLang } from '../i18n.tsx'

/**
 * Aviso de instalación PWA (mejora 🟡): aparece solo cuando el navegador
 * dispara `beforeinstallprompt` (Chrome/Edge Android; iOS no lo soporta y el
 * banner simplemente no sale). Descartarlo o rechazar la instalación se
 * recuerda en localStorage para no insistir.
 */
const DISMISS_KEY = 'flota-install-dismissed'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallBanner() {
  const { t } = useLang()
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) return
    // Optional chaining: matchMedia no existe en jsdom ni en navegadores muy viejos.
    if (window.matchMedia?.('(display-mode: standalone)').matches) return
    const onPrompt = (event: Event) => {
      // Retenemos el evento para lanzarlo desde nuestro botón.
      event.preventDefault()
      setPromptEvent(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (!promptEvent) return null

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setPromptEvent(null)
  }

  async function install() {
    await promptEvent!.prompt()
    const choice = await promptEvent!.userChoice
    if (choice.outcome !== 'accepted') localStorage.setItem(DISMISS_KEY, '1')
    setPromptEvent(null)
  }

  return (
    <div className="install-banner" role="status">
      <Smartphone size={18} aria-hidden />
      <span className="install-text">{t.shell.installHint}</span>
      <button type="button" className="install-btn" onClick={() => void install()}>
        {t.shell.installAction}
      </button>
      <button
        type="button"
        className="install-close"
        aria-label={t.shell.installDismiss}
        title={t.shell.installDismiss}
        onClick={dismiss}
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  )
}
