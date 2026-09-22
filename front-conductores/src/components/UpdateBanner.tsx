import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

import { useLang } from '../i18n.tsx'
import { applyUpdate, onUpdateAvailable } from '../sw-update.ts'

/**
 * BG5: hay un service worker nuevo esperando → ofrecer recargar.
 *
 * Vive en `App`, por encima de las rutas, y no en el `Layout`: el Layout
 * solo existe con sesión, así que un cliente que salía justo después de un
 * despliegue aterrizaba en el login del código VIEJO sin que nadie le
 * dijera que había uno nuevo, y desde ahí no había forma de enterarse hasta
 * cerrar la app del todo.
 */
export function UpdateBanner() {
  const { t } = useLang()
  const [hasUpdate, setHasUpdate] = useState(false)
  useEffect(() => onUpdateAvailable(setHasUpdate), [])
  if (!hasUpdate) return null
  return (
    <button type="button" className="offline-banner update-banner" onClick={applyUpdate}>
      <RefreshCw size={16} aria-hidden />
      {t.shell.updateAvailable}
    </button>
  )
}
