import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Base, Modal } from '@flota/ui/ui'

import { useLang } from '../i18n.tsx'
import { AppHeader } from './AppHeader.tsx'

/** Destinos del prefijo "g" (estilo Gmail/GitHub): tecla → ruta + etiqueta
 * de la navegación (se reutilizan las de `t.shell.nav`). */
const GO_KEYS = [
  { key: 'h', path: '/', nav: 'panel' },
  { key: 'v', path: '/vehiculos', nav: 'vehicles' },
  { key: 'a', path: '/alertas', nav: 'alerts' },
  { key: 'i', path: '/incidencias', nav: 'incidents' },
  { key: 'k', path: '/kilometraje', nav: 'mileage' },
  { key: 'f', path: '/informes?tab=facturas', nav: 'invoices' },
  { key: 'c', path: '/conductores', nav: 'drivers' },
  { key: 'm', path: '/informes', nav: 'reports' },
  { key: 'j', path: '/ajustes', nav: 'settings' },
  { key: 't', path: '/ajustes/catalogos', nav: 'catalogs' },
] as const

export function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useLang()
  const [sheetOpen, setSheetOpen] = useState(false)

  // Prefijo "g" pendiente: caduca solo para que una "g" suelta no deje el
  // teclado "armado" indefinidamente.
  const goPending = useRef(false)
  const goTimer = useRef<number | undefined>(undefined)

  // Atajos de teclado (G12, ampliados): "/" busca, "n" alta de vehículo,
  // "g <letra>" navega, "?" abre la hoja de atajos. Nunca mientras se escribe.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      )
        return
      if (event.ctrlKey || event.metaKey || event.altKey) return

      const key = event.key
      if (goPending.current) {
        goPending.current = false
        window.clearTimeout(goTimer.current)
        const dest = GO_KEYS.find((g) => g.key === key.toLowerCase())
        if (dest) {
          event.preventDefault()
          setSheetOpen(false)
          navigate(dest.path)
        }
        return
      }
      if (key.toLowerCase() === 'g') {
        goPending.current = true
        window.clearTimeout(goTimer.current)
        goTimer.current = window.setTimeout(() => {
          goPending.current = false
        }, 1500)
      } else if (key === '?') {
        event.preventDefault()
        setSheetOpen((open) => !open)
      } else if (key === '/') {
        const search = document.querySelector<HTMLInputElement>('input[type="search"]')
        if (search) {
          event.preventDefault()
          search.focus()
        }
      } else if (key.toLowerCase() === 'n') {
        navigate('/vehiculos/nuevo')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(goTimer.current)
    }
  }, [navigate])

  return (
    <>
      <Base
        header={<AppHeader />}
        // `key` por ruta: fuerza a que el contenido del shell se remonte al cambiar
        // de URL. Blinda la navegación del menú (☰) ante un <Outlet> que no seguía
        // el cambio de ruta ("la URL cambiaba pero la página no se refrescaba").
        section={{ content: <Outlet key={location.pathname} /> }}
        footer={{ brand: t.shell.footerBrand, contact: t.shell.footerContact }}
      />
      <Modal open={sheetOpen} title={t.shortcuts.title} onClose={() => setSheetOpen(false)}>
        <dl className="shortcuts-list">
          <div className="shortcuts-item">
            <dt><kbd>/</kbd></dt>
            <dd>{t.shortcuts.search}</dd>
          </div>
          <div className="shortcuts-item">
            <dt><kbd>n</kbd></dt>
            <dd>{t.shortcuts.newVehicle}</dd>
          </div>
          <div className="shortcuts-item">
            <dt><kbd>?</kbd></dt>
            <dd>{t.shortcuts.help}</dd>
          </div>
        </dl>
        <h4 className="shortcuts-group">{t.shortcuts.goPrefix}</h4>
        <dl className="shortcuts-list">
          {GO_KEYS.map((g) => (
            <div className="shortcuts-item" key={g.key}>
              <dt>
                <kbd>g</kbd> <kbd>{g.key}</kbd>
              </dt>
              <dd>{t.shell.nav[g.nav]}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </>
  )
}
