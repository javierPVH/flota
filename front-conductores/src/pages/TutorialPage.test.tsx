import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import type { Role } from '../types.ts'
import { TutorialPage } from './TutorialPage.tsx'

// Quién mira: sin sesión (desde el login) o con sus roles.
let roles: Role[] | null = null
vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: roles ? { id: 7, username: 'carlos', roles } : null }),
}))

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname + loc.search}</p>
}

function renderAt(url: string | { pathname: string; search?: string; state?: unknown }) {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/ayuda" element={<TutorialPage />} />
          <Route path="/ayuda/:capitulo" element={<TutorialPage />} />
          <Route path="/" element={<p>pantalla-inicio</p>} />
          <Route path="/login" element={<p>pantalla-login</p>} />
          <Route path="/registrar" element={<p>pantalla-km</p>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </LanguageProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  roles = null
})

describe('TutorialPage', () => {
  it('sin capítulo pinta la portada, las tareas y el índice por grupos', () => {
    renderAt('/ayuda')
    expect(screen.getByRole('heading', { level: 1, name: 'Manual de Flota' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Comunicar una avería' })).toHaveAttribute('href', '/ayuda/incidencia')
    const index = screen.getByRole('navigation', { name: 'Capítulos de la ayuda' })
    for (const group of ['Primeros pasos', 'Tu coche', 'Si pasa algo', 'Papeles y avisos', 'Otros']) {
      expect(within(index).getByRole('heading', { name: group })).toBeInTheDocument()
    }
    // Sin sesión no se sabe si supervisa: lo de supervisores no sale.
    expect(within(index).queryByRole('heading', { name: 'Si supervisas' })).toBeNull()
    // ITV y mantenimiento, cada uno en su capítulo.
    expect(within(index).getByRole('link', { name: /^ITV/ })).toHaveAttribute('href', '/ayuda/itv')
    expect(within(index).getByRole('link', { name: /^Mantenimiento/ })).toHaveAttribute('href', '/ayuda/mantenimiento')
  })

  it('sin sesión desde el login: se ve todo y «Volver» regresa al login', async () => {
    renderAt('/ayuda/entrar')
    expect(screen.getByRole('heading', { level: 2, name: 'Entrar en la app' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Volver a la ayuda' }))
    await userEvent.click(screen.getByRole('button', { name: 'Volver a la app' }))
    expect(screen.getByText('pantalla-login')).toBeInTheDocument()
  })

  it('un conductor no ve «Tu flota», ni por enlace', () => {
    roles = ['driver']
    renderAt('/ayuda')
    const index = screen.getByRole('navigation', { name: 'Capítulos de la ayuda' })
    expect(within(index).queryByRole('link', { name: /Tu flota/ })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('un conductor que abre «Tu flota» por enlace acaba en la portada', () => {
    roles = ['driver']
    renderAt('/ayuda/flota')
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/ayuda$/)
  })

  it('«Conoce la pantalla»: el supervisor lo ve en dos pestañas; el conductor, solo lo suyo', async () => {
    roles = ['driver', 'supervisor']
    const sup = renderAt('/ayuda/pantalla')
    expect(screen.getByRole('tab', { name: 'Conductores' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'Supervisores' }))
    expect(screen.getByRole('heading', { name: 'Si supervisas' })).toBeInTheDocument()
    sup.unmount()
    roles = ['driver']
    renderAt('/ayuda/pantalla')
    expect(screen.queryByRole('tab', { name: /Conductores|Supervisores/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Si conduces' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Si supervisas' })).toBeNull()
  })

  it('en «Documentos», los pasos de subir van juntos en una pestaña, con sus subpasos', async () => {
    renderAt('/ayuda/documentos?paso=3')
    expect(screen.getByRole('tab', { name: /Subir/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('tab', { name: /Subir/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Tipo/, pressed: true })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Notas/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/ayuda/documentos?paso=5')
  })

  it('un supervisor ve «Tu flota» sin pedirlo', () => {
    roles = ['supervisor']
    renderAt('/ayuda')
    expect(screen.getByRole('link', { name: /Tu flota/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('desde el «?» de la cabecera se vuelve a la pantalla de origen', async () => {
    roles = ['driver']
    renderAt({ pathname: '/ayuda/km', state: { from: '/registrar' } })
    await userEvent.click(screen.getByRole('button', { name: 'Volver a la app' }))
    expect(screen.getByText('pantalla-km')).toBeInTheDocument()
  })

  it('los rótulos de la barra salen de la copia de la app', () => {
    renderAt('/ayuda/km')
    const chip = screen.getByText('Km', { selector: '.tut-ui' })
    expect(chip.closest('li')).toHaveTextContent(/^Toca Km en la barra de abajo/)
  })

  it('?paso=N abre esa pestaña del recorrido y «Continuar» avanza la URL', async () => {
    renderAt('/ayuda/accidente?paso=3')
    expect(screen.getByRole('tab', { name: /Implicados/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Paso 3 de 5')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(screen.getByRole('tab', { name: /Atestado/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('where')).toHaveTextContent('/ayuda/accidente?paso=4')
  })

  it('la guía rápida abre su paso', async () => {
    renderAt('/ayuda/documentos')
    await userEvent.click(screen.getByRole('button', { name: 'Pedir acceso' }))
    expect(screen.getByRole('tab', { name: /Pedir acceso/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('deslizar el panel cambia de paso', async () => {
    const { fireEvent } = await import('@testing-library/react')
    renderAt('/ayuda/incidencia')
    const panel = screen.getByRole('tabpanel')
    fireEvent.touchStart(panel, { touches: [{ clientX: 300, clientY: 100 }] })
    fireEvent.touchEnd(panel, { changedTouches: [{ clientX: 100, clientY: 110 }] })
    expect(screen.getByRole('tab', { name: /Disponibilidad/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('una galería enseña una captura cada vez', async () => {
    renderAt('/ayuda/incidencia')
    expect(screen.getByRole('img', { name: 'Pestaña Incidencia con una avería' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Neumáticos' }))
    expect(screen.getByRole('img', { name: 'Pestaña Incidencia con cambio de neumáticos' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Pestaña Incidencia con una avería' })).toBeNull()
  })

  it('el buscador encuentra sin acentos y exige todas las palabras', async () => {
    renderAt('/ayuda')
    const search = screen.getByRole('searchbox', { name: 'Buscar en la ayuda' })
    await userEvent.type(search, 'poliza tercero')
    expect(screen.getAllByRole('link').some((a) => a.getAttribute('href')?.startsWith('/ayuda/accidente'))).toBe(true)
    await userEvent.clear(search)
    await userEvent.type(search, 'poliza zzzz')
    expect(screen.getByText('Nada coincide con «poliza zzzz».')).toBeInTheDocument()
    await userEvent.type(search, '{Escape}')
    expect(search).toHaveValue('')
  })

  it('un enlace [[id]] lleva a ese capítulo', async () => {
    renderAt('/ayuda/incidencia')
    const link = screen.getAllByRole('link', { name: 'Parte de accidente' }).find((a) => a.classList.contains('tut-xref'))!
    await userEvent.click(link)
    expect(screen.getByRole('heading', { level: 2, name: 'Parte de accidente' })).toBeInTheDocument()
  })

  it('«Preguntas frecuentes» junta también las dudas de cada capítulo', () => {
    renderAt('/ayuda/preguntas')
    expect(screen.getByRole('heading', { name: 'Más dudas, por capítulo' })).toBeInTheDocument()
    expect(screen.getByText('El otro conductor no quiere firmar el parte amistoso')).toBeInTheDocument()
  })

  it('la isla de arriba pasa de capítulo con las flechas y su nombre abre el desplegable', async () => {
    renderAt('/ayuda/pantalla')
    expect(screen.getByRole('button', { name: /Tutoriales:\s*Conoce la pantalla/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('link', { name: 'Anterior: Entrar en la app' })).toHaveAttribute('href', '/ayuda/entrar')
    await userEvent.click(screen.getByRole('link', { name: 'Siguiente: Registrar los km' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/ayuda/km')
    await userEvent.click(screen.getByRole('button', { name: /Tutoriales:\s*Registrar los km/ }))
    await userEvent.click(screen.getByRole('link', { name: 'Parte de accidente' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Parte de accidente' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Todos los tutoriales' })).toBeNull()
  })

  it('en un capítulo, el buscador va en el desplegable de la isla y filtra por título', async () => {
    renderAt('/ayuda/km')
    expect(screen.queryByRole('searchbox')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Tutoriales:/ }))
    const search = screen.getByRole('searchbox', { name: 'Buscar en la ayuda' })
    await userEvent.type(search, 'accidente')
    expect(screen.getByRole('link', { name: 'Parte de accidente' })).toHaveAttribute('href', '/ayuda/accidente')
    expect(screen.queryByRole('link', { name: 'Registrar los km' })).toBeNull()
    // Solo títulos: lo que dice el contenido no cuenta.
    await userEvent.clear(search)
    await userEvent.type(search, 'poliza tercero')
    expect(screen.getByText('Nada coincide con «poliza tercero».')).toBeInTheDocument()
    await userEvent.clear(search)
    await userEvent.type(search, 'zzzz')
    expect(screen.getByText('Nada coincide con «zzzz».')).toBeInTheDocument()
  })

  it('la portada ofrece seguir donde lo dejaste', () => {
    renderAt('/ayuda/combustible').unmount()
    renderAt('/ayuda')
    expect(screen.getByRole('link', { name: /Seguir donde lo dejaste\s+Anotar el consumo/ })).toHaveAttribute(
      'href',
      '/ayuda/combustible',
    )
  })

  it('el vídeo no se descarga solo, y va sin la lista de escenas', () => {
    renderAt('/ayuda/video')
    const video = document.querySelector('video')!
    expect(video).toHaveAttribute('preload', 'none')
    expect(screen.queryByText('Qué sale en el vídeo')).toBeNull()
  })

  it('en inglés cambia la copia', async () => {
    localStorage.setItem('gs_base_lang', 'en')
    renderAt('/ayuda/km')
    expect(screen.getByRole('heading', { level: 2, name: 'Log your km' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Tutorials:/ }))
    expect(screen.getByRole('searchbox', { name: 'Search the help' })).toBeInTheDocument()
  })
})
