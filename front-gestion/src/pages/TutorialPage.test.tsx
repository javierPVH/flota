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

function renderAt(url: string | { pathname: string; search?: string; state?: unknown }) {
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
    renderAt('/ayuda/vehiculos?paso=4')
    // Pintado como el boton que hay que buscar, sin las comillas.
    const chip = screen.getByText('Exportar CSV', { selector: '.tut-ui' })
    expect(chip.closest('li')).toHaveTextContent(/^Pulsa Exportar CSV\./)
  })

  it('la portada lleva a las tareas frecuentes y a empezar', () => {
    renderAt('/ayuda')
    expect(screen.getByRole('link', { name: /Sacar un listado/ })).toHaveAttribute('href', '/ayuda/vehiculos?paso=4')
    expect(screen.getByRole('link', { name: /Empezar por el principio/ })).toHaveAttribute('href', '/ayuda/entrar')
  })

  it('el indice marca los capitulos ya leidos y ninguno queda en «Pronto»', async () => {
    renderAt('/ayuda/vehiculos')
    const index = screen.getByRole('navigation', { name: 'Capítulos de la ayuda' })
    expect(within(index).queryByText('Pronto')).toBeNull()
    // Acordeón: solo está abierto el grupo del capítulo en el que estamos.
    expect(within(index).getByRole('button', { name: /La flota/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(index).queryByRole('link', { name: /Vista general/ })).toBeNull()
    await userEvent.click(within(index).getByRole('button', { name: /Primeros pasos/ }))
    expect(within(index).queryByRole('link', { name: /Vehículos/ })).toBeNull()
    await userEvent.click(within(index).getByRole('link', { name: /Vista general/ }))
    await userEvent.click(within(index).getByRole('button', { name: /La flota/ }))
    expect(within(index).getByRole('link', { name: /Vehículos/ }).querySelector('.tut-index-seen')).toBeTruthy()
  })

  it('desde el «?» de la cabecera se puede volver a la pantalla, también tras cambiar de paso', async () => {
    renderAt({ pathname: '/ayuda/vehiculos', state: { from: '/vehiculos' } })
    await userEvent.click(screen.getByRole('button', { name: /^Continuar/ }))
    await userEvent.click(screen.getByRole('link', { name: /Volver a la pantalla/ }))
    expect(screen.getByText('pantalla-vehiculos')).toBeInTheDocument()
  })

  it('el recorrido ensena por donde va', () => {
    renderAt('/ayuda/vehiculos?paso=2')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')
  })

  it('?paso=N abre esa pestaña del recorrido y «Continuar» avanza la URL', async () => {
    renderAt('/ayuda/vehiculos?paso=3')
    expect(screen.getByRole('tab', { name: /Vencimientos/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Paso 3 de 6')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Continuar/ }))
    expect(screen.getByRole('tab', { name: /Listados/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('where')).toHaveTextContent('/ayuda/vehiculos?paso=4')
  })

  it('las flechas del teclado mueven el recorrido', async () => {
    renderAt('/ayuda/vehiculos')
    screen.getByRole('tab', { name: /Buscar/ }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: /Tabla/ })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: /Acciones/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('la guía rápida abre su paso', async () => {
    renderAt('/ayuda/vehiculos')
    await userEvent.click(screen.getByRole('button', { name: /^Sacar un listado/ }))
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

  it('enviar correo tiene su recorrido y avisa de que el envío no se deshace', () => {
    renderAt('/ayuda/correo?paso=4')
    expect(screen.getByText('Paso 4 de 4')).toBeInTheDocument()
    expect(screen.getByText(/no se puede deshacer/)).toBeInTheDocument()
  })

  it('al acabar un recorrido se ofrece el capítulo siguiente', () => {
    renderAt('/ayuda/vehiculos?paso=6')
    expect(screen.queryByRole('button', { name: /^Continuar/ })).toBeNull()
    const end = screen.getAllByRole('link', { name: /Siguiente\s+La ficha del vehículo/ })
    expect(end.some((l) => l.classList.contains('tut-walk-end'))).toBe(true)
  })

  it('un resultado del buscador lleva a su duda y la abre', async () => {
    renderAt('/ayuda')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar en la ayuda' }), 'dos citas')
    await userEvent.click(screen.getByRole('link', { name: /dos citas de ITV/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/ayuda/itv-mantenimiento')
    expect(screen.getByText(/dos citas de ITV/).closest('details')).toHaveAttribute('open')
  })

  it('Esc vacía el buscador', async () => {
    renderAt('/ayuda/vehiculos')
    const search = screen.getByRole('searchbox', { name: 'Buscar en la ayuda' })
    await userEvent.type(search, 'exportar{Escape}')
    expect(search).toHaveValue('')
    expect(screen.getByRole('heading', { level: 2, name: 'Vehículos' })).toBeInTheDocument()
  })

  it('el vídeo de presentación: el del idioma, sus escenas y el salto al capítulo', async () => {
    const { container } = renderAt('/ayuda/video')
    expect(screen.getByRole('heading', { level: 2, name: 'Vídeo de presentación' })).toBeInTheDocument()
    expect(container.querySelector('video source')).toHaveAttribute('src', '/tutorial/video/presentacion-es.webm')
    // No es un capítulo «en preparación».
    expect(screen.queryByText(/en preparación/)).not.toBeInTheDocument()
    const scenes = container.querySelectorAll('.tut-scenes li')
    expect(scenes.length).toBeGreaterThan(10)
    expect(screen.getByRole('button', { name: 'Ir al 0:00 del vídeo' })).toBeInTheDocument()
    await userEvent.click(within(scenes[3] as HTMLElement).getByRole('link', { name: /Vehículos/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/ayuda/vehiculos')
  })

  it('la portada ofrece seguir donde lo dejaste', async () => {
    const first = renderAt('/ayuda/kilometraje')
    first.unmount()
    renderAt('/ayuda')
    expect(screen.getByRole('link', { name: /Seguir donde lo dejaste\s+Kilometraje/ })).toHaveAttribute('href', '/ayuda/kilometraje')
  })

  it('«Preguntas frecuentes» junta también las dudas de cada capítulo', () => {
    renderAt('/ayuda/preguntas')
    expect(screen.getByRole('heading', { name: 'Más dudas, por capítulo' })).toBeInTheDocument()
    expect(screen.getByText(/dos citas de ITV/)).toBeInTheDocument()
  })

  it('un enlace [[id]] lleva a ese capítulo con su título', async () => {
    renderAt('/ayuda/vehiculos?paso=2')
    // El del texto (el índice también enlaza al capítulo).
    const link = screen
      .getAllByRole('link', { name: 'La ficha del vehículo' })
      .find((a) => a.classList.contains('tut-xref'))!
    expect(link).toHaveAttribute('href', '/ayuda/ficha')
    await userEvent.click(link)
    expect(screen.getByRole('heading', { level: 2, name: 'La ficha del vehículo' })).toBeInTheDocument()
  })

  it('«Lo que pasa» tiene sus recorridos: resolver explica la vuelta al servicio', () => {
    renderAt('/ayuda/resolver?paso=4')
    expect(screen.getByRole('tab', { name: /Volver/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Devolver el coche a Activo al resolver', { selector: '.tut-ui' })).toBeInTheDocument()
  })

  it('accidentes enseña cuándo se borran los datos de terceros', () => {
    renderAt('/ayuda/accidentes?paso=5')
    expect(screen.getByText('Paso 5 de 5')).toBeInTheDocument()
    expect(screen.getByText(/se guardan 18 meses/)).toBeInTheDocument()
  })

  it('en inglés cambia la copia', () => {
    localStorage.setItem('gs_base_lang', 'en')
    renderAt('/ayuda/vehiculos')
    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Vehicles' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open this screen/ })).toBeInTheDocument()
  })
})
