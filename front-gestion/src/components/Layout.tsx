import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Button, LanguageToggleButton } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'
import { useLang } from '../i18n.tsx'

export function Layout() {
  const { user, logout } = useAuth()
  const { language, setLanguage, t } = useLang()
  const navigate = useNavigate()

  // Atajos de teclado (G12): "/" enfoca la búsqueda de la página; "n" abre el
  // alta de vehículo. Nunca mientras se escribe en un campo.
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
      if (event.key === '/') {
        const search = document.querySelector<HTMLInputElement>('input[type="search"]')
        if (search) {
          event.preventDefault()
          search.focus()
        }
      } else if (event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey) {
        navigate('/vehiculos/nuevo')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate])

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const roles = (user?.roles ?? []).map((r) => t.shell.roles[r] ?? r).join(' · ')

  return (
    <div className="app-shell">
      <header className="app-header">
        <strong>{t.shell.brand}</strong>
        <nav aria-label="Secciones">
          <NavLink to="/" end>
            {t.shell.nav.panel}
          </NavLink>
          <NavLink to="/vehiculos">{t.shell.nav.vehicles}</NavLink>
          <NavLink to="/conductores">{t.shell.nav.drivers}</NavLink>
          <NavLink to="/propuestas">{t.shell.nav.proposals}</NavLink>
          <NavLink to="/kilometraje">{t.shell.nav.mileage}</NavLink>
          <NavLink to="/alertas">{t.shell.nav.alerts}</NavLink>
          <NavLink to="/solicitudes">{t.shell.nav.requests}</NavLink>
          <NavLink to="/facturas">{t.shell.nav.invoices}</NavLink>
          <NavLink to="/catalogos">{t.shell.nav.catalogs}</NavLink>
          <NavLink to="/incidencias">{t.shell.nav.incidents}</NavLink>
          <NavLink to="/informes">{t.shell.nav.reports}</NavLink>
        </nav>
        <div className="spacer" />
        <div className="app-user">
          <LanguageToggleButton activeLanguage={language} onChange={setLanguage} />
          <span title={t.shell.shortcutsHint}>
            {user?.first_name || user?.username}
            {roles ? ` · ${roles}` : ''}
          </span>
          <Button variant="secondary" size="sm" onClick={handleLogout}>
            {t.shell.logout}
          </Button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
