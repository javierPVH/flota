// IndexedDB no existe en jsdom: fake-indexeddb lo aporta ANTES de importar la cola.
import 'fake-indexeddb/auto'
import { Suspense } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Role } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listVehicles: vi.fn(),
  fetchVehicleSummaries: vi.fn(),
  listAlerts: vi.fn(),
  listIncidents: vi.fn(),
  listDocuments: vi.fn(),
  listMyShares: vi.fn(),
  roles: ['driver', 'supervisor'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  fetchVehicleSummaries: mocks.fetchVehicleSummaries,
  // R3-28: shell y páginas leen las variantes cacheadas — mismo spy, sin TTL.
  listVehiclesCached: mocks.listVehicles,
  fetchVehicleSummariesCached: mocks.fetchVehicleSummaries,
  listAlerts: mocks.listAlerts,
  listIncidents: mocks.listIncidents,
  listDocuments: mocks.listDocuments,
  listMyShares: mocks.listMyShares,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({
    user: { id: 1, username: 'sara', first_name: 'Sara', last_name: 'S', roles: mocks.roles },
    logout: vi.fn(),
  }),
}))

import { Layout } from './Layout.tsx'
import { HomePage } from '../pages/HomePage.tsx'
import { LanguageProvider } from '../i18n.tsx'

const OWN = {
  id: 3,
  plate: '7890NPQ',
  brand: 'Toyota',
  model: 'Corolla',
  state: 'active',
  state_display: 'Activo',
  is_substitute: false,
  next_itv_date: null,
  supervisor_name: '',
}
const TEAM = { ...OWN, id: 2, plate: '5678BCD', state: 'maintenance', state_display: 'En taller' }

function renderShell() {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <Suspense fallback={<p>cargando</p>}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              {/* El perfil es una RUTA (el tercer tab lleva a ella) y lo que
                  aquí se prueba es el shell: qué tab manda y qué nav sale. La
                  pantalla tiene su propio test. */}
              <Route path="perfil" element={<p>pantalla de perfil</p>} />
              <Route path="reparto" element={<p>pantalla de reparto</p>} />
            </Route>
          </Routes>
        </Suspense>
      </MemoryRouter>
    </LanguageProvider>,
  )
}

