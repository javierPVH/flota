import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import { Shot } from '../tutorial/Shot.tsx'
import { TutorialPage } from './TutorialPage.tsx'

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname + loc.search}</p>
}

function renderAt(url: string) {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/ayuda" element={<TutorialPage />} />
          <Route path="/ayuda/:capitulo" element={<TutorialPage />} />
          <Route path="/vehiculos" element={<p>pantalla-vehiculos</p>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </LanguageProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

describe('TutorialPage', () => {
  it('sin capítulo pinta la portada y el índice por grupos', () => {
    renderAt('/ayuda')
    expect(screen.getByRole('heading', { level: 1, name: 'Ayuda' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Bienvenida a la ayuda' })).toBeInTheDocument()
    const index = screen.getByRole('navigation', { name: 'Capítulos de la ayuda' })
    for (const group of ['Primeros pasos', 'La flota', 'Lo que pasa', 'Papeles y personas', 'Administración', 'Otros']) {
      expect(within(index).getByRole('heading', { name: group })).toBeInTheDocument()
    }
  })

  it('un capítulo que no existe cae en la portada', () => {
    renderAt('/ayuda/no-existe')
    expect(screen.getByRole('heading', { level: 2, name: 'Bienvenida a la ayuda' })).toBeInTheDocument()
  })

  it('pinta el capítulo de la URL y «Abrir esta pantalla» lleva a ella', async () => {
    renderAt('/ayuda/vehiculos')
    expect(screen.getByRole('heading', { level: 2, name: 'Vehículos' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Vehículos', current: 'page' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Abrir esta pantalla/ }))
    expect(screen.getByText('pantalla-vehiculos')).toBeInTheDocument()
  })

  it('los rótulos citados salen de la copia de la pantalla', () => {
    renderAt('/ayuda/vehiculos?paso=3')
    expect(screen.getByText(/Pulsa «Exportar CSV»/)).toBeInTheDocument()
  })

  it('?paso=N abre esa pestaña del recorrido y «Continuar» avanza la URL', async () => {
    renderAt('/ayuda/vehiculos?paso=2')
    expect(screen.getByRole('tab', { name: /Vencimientos/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Paso 2 de 4')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(screen.getByRole('tab', { name: /Listados/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('where')).toHaveTextContent('/ayuda/vehiculos?paso=3')
  })

  it('las flechas del teclado mueven el recorrido', async () => {
    renderAt('/ayuda/vehiculos')
    screen.getByRole('tab', { name: /Buscar/ }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: /Vencimientos/ })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: /Acciones/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('la guía rápida abre su paso', async () => {
    renderAt('/ayuda/vehiculos')
    await userEvent.click(screen.getByRole('button', { name: 'Sacar un listado' }))
    expect(screen.getByRole('tab', { name: /Listados/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('el buscador encuentra sin acentos y exige todas las palabras', async () => {
    renderAt('/ayuda')
    const search = screen.getByRole('searchbox', { name: 'Buscar en la ayuda' })
    await userEvent.type(search, 'vehiculos exportar')
    const link = screen.getAllByRole('link').find((a) => a.textContent?.includes('Exportar CSV'))
    expect(link).toBeTruthy()
    await userEvent.clear(search)
    await userEvent.type(search, 'exportar zzzz')
    expect(screen.getByText('Nada coincide con «exportar zzzz».')).toBeInTheDocument()
  })

  it('pinta las capturas del capítulo con su texto alternativo', () => {
    renderAt('/ayuda/entrar')
    expect(screen.getByRole('img', { name: 'La pantalla de inicio de sesión' })).toBeInTheDocument()
  })

  it('sin captura enseña «Captura pendiente» y no una imagen rota', () => {
    render(<Shot name="no-existe" alt="Algo" lang="es" pendingLabel="Captura pendiente" zoomLabel="Ampliar" />)
    expect(screen.queryAllByRole('img')).toHaveLength(0)
    expect(screen.getByText(/Captura pendiente/)).toBeInTheDocument()
  })

  it('un capítulo sin contenido aún avisa de que está en preparación', () => {
    renderAt('/ayuda/ficha')
    expect(screen.getByText(/está en preparación/)).toBeInTheDocument()
  })

  it('en inglés cambia la copia', () => {
    localStorage.setItem('gs_base_lang', 'en')
    renderAt('/ayuda/vehiculos')
    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Vehicles' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open this screen/ })).toBeInTheDocument()
  })
})
