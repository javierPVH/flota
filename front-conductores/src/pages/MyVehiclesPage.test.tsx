import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MyVehiclesPage } from './MyVehiclesPage.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Role } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listVehicles: vi.fn(),
  fetchVehicleSummaries: vi.fn(),
  roles: ['driver'] as Role[],
  navigate: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  fetchVehicleSummaries: mocks.fetchVehicleSummaries,
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'carlos', roles: mocks.roles } }),
}))

function vehicle(id: number, plate: string, brand = 'Mercedes', model = 'Sprinter') {
  return {
    id,
    plate,
    brand,
    model,
    state: 'active',
    state_display: 'Activo',
    is_substitute: false,
    next_itv_date: null,
    supervisor_name: '',
  }
}

function summary(id: number, km: number, readingDate: string | null) {
  return { vehicle: id, km_current: km, km_reading_date: readingDate, driver: null }
}

function renderPage(onGoFleet?: () => void) {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <MyVehiclesPage onGoFleet={onGoFleet} />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('MyVehiclesPage (M1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.roles = ['driver']
  })

  it('con UN coche el inicio es la ficha, sin lista intermedia (C1)', async () => {
    mocks.listVehicles.mockResolvedValue({ count: 1, results: [vehicle(1, '1234KLM')] })
    // Lectura de otro mes → pendiente. El bulk (O2) devuelve la lista entera.
    mocks.fetchVehicleSummaries.mockResolvedValue([summary(1, 31000, '2020-01-02')])

    renderPage()
    // Título en singular y sin las cifras de flota ("Vehículos 1" no informa).
    expect(await screen.findByText('Mi vehículo')).toBeInTheDocument()
    expect(screen.queryByText('Vehículos')).not.toBeInTheDocument()
    expect(await screen.findByText('1234KLM')).toBeInTheDocument()
    expect(await screen.findByText('31.000 km')).toBeInTheDocument()
    // La píldora dice DESDE cuándo falta la lectura (fecha de la última).
    expect(screen.getByText('lectura pendiente desde el 2/1/2020')).toBeInTheDocument()
    // La tarjeta enlaza a la ficha de campo (M2).
    expect(screen.getByRole('link', { name: /1234KLM/ })).toHaveAttribute('href', '/vehiculos/1')
  })

  it('ofrece las cuatro acciones de campo, con el coche ya preseleccionado', async () => {
    mocks.listVehicles.mockResolvedValue({ count: 1, results: [vehicle(7, '1234KLM')] })
    mocks.fetchVehicleSummaries.mockResolvedValue([summary(7, 31000, '2020-01-02')])

    renderPage()
    await screen.findByText('Mi vehículo')

    // Subir documento y las dos altas son VISTAS propias, no la ficha.
    expect(screen.getByRole('link', { name: /Subir documento/ })).toHaveAttribute(
      'href',
      '/documentos/nuevo?vehiculo=7',
    )
    expect(screen.getByRole('link', { name: /Avería/ })).toHaveAttribute(
      'href',
      '/incidencias/nueva?tipo=breakdown&vehiculo=7',
    )
    expect(screen.getByRole('link', { name: /Incidencia/ })).toHaveAttribute(
      'href',
      '/incidencias/nueva?vehiculo=7',
    )
    expect(screen.getByRole('link', { name: /Registrar km/ })).toHaveAttribute('href', '/registrar')
    // El parte modal de accidente es una herramienta del supervisor.
    expect(screen.queryByRole('button', { name: 'Accidente' })).not.toBeInTheDocument()
  })

  it('el supervisor ve aqui SOLO su coche, cargado directo y sin buscador', async () => {
    mocks.roles = ['driver', 'supervisor']
    mocks.listVehicles.mockResolvedValue({
      count: 2,
      results: [vehicle(1, '1234KLM'), vehicle(2, '5678BCD', 'Ford', 'Transit')],
    })
    // El ámbito trae el grupo entero; su coche es el que conduce (driver.id=1).
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { ...summary(1, 31000, null), driver: { id: 1, name: 'Sara Supervisora' } },
      { ...summary(2, 2000, null), driver: { id: 5, name: 'Carlos Ruiz' } },
    ])

    renderPage()
    // Título personal y la ficha de SU coche cargada directa (C1).
    expect(await screen.findByText('Mi vehículo')).toBeInTheDocument()
    expect(screen.getByText('1234KLM')).toBeInTheDocument()
    // Los del equipo NO están aquí (viven en "Flota"), ni hay buscador.
    expect(screen.queryByText('5678BCD')).not.toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    // Y sin accesos rápidos: su nav en modo vehículo ya los lleva.
    expect(screen.queryByRole('link', { name: /Avería/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Registrar km/ })).not.toBeInTheDocument()
  })

  it('el supervisor sin coche propio: aviso y salto al modo flota', async () => {
    mocks.roles = ['driver', 'supervisor']
    mocks.listVehicles.mockResolvedValue({ count: 1, results: [vehicle(2, '5678BCD')] })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { ...summary(2, 2000, null), driver: { id: 5, name: 'Carlos Ruiz' } },
    ])
    const goFleet = vi.fn()
    renderPage(goFleet)
    expect(
      await screen.findByText('No conduces ningún vehículo ahora mismo.'),
    ).toBeInTheDocument()
    // El botón gira el switch del shell (la vista de flota es un MODO, no una ruta).
    await userEvent.click(screen.getByRole('button', { name: /Ver la flota a cargo/ }))
    expect(goFleet).toHaveBeenCalled()
  })

  it('el conductor con varios coches NO tiene buscador', async () => {
    mocks.listVehicles.mockResolvedValue({
      count: 2,
      results: [vehicle(1, '1234KLM'), vehicle(2, '5678BCD', 'Ford', 'Transit')],
    })
    mocks.fetchVehicleSummaries.mockResolvedValue([summary(1, 1000, null), summary(2, 2000, null)])

    renderPage()
    // Los ve todos de un vistazo: buscar sobra y solo roba sitio en pantalla.
    expect(await screen.findByText('5678BCD')).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  // --- N9: el par sustituto ↔ principal -----------------------------------

  /** Sustituto (id 9) cubriendo al principal (id 2), que queda bloqueado. */
  function substitutionPair() {
    mocks.listVehicles.mockResolvedValue({
      count: 2,
      results: [vehicle(2, '5678BCD'), vehicle(9, '4567JKL', 'Nissan', 'Leaf')],
    })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      {
        ...summary(2, 40000, null),
        blocked_by_link: {
          substitute_id: 9,
          plate: '4567JKL',
          reason: 'Mantenimiento',
          since: '2026-08-20',
        },
      },
      {
        ...summary(9, 12000, null),
        substituting_for: {
          main_id: 2,
          plate: '5678BCD',
          reason: 'Mantenimiento',
          since: '2026-08-20',
        },
      },
    ])
  }

  it('solo se ve el sustituto: el original queda detras del reel', async () => {
    substitutionPair()
    renderPage()

    // Marca visual del sustituto y a quién cubre.
    expect(await screen.findByText('🔁 Sustitución')).toBeInTheDocument()
    expect(screen.getByText('Cubriendo a 5678BCD · Mantenimiento')).toBeInTheDocument()

    // UN solo grupo a todo el ancho: el original NO sale como tarjeta suelta.
    expect(document.querySelectorAll('.sub-group')).toHaveLength(1)
    const slides = document.querySelectorAll('.sub-slide')
    expect(slides).toHaveLength(2)
    // Visible el sustituto (derecha); oculto e inerte el original (izquierda).
    expect(slides[0]).toHaveAttribute('aria-hidden', 'true')
    expect(slides[1]).toHaveAttribute('aria-hidden', 'false')
    expect(slides[0].querySelector('.plate')?.textContent).toBe('5678BCD')
    expect(slides[1].querySelector('.plate')?.textContent).toBe('4567JKL')
  })

  it('el boton junto a la matricula desliza al original, y el suyo devuelve', async () => {
    substitutionPair()
    renderPage()

    // A la IZQUIERDA de la matrícula del sustituto.
    const toButton = await screen.findByRole('button', {
      name: 'Ver el coche sustituido 5678BCD',
    })
    const head = toButton.closest('.vehicle-card-head')
    expect(head?.firstElementChild).toBe(toButton)
    expect(head?.querySelector('.plate')?.textContent).toBe('4567JKL')

    // Deslizar: la pista se mueve y el original pasa a ser el visible.
    await userEvent.click(toButton)
    expect(document.querySelector('.sub-track')).toHaveClass('show-original')
    const slides = document.querySelectorAll('.sub-slide')
    expect(slides[0]).toHaveAttribute('aria-hidden', 'false')
    expect(slides[1]).toHaveAttribute('aria-hidden', 'true')

    // El original sale bloqueado, con candado y motivo.
    expect(screen.getByText('🔒 Bloqueado')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Mantenimiento — sustituido por 4567JKL. Registra los km y documentos sobre el sustituto.',
      ),
    ).toBeInTheDocument()

    // Y su botón (también junto a la matrícula) devuelve al sustituto.
    const backButton = screen.getByRole('button', {
      name: 'Volver al coche de sustitución 4567JKL',
    })
    expect(backButton.closest('.vehicle-card-head')?.firstElementChild).toBe(backButton)
    await userEvent.click(backButton)
    expect(document.querySelector('.sub-track')).not.toHaveClass('show-original')
  })

  it('el principal sin su sustituto a la vista sale entero, sin reel', async () => {
    mocks.listVehicles.mockResolvedValue({ count: 1, results: [vehicle(2, '5678BCD')] })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      {
        ...summary(2, 40000, null),
        blocked_by_link: {
          substitute_id: 9,
          plate: '4567JKL',
          reason: 'Mantenimiento',
          since: '2026-08-20',
        },
      },
    ])
    renderPage()
    expect(await screen.findByText('🔒 Bloqueado')).toBeInTheDocument()
    // A todo el ancho, pero sin pista que deslizar ni botón que no lleve a nada.
    expect(document.querySelectorAll('.sub-group')).toHaveLength(1)
    expect(document.querySelector('.sub-reel')).toBeNull()
    expect(screen.queryByRole('button', { name: /coche de sustitución/ })).not.toBeInTheDocument()
  })

  it('el sustituto sin el principal en su ambito: marca si, reel no', async () => {
    mocks.listVehicles.mockResolvedValue({
      count: 1,
      results: [vehicle(9, '4567JKL', 'Nissan', 'Leaf')],
    })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      {
        ...summary(9, 12000, null),
        substituting_for: {
          main_id: 77,
          plate: '9999ZZZ',
          reason: 'Avería',
          since: '2026-08-20',
        },
      },
    ])
    renderPage()
    expect(await screen.findByText('Cubriendo a 9999ZZZ · Avería')).toBeInTheDocument()
    expect(document.querySelectorAll('.sub-group')).toHaveLength(1)
    expect(document.querySelector('.sub-reel')).toBeNull()
    expect(screen.queryByRole('button', { name: /Ver el coche/ })).not.toBeInTheDocument()
  })
})