describe('switch del supervisor (Mi vehículo ↔ Flota)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear() // el modo se recuerda por dispositivo
    document.documentElement.lang = 'es'
    mocks.roles = ['driver', 'supervisor']
    mocks.listAlerts.mockResolvedValue({ count: 0, results: [] })
    mocks.listIncidents.mockResolvedValue({ count: 0, results: [] })
    mocks.listDocuments.mockResolvedValue({ count: 0, results: [] })
    // Sin repartos de salida: el tab «Reparto» no se ofrece.
    mocks.listMyShares.mockResolvedValue([])
    mocks.listVehicles.mockResolvedValue({ count: 2, results: [OWN, TEAM] })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { vehicle: 3, km_current: 1000, km_reading_date: null, driver: { id: 1, name: 'Sara S' } },
      { vehicle: 2, km_current: 2000, km_reading_date: null, driver: { id: 5, name: 'Carlos' } },
    ])
  })

  it('arranca en Mi vehículo: nav de campo completo y SU coche en la home', async () => {
    renderShell()

    // El switch, con "Mi vehículo" activo.
    const vehicleBtn = screen.getByRole('button', { name: 'Mi vehículo' })
    expect(vehicleBtn).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Flota' })).toHaveAttribute('aria-pressed', 'false')

    // La home carga directa SU coche; el del equipo no está.
    expect(await screen.findByText('7890NPQ')).toBeInTheDocument()
    expect(screen.queryByText('5678BCD')).not.toBeInTheDocument()

    // La barra personal: las siete acciones con sus etiquetas CORTAS (Km ·
    // ITV · Mantenimiento) y SIN «Inicio» —el conmutador de arriba ya devuelve
    // a la tarjeta del coche, y el hueco vale más para lo que solo se hace
    // desde aquí—.
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'Km' })).toBeEnabled())
    expect(Array.from(nav.children).map((item) => item.textContent?.trim())).toEqual([
      'Km', 'Combustible', 'ITV', 'Mantenimiento', 'Incidencia', 'Accidente', 'Documento',
    ])
    expect(within(nav).queryByRole('link', { name: 'Inicio' })).not.toBeInTheDocument()

    // En Mi vehículo actúa sobre SU coche: el aviso de "quedará registrado a
    // tu nombre" (que sí sale en Flota) aquí no pinta nada.
    await userEvent.click(within(nav).getByRole('button', { name: 'Km' }))
    expect(screen.getByRole('dialog', { name: 'Registrar km · 7890NPQ' })).toBeInTheDocument()
    expect(screen.queryByText(/responsabilidad de registrar los km/)).not.toBeInTheDocument()
  })

  it('en Flota: la home es la lista a cargo y el nav queda en Alertas + Proyección', async () => {
    renderShell()
    await screen.findByText('7890NPQ')

    await userEvent.click(screen.getByRole('button', { name: 'Flota' }))
    expect(screen.getByRole('button', { name: 'Flota' })).toHaveAttribute('aria-pressed', 'true')

    // La home pasa a la flota, con sus grupos de estado como pestañas.
    // La home de flota es una página `lazy` (PF2): vitest TRANSFORMA su chunk
    // (y sus módulos de copy, R3-36) en el momento del click, y con la máquina
    // cargada eso puede tardar varios segundos — de ahí el margen holgado (el
    // `findBy` devuelve en cuanto aparece; solo espera más en el peor caso).
    expect(await screen.findByText('Flota a cargo', undefined, { timeout: 10000 })).toBeInTheDocument()
    expect(await screen.findByText('5678BCD', undefined, { timeout: 10000 })).toBeInTheDocument()
    expect(
      // La etiqueta del estado la pone el diccionario de la app por CÓDIGO,
      // no el `state_display` del back (que llega siempre en castellano).
      within(screen.getByRole('combobox', { name: 'Grupos de la flota' })).getByRole('option', {
        name: /No activo - Mantenimiento/,
      }),
    ).toBeInTheDocument()

    // Nav en modo flota: inicio, alertas y proyección de km.
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    expect(within(nav).getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/')
    expect(within(nav).getByRole('link', { name: 'Alertas' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Proyección km' })).toHaveAttribute('href', '/grupo')
    expect(within(nav).queryByRole('button', { name: 'Km' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('button', { name: 'Incidencia' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Incidencia' })).not.toBeInTheDocument()

    // Y de vuelta a Mi vehículo.
    await userEvent.click(screen.getByRole('button', { name: 'Mi vehículo' }))
    expect(await screen.findByText('7890NPQ')).toBeInTheDocument()
    expect(within(screen.getByRole('navigation')).getByRole('button', { name: 'Km' })).toBeInTheDocument()
    // El margen de arriba solo sirve si el propio caso lo tiene: con los 5 s por
    // defecto, la primera transformación del chunk tras reconstruir el DS lo tumbaba.
  }, 20000)

  it('sin coche propio, las acciones del nav van desactivadas', async () => {
    // Nadie conduce para sara: los dos coches los llevan otros.
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { vehicle: 3, km_current: 1000, km_reading_date: null, driver: { id: 5, name: 'Carlos' } },
      { vehicle: 2, km_current: 2000, km_reading_date: null, driver: { id: 6, name: 'Lucía' } },
    ])
    renderShell()

    // La home lo dice y ofrece girar a Flota.
    expect(
      await screen.findByText('No conduces ningún vehículo ahora mismo.'),
    ).toBeInTheDocument()

    // Sin objeto sobre el que actuar: dejan de ser enlaces y van apagadas.
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Km' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: 'Incidencia' })).not.toBeInTheDocument()
    expect(document.querySelectorAll('.bottom-tab.is-disabled').length).toBe(7)
  })

  it('el modo se recuerda por dispositivo', async () => {
    renderShell()
    await screen.findByText('7890NPQ')
    await userEvent.click(screen.getByRole('button', { name: 'Flota' }))
    await screen.findByText('Flota a cargo')
    expect(localStorage.getItem('flota:vista')).toBe('flota')
  })

  // --- El tercer tab: «Mi perfil» ----------------------------------------
  it('el tercer tab abre el perfil y deja el nav en Mis datos + Documento', async () => {
    renderShell()
    await screen.findByText('7890NPQ')

    await userEvent.click(screen.getByRole('button', { name: 'Mi perfil' }))
    expect(await screen.findByText('pantalla de perfil')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mi perfil' })).toHaveAttribute('aria-pressed', 'true')
    // Los otros dos se apagan: el modo sigue puesto por debajo, pero lo que se
    // está mirando es el perfil.
    expect(screen.getByRole('button', { name: 'Mi vehículo' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    // En el perfil no hay coche del que hablar: ni km, ni ITV, ni avería. Y
    // tampoco «Inicio»: el conmutador de arriba ya devuelve a la home, y el
    // hueco vale para lo que SOLO se hace aquí.
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    expect(Array.from(nav.children).map((item) => item.textContent?.trim())).toEqual([
      'Mis datos',
      'Documento',
    ])
    // Y «Documento» abre el MISMO modal que en «Mi vehículo», sobre el
    // coche propio: subir no saca del perfil.
    await userEvent.click(within(nav).getByRole('button', { name: 'Documento' }))
    expect(
      await screen.findByRole('dialog', { name: 'Documento · 7890NPQ' }),
    ).toBeInTheDocument()
  })

  it('sin coches de reparto, el tab «Reparto» no sale', async () => {
    renderShell()
    await screen.findByText('7890NPQ')
    await waitFor(() => expect(mocks.listMyShares).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Reparto' })).not.toBeInTheDocument()
  })

  it('«Reparto» es una ruta más: se marca sola, deja el nav del coche propio y un modo la deja', async () => {
    // Con un reparto vigente, el tab se ofrece.
    mocks.listMyShares.mockResolvedValue([{ id: 9 }])
    renderShell()
    await screen.findByText('7890NPQ')
    await userEvent.click(await screen.findByRole('button', { name: 'Reparto' }))
    expect(await screen.findByText('pantalla de reparto')).toBeInTheDocument()
    // El orden del conmutador: lo que uno conduce primero, después la flota.
    const tabs = screen.getByRole('group', { name: /./ })
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual([
      'Mi vehículo',
      'Reparto',
      'Flota',
      'Mi perfil',
    ])
    expect(screen.getByRole('button', { name: 'Reparto' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Mi vehículo' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Mi perfil' })).toHaveAttribute('aria-pressed', 'false')
    // Las acciones del nav son las del coche PROPIO: lo repartido no se conduce desde aquí.
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    expect(within(nav).getByRole('button', { name: 'Km' })).toBeInTheDocument()
    // Elegir un modo sale de la ruta.
    await userEvent.click(screen.getByRole('button', { name: 'Mi vehículo' }))
    expect(await screen.findByText('7890NPQ')).toBeInTheDocument()
    expect(screen.queryByText('pantalla de reparto')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mi vehículo' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('elegir un modo desde el perfil SALE del perfil', async () => {
    // Si no, el tab cambiaría y la pantalla se quedaría donde estaba.
    renderShell()
    await screen.findByText('7890NPQ')
    await userEvent.click(screen.getByRole('button', { name: 'Mi perfil' }))
    await screen.findByText('pantalla de perfil')

    await userEvent.click(screen.getByRole('button', { name: 'Flota' }))
    expect(await screen.findByText('Flota a cargo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Flota' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('el conductor tiene su coche y su perfil, pero no Flota', async () => {
    mocks.roles = ['driver']
    // El endpoint del conductor devuelve únicamente sus vehículos.
    mocks.listVehicles.mockResolvedValue({ count: 1, results: [OWN] })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { vehicle: 3, km_current: 1000, km_reading_date: null, driver: { id: 1, name: 'Sara S' } },
    ])
    localStorage.setItem('flota:vista', 'flota')
    renderShell()
    expect(screen.queryByRole('button', { name: 'Flota' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mi vehículo' })).toHaveAttribute('aria-pressed', 'true')
    // El perfil sí es suyo: todo el mundo tiene datos y documentación.
    expect(screen.getByRole('button', { name: 'Mi perfil' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'Km' })).toBeEnabled())
    // Sin ITV programada NO le sale la ITV: la cita la pone la gestión y quien
    // conduce atiende la que haya —ese botón solo podía acabar en «no hay
    // ninguna programada»—. Este coche no tiene (`OWN.next_itv_date: null`).
    expect(Array.from(nav.children).map((item) => item.textContent?.trim())).toEqual([
      'Km', 'Combustible', 'Mantenimiento', 'Incidencia', 'Accidente', 'Documento',
    ])
    await userEvent.click(within(nav).getByRole('button', { name: 'Km' }))
    expect(screen.getByRole('dialog', { name: 'Registrar km · 7890NPQ' })).toBeInTheDocument()
    expect(screen.queryByText(/responsabilidad de registrar los km/)).not.toBeInTheDocument()
  })

  it('con la ITV programada, el conductor sí la tiene en el nav', async () => {
    mocks.roles = ['driver']
    mocks.listVehicles.mockResolvedValue({
      count: 1,
      results: [{ ...OWN, next_itv_date: '2030-03-01' }],
    })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { vehicle: 3, km_current: 1000, km_reading_date: null, driver: { id: 1, name: 'Sara S' } },
    ])
    renderShell()

    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'Km' })).toBeEnabled())
    // Hay cita, así que el botón vuelve —apagado hasta 30 días antes, que es
    // otra cosa: el toque sigue explicando desde cuándo—.
    expect(within(nav).getByRole('button', { name: 'ITV' })).toBeInTheDocument()
  })

  it('el administrador conductor habilita el nav sobre su coche, no sobre toda la flota', async () => {
    mocks.roles = ['admin', 'driver']
    const lauraCar = { ...OWN, plate: '5960JSF' }
    const otherVehicles = [
      { ...TEAM, id: 4, plate: '1234ASD' },
      { ...TEAM, id: 5, plate: '3546LKR' },
      { ...TEAM, id: 6, plate: '7198LRY' },
      { ...TEAM, id: 7, plate: '9357MGD' },
    ]
    mocks.listVehicles.mockResolvedValue({
      count: 5,
      results: [lauraCar, ...otherVehicles],
    })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { vehicle: 3, km_current: 1000, km_reading_date: null, driver: { id: 1, name: 'Laura' } },
      ...otherVehicles.map((vehicle, index) => ({
        vehicle: vehicle.id,
        km_current: 2000 + index,
        km_reading_date: null,
        driver: { id: 10 + index, name: `Conductor ${index}` },
      })),
    ])

    renderShell()
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    const km = await waitFor(() => within(nav).getByRole('button', { name: 'Km' }))
    expect(km).toBeEnabled()
    await userEvent.click(km)
    expect(screen.getByRole('dialog', { name: 'Registrar km · 5960JSF' })).toBeInTheDocument()
  })
})
