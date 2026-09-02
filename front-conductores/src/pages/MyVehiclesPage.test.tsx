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
  fetchKmWindow: vi.fn(),
  listIncidents: vi.fn(),
  listDocuments: vi.fn(),
  roles: ['driver'] as Role[],
  navigate: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  fetchVehicleSummaries: mocks.fetchVehicleSummaries,
  fetchKmWindow: mocks.fetchKmWindow,
  listIncidents: mocks.listIncidents,
  listDocuments: mocks.listDocuments,
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
    mocks.listIncidents.mockResolvedValue({ count: 0, results: [] })
    mocks.listDocuments.mockResolvedValue({ count: 0, results: [] })
    // N8a: ventana del 20 a fin de mes → el mejor día para registrar es el 31.
    mocks.fetchKmWindow.mockResolvedValue({
      open: true,
      enabled: true,
      start_day: 20,
      last_day: 31,
      today: '2026-08-28',
      admin_exempt: false,
    })
  })

  it('con UN coche el inicio es su TABLERO: ficha, km y acordeones (C1)', async () => {
    mocks.listVehicles.mockResolvedValue({ count: 1, results: [vehicle(1, '1234KLM')] })
    // Lectura de otro mes → pendiente. El bulk (O2) devuelve la lista entera.
    mocks.fetchVehicleSummaries.mockResolvedValue([summary(1, 31000, '2020-01-02')])

    renderPage()
    expect(await screen.findByText('1234KLM')).toBeInTheDocument()
    // Sin título ("Mi vehículo" no informaba de nada) ni cifras de flota.
    expect(screen.queryByText('Mi vehículo')).not.toBeInTheDocument()
    expect(screen.queryByText('Vehículos')).not.toBeInTheDocument()
    // El div de km (el MISMO que en la ficha): última lectura, el mejor día
    // para registrar (fin de la ventana N8a) y la píldora de pendiente.
    expect(await screen.findByText('31.000 km')).toBeInTheDocument()
    expect(screen.getByText('Lectura del 2/1/2020')).toBeInTheDocument()
    expect(screen.getByText('Mejor día para registrar los km: el 31')).toBeInTheDocument()
    expect(screen.getByText('lectura pendiente desde el 2/1/2020')).toBeInTheDocument()
    // Próximas citas: la lectura pendiente, con el día y cuántos faltan
    // (ventana 20→31 y hoy 28 en el back → quedan 3 días).
    expect(screen.getByText('Próximas citas')).toBeInTheDocument()
    expect(screen.getByText('Lectura de km')).toBeInTheDocument()
    expect(screen.getByText('el día 31 · en 3 días')).toBeInTheDocument()
    // Los acordeones de averías y documentos, con su recuento.
    expect(screen.getByText('Averías')).toBeInTheDocument()
    expect(screen.getByText('Documentos')).toBeInTheDocument()
    expect(mocks.listDocuments).toHaveBeenCalledWith(1)
    // La ficha enlaza a la ficha de campo (M2).
    expect(screen.getByRole('link', { name: 'Ver ficha' })).toHaveAttribute(
      'href',
      '/vehiculos/1',
    )
    expect(document.querySelector('.own-panel')).not.toBeNull()
  })

  it('los acordeones nacen plegados y al abrirlos enseñan su contenido', async () => {
    mocks.listVehicles.mockResolvedValue({ count: 1, results: [vehicle(1, '1234KLM')] })
    mocks.fetchVehicleSummaries.mockResolvedValue([summary(1, 31000, null)])
    // Solo lo relacionado con averías: el mantenimiento y las cerradas se
    // quedan fuera del acordeón (mantenimiento e ITV van por su vía).
    const incident = (extra: Record<string, unknown>) => ({
      id: 9,
      vehicle: 1,
      type: 'general',
      type_display: 'Avería',
      date: '2026-08-25',
      description: 'No arranca en frío.',
      mileage: null,
      workshop_postal_code: '',
      details: {},
      status: 'open',
      status_display: 'Abierta',
      cost: null,
      ...extra,
    })
    mocks.listIncidents.mockResolvedValue({
      count: 3,
      results: [
        incident({}),
        incident({
          id: 10,
          type: 'maintenance',
          type_display: 'Mantenimiento',
          description: 'Cambio de aceite.',
        }),
        incident({
          id: 11,
          type: 'breakdown',
          description: 'Embrague duro.',
          status: 'closed',
          status_display: 'Cerrada',
        }),
        // Neumáticos: el comentario es OPCIONAL en su parte, así que la fila
        // se apoya en el motivo del cambio y la rueda.
        incident({
          id: 12,
          type: 'tires',
          type_display: 'Cambio de neumático',
          description: '',
          details: {
            report_version: 1,
            change_reason: 'puncture',
            wheel: 'front_left',
            tire_measure: '205/55 R16',
          },
        }),
      ],
    })
    mocks.listDocuments.mockResolvedValue({
      count: 1,
      results: [
        {
          id: 4,
          type_display: 'Permiso de circulación',
          status: 'valid',
          status_display: 'Vigente',
          created_at: '2026-01-10T00:00:00Z',
          expiry_date: null,
          drive_url: 'https://drive.example/d/4',
          file_url: '',
        },
      ],
    })

    renderPage()
    await screen.findByText('1234KLM')
    // Plegados: el contenido no se ve hasta abrir cada acordeón.
    expect(await screen.findByText(/No arranca en frío/)).not.toBeVisible()
    await userEvent.click(screen.getByText('Averías'))
    expect(screen.getByText(/No arranca en frío/)).toBeVisible()
    expect(screen.getAllByText('Abierta')[0]).toBeVisible()
    // El neumático se explica sin comentario: motivo · rueda · medida.
    expect(screen.getByText('Pinchazo · Delantera izquierda · 205/55 R16')).toBeVisible()
    // Fuera del acordeón: el mantenimiento no es una avería, y la cerrada ya
    // no está abierta.
    expect(screen.queryByText(/Cambio de aceite/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Embrague duro/)).not.toBeInTheDocument()
    expect(screen.getByText('Permiso de circulación')).not.toBeVisible()
    await userEvent.click(screen.getByText('Documentos'))
    expect(screen.getByText('Permiso de circulación')).toBeVisible()
  })

  it('sin barra de acciones propia: las cinco acciones viven en el nav inferior', async () => {
    mocks.listVehicles.mockResolvedValue({ count: 1, results: [vehicle(7, '1234KLM')] })
    mocks.fetchVehicleSummaries.mockResolvedValue([summary(7, 31000, '2020-01-02')])

    renderPage()
    await screen.findByText('1234KLM')

    // La barra de accesos rápidos desapareció de la página (nav del shell).
    expect(document.querySelector('.home-quick')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Registrar km' })).not.toBeInTheDocument()
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
    // El tablero de SU coche cargado directo (C1), ya sin título por encima.
    expect(await screen.findByText('1234KLM')).toBeInTheDocument()
    expect(screen.queryByText('Mi vehículo')).not.toBeInTheDocument()
    // Los del equipo NO están aquí (viven en "Flota"), ni hay buscador.
    expect(screen.queryByText('5678BCD')).not.toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    // Km y acordeones del tablero; sin barra de acciones (nav del shell).
    expect(screen.getByText('31.000 km')).toBeInTheDocument()
    expect(screen.getByText('Averías')).toBeInTheDocument()
    expect(screen.getByText('Documentos')).toBeInTheDocument()
    expect(document.querySelector('.home-quick')).toBeNull()
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

  it('el conductor con varios coches sueltos vuelve a la lista, sin buscador', async () => {
    mocks.listVehicles.mockResolvedValue({
      count: 2,
      results: [vehicle(1, '1234KLM'), vehicle(2, '5678BCD', 'Ford', 'Transit')],
    })
    mocks.fetchVehicleSummaries.mockResolvedValue([summary(1, 1000, null), summary(2, 2000, null)])

    renderPage()
    // Los ve todos de un vistazo: buscar sobra y solo roba sitio en pantalla.
    expect(await screen.findByText('5678BCD')).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(document.querySelector('.own-panel')).toBeNull()
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

  it('pareja: solo se ve el tablero del sustituto, con su marca y motivo', async () => {
    substitutionPair()
    renderPage()

    // Marca visual del sustituto y a quién cubre, en su ficha.
    expect(await screen.findByText('🔁 Sustitución')).toBeInTheDocument()
    expect(screen.getByText('Cubriendo a 5678BCD · Mantenimiento')).toBeInTheDocument()

    // UN solo reel: el tablero del propio queda detrás, oculto e inerte.
    expect(document.querySelectorAll('.sub-group')).toHaveLength(1)
    const slides = document.querySelectorAll('.sub-slide')
    expect(slides).toHaveLength(2)
    expect(slides[0]).toHaveAttribute('aria-hidden', 'true')
    expect(slides[1]).toHaveAttribute('aria-hidden', 'false')
    expect(slides[0].querySelector('.plate')?.textContent).toBe('5678BCD')
    expect(slides[1].querySelector('.plate')?.textContent).toBe('4567JKL')
    // Los datos del tablero se cargan para LOS DOS coches de la pareja.
    expect(mocks.listDocuments).toHaveBeenCalledWith(9)
    expect(mocks.listDocuments).toHaveBeenCalledWith(2)
    expect(mocks.listIncidents).toHaveBeenCalledWith(9)
    expect(mocks.listIncidents).toHaveBeenCalledWith(2)
  })

  it('la flecha junto a la matricula desliza al propio, que sale BLOQUEADO', async () => {
    substitutionPair()
    renderPage()

    // A la IZQUIERDA de la matrícula del sustituto.
    const toButton = await screen.findByRole('button', {
      name: 'Ver el coche sustituido 5678BCD',
    })
    const head = toButton.closest('.vehicle-card-head')
    expect(head?.firstElementChild).toBe(toButton)
    expect(head?.querySelector('.plate')?.textContent).toBe('4567JKL')

    // Deslizar: la pista se mueve y el propio pasa a ser el visible.
    await userEvent.click(toButton)
    expect(document.querySelector('.sub-track')).toHaveClass('show-original')
    const slides = document.querySelectorAll('.sub-slide')
    expect(slides[0]).toHaveAttribute('aria-hidden', 'false')
    expect(slides[1]).toHaveAttribute('aria-hidden', 'true')

    // El propio sale bloqueado, con candado y motivo.
    expect(screen.getByText('🔒 Bloqueado')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Mantenimiento — sustituido por 4567JKL. Registra los km y documentos sobre el sustituto.',
      ),
    ).toBeInTheDocument()

    // Y su flecha (también junto a la matrícula) devuelve al sustituto.
    const backButton = screen.getByRole('button', {
      name: 'Volver al coche de sustitución 4567JKL',
    })
    expect(backButton.closest('.vehicle-card-head')?.firstElementChild).toBe(backButton)
    await userEvent.click(backButton)
    expect(document.querySelector('.sub-track')).not.toHaveClass('show-original')
  })

  it('el principal sin su sustituto a la vista: tablero suelto, bloqueado, sin reel', async () => {
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
    expect(document.querySelector('.own-panel')).not.toBeNull()
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
    expect(document.querySelector('.own-panel')).not.toBeNull()
    expect(document.querySelector('.sub-reel')).toBeNull()
    expect(screen.queryByRole('button', { name: /Ver el coche/ })).not.toBeInTheDocument()
  })
})
