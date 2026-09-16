// R5-45: la ficha del vehículo montada entera, con el back simulado. Sus
// tarjetas se prueban una a una en sus propios tests; aquí se comprueba lo que
// solo se ve desde la página: la cabecera (matrícula, marcas, coste y fin de
// contrato), la barra de acciones, la línea de indicadores, el marco de las
// marcas y cómo se recupera cuando algún bloque falla.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VehicleDetailPage } from './VehicleDetailPage.tsx'
import { ConfirmProvider } from '../components/ConfirmDialog.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { FlotaUser, Vehicle, VehicleSummary } from '../types.ts'

const mocks = vi.hoisted(() => ({
  // Lo que pide la propia página.
  fetchVehicle: vi.fn(),
  fetchVehicleSummary: vi.fn(),
  listKmReadings: vi.fn(),
  listEvents: vi.fn(),
  fetchVehicleHistory: vi.fn(),
  listVehicleLinks: vi.fn(),
  // Lo que piden sus tarjetas al montarse.
  listAlerts: vi.fn(),
  listOpenIncidents: vi.fn(),
  listIncidents: vi.fn(),
  listInvoices: vi.fn(),
  listDocuments: vi.fn(),
  fetchPickerConfig: vi.fn(),
  listAssignments: vi.fn(),
  listVehicleUsages: vi.fn(),
  listDrivers: vi.fn(),
  listSupervisorChanges: vi.fn(),
  fetchManagedUser: vi.fn(),
  useAuth: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  fetchVehicle: mocks.fetchVehicle,
  fetchVehicleSummary: mocks.fetchVehicleSummary,
  listKmReadings: mocks.listKmReadings,
  listEvents: mocks.listEvents,
  fetchVehicleHistory: mocks.fetchVehicleHistory,
  listVehicleLinks: mocks.listVehicleLinks,
  listAlerts: mocks.listAlerts,
  listOpenIncidents: mocks.listOpenIncidents,
  listIncidents: mocks.listIncidents,
  listInvoices: mocks.listInvoices,
  listDocuments: mocks.listDocuments,
  fetchPickerConfig: mocks.fetchPickerConfig,
  listAssignments: mocks.listAssignments,
  listVehicleUsages: mocks.listVehicleUsages,
  listDrivers: mocks.listDrivers,
  listSupervisorChanges: mocks.listSupervisorChanges,
  fetchManagedUser: mocks.fetchManagedUser,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: mocks.useAuth,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

const VEHICLE = {
  id: 21,
  plate: '1234KLM',
  brand: 'Seat',
  model: 'Leon',
  version: 'FR',
  type: 'car',
  fuel: 'diesel',
  business_use: 'works',
  state: 'active',
  state_display: 'Activo',
  is_substitute: false,
  unlimited_km: false,
  driver_name: 'Carlos Ruiz',
  driver_id: 3,
  supervisor: 2,
  supervisor_name: 'Sara Jefa',
  next_itv_date: '2027-03-01',
  insurance_expiry_date: '2027-01-15',
  updated_at: '2026-09-01T10:00:00Z',
} as unknown as Vehicle

const SUBSTITUTE = {
  ...VEHICLE,
  id: 22,
  plate: '2001CNY',
  is_substitute: true,
  driver_name: '',
  driver_id: null,
} as unknown as Vehicle

const SUMMARY = {
  vehicle: 21,
  plate: '1234KLM',
  state: 'active',
  next_itv_date: '2027-03-01',
  next_maintenance_date: null,
  insurance_expiry_date: '2027-01-15',
  unlimited_km: false,
  is_substitute: false,
  blocked_by_link: null,
  km_current: 53730,
  km_reading_date: '2026-09-10',
  km_estimated: false,
  fuel_month_liters: '55.50',
  fuel_month_amount: '77.00',
  km_driven: 13730,
  driver: { id: 3, name: 'Carlos Ruiz' },
  contract: {
    id: 9,
    month_fee: '450.00',
    contract_km: 100000,
    contract_time: 48,
    penalty_per_km: null,
    start_date: '2025-01-01',
    planned_end_date: '2028-12-31',
    drive_url: '',
  },
  projection: null,
} as unknown as VehicleSummary

const ALERT = {
  id: 1,
  type: 'itv_due',
  type_display: 'ITV programada',
  level: 'warning',
  level_display: 'Aviso',
  status: 'open',
  vehicle: 21,
  vehicle_plate: '1234KLM',
  message: 'ITV en 30 días',
  due_date: '2027-03-01',
}

const INCIDENT = {
  id: 4,
  vehicle: 21,
  type: 'breakdown',
  type_display: 'Avería',
  date: '2026-08-20',
  description: 'No arranca en frío',
  details: {},
  status: 'open',
  status_display: 'Abierta',
  cost: null,
}

function renderPage(id = 21) {
  return render(
    <MemoryRouter initialEntries={[`/vehiculos/${id}`]}>
      <LanguageProvider>
        <ConfirmProvider>
          <Routes>
            <Route path="/vehiculos/:id" element={<VehicleDetailPage />} />
          </Routes>
        </ConfirmProvider>
      </LanguageProvider>
    </MemoryRouter>,
  )
}

/**
 * El indicador (botón con StatCard) cuyo rótulo es `label`. Se busca entre
 * los `.kpi-btn`: «Alertas e incidencias» es también el título de su tarjeta.
 */
function kpi(label: string) {
  const boton = Array.from(document.querySelectorAll<HTMLButtonElement>('button.kpi-btn')).find(
    (b) => b.querySelector('span')?.textContent === label,
  )
  if (!boton) throw new Error(`No hay indicador «${label}»`)
  return boton
}

describe('VehicleDetailPage (la ficha del vehículo)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.useAuth.mockReturnValue({
      user: { id: 1, username: 'admin', email: 'admin@flota.dev', roles: ['admin'] } as FlotaUser,
    })
    mocks.fetchVehicle.mockReset().mockResolvedValue(VEHICLE)
    mocks.fetchVehicleSummary.mockReset().mockResolvedValue(SUMMARY)
    mocks.listKmReadings.mockReset().mockResolvedValue(
      page([
        { id: 1, vehicle: 21, reading_date: '2026-08-10', km_reading: 52000 },
        { id: 2, vehicle: 21, reading_date: '2026-09-10', km_reading: 53730 },
      ]),
    )
    mocks.listEvents.mockReset().mockResolvedValue(page([]))
    mocks.fetchVehicleHistory.mockReset().mockResolvedValue(page([]))
    mocks.listVehicleLinks.mockReset().mockResolvedValue(page([]))
    mocks.listAlerts.mockReset().mockResolvedValue(page([ALERT]))
    mocks.listOpenIncidents.mockReset().mockResolvedValue([INCIDENT])
    mocks.listIncidents.mockReset().mockResolvedValue(page([]))
    mocks.listInvoices.mockReset().mockResolvedValue(page([]))
    mocks.listDocuments.mockReset().mockResolvedValue(page([]))
    mocks.fetchPickerConfig.mockReset().mockResolvedValue({ enabled: false })
    mocks.listAssignments.mockReset().mockResolvedValue(page([]))
    mocks.listVehicleUsages.mockReset().mockResolvedValue(page([]))
    mocks.listDrivers.mockReset().mockResolvedValue([])
    mocks.listSupervisorChanges.mockReset().mockResolvedValue(page([]))
    mocks.fetchManagedUser.mockReset().mockResolvedValue(null)
  })

  it('cabecera: matrícula, marcas, lo que cuesta el coche y la barra de acciones', async () => {
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Cargando…')

    expect(await screen.findByRole('heading', { name: '1234KLM' })).toBeInTheDocument()
    // Cada bloque se pide UNA vez y para ESTE coche.
    expect(mocks.fetchVehicle).toHaveBeenCalledTimes(1)
    expect(mocks.fetchVehicle).toHaveBeenCalledWith(21)
    expect(mocks.fetchVehicleSummary).toHaveBeenCalledWith(21)
    expect(mocks.listKmReadings).toHaveBeenCalledWith(21)
    expect(mocks.listEvents).toHaveBeenCalledWith(21)
    expect(mocks.listVehicleLinks).toHaveBeenCalledWith({ main_vehicle: 21 })
    expect(mocks.listVehicleLinks).toHaveBeenCalledWith({ substitute_vehicle: 21 })

    // Subtítulo: qué es y cómo está; conductor y supervisor salen siempre.
    expect(screen.getByText(/Seat Leon FR/)).toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(screen.getByText('Conductor: Carlos Ruiz')).toBeInTheDocument()
    expect(screen.getByText('Supervisor: Sara Jefa')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Desplegar todo/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Plegar todo/ })).toBeInTheDocument()

    // A la derecha de la matrícula, lo que cuesta: cuota y fin de contrato.
    await waitFor(() => expect(kpi('Coste mensual')).toHaveTextContent(/450/))
    expect(kpi('Fin de contrato')).toHaveTextContent('2028-12-31')
    expect(kpi('Fin de contrato')).toHaveTextContent('48 meses')

    // La barra de lo que se le HACE, en su orden.
    const barra = screen.getByRole('heading', { name: '1234KLM' }).closest('.vehicle-detail')!
      .querySelector('.detail-actionbar')!
    expect(within(barra as HTMLElement).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Enviar correo',
      'Cambiar conductor / supervisor',
      'Gestionar facturas',
      'Editar',
      'Cambiar estado',
      'Devolver',
    ])
    // Un coche con conductor, en flota y con contrato en vigor no lleva marco.
    expect(document.querySelector('.vehicle-detail')).not.toHaveClass('has-marks')
  })

  it('indicadores: vencimientos, lo abierto (que calcula su tarjeta), km y combustible', async () => {
    renderPage()
    await screen.findByRole('heading', { name: '1234KLM' })

    expect(kpi('Vencimiento del seguro')).toHaveTextContent('2027-01-15')
    expect(kpi('Próxima ITV')).toHaveTextContent('2027-03-01')
    expect(kpi('Próximo mantenimiento')).toHaveTextContent('Sin plan de mantenimiento')
    // Lo abierto lo cuenta `usePending` y sube por `onResumen`: no se pide dos veces.
    await waitFor(() =>
      expect(kpi('Alertas e incidencias')).toHaveTextContent(/1\s*alertas\s*·\s*1\s*incidencias/),
    )
    // Los tipos van en el `title`, no en la tarjeta.
    expect(kpi('Alertas e incidencias')).toHaveAttribute(
      'title',
      'Ver y resolver lo que hay abierto — alertas: ITV programada · incidencias: Avería',
    )
    await waitFor(() => expect(kpi('Kilometraje')).toHaveTextContent(/53[.,]?730/))
    expect(kpi('Kilometraje')).toHaveTextContent('Última lectura: 2026-09-10')
    expect(kpi('Kilometraje')).toBeEnabled()
    expect(kpi('Combustible (mes)')).toHaveTextContent(/55[.,]50/)

    // Los de ITV y mantenimiento abren «Programar ITV y mantenimiento» por su pestaña.
    await userEvent.click(kpi('Próxima ITV'))
    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveTextContent('Programar ITV y mantenimiento')
    expect(within(dialogo).getByRole('tab', { name: 'Programar ITV' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('cubierto por un sustituto: la marca lo dice y el indicador de km se apaga', async () => {
    mocks.fetchVehicleSummary.mockResolvedValue({
      ...SUMMARY,
      blocked_by_link: { substitute_id: 22, plate: '2001CNY', reason: 'breakdown', since: '2026-09-01' },
    })
    mocks.listVehicleLinks.mockImplementation((f: { main_vehicle?: number }) =>
      Promise.resolve(
        page(
          f.main_vehicle === 21
            ? [
                {
                  id: 5,
                  main_vehicle: 21,
                  main_vehicle_plate: '1234KLM',
                  substitute_vehicle: 22,
                  substitute_vehicle_plate: '2001CNY',
                  reason: 'breakdown',
                  start_date: '2026-09-01',
                  end_date: null,
                },
              ]
            : [],
        ),
      ),
    )
    mocks.fetchVehicle.mockImplementation((id: number) =>
      Promise.resolve(id === 22 ? SUBSTITUTE : VEHICLE),
    )
    renderPage()
    await screen.findByRole('heading', { name: '1234KLM' })

    // La marca de la cabecera y el aviso de estado nombran al que lo cubre…
    expect(await screen.findByText('🔁 Sustituido por 2001CNY')).toBeInTheDocument()
    expect(mocks.fetchVehicle).toHaveBeenCalledWith(22)
    const aviso = screen.getByRole('status')
    expect(within(aviso).getByRole('link', { name: '2001CNY' })).toHaveAttribute('href', '/vehiculos/22')
    // …y los km se registran sobre el sustituto: aquí el indicador va apagado.
    const km = kpi('Kilometraje')
    expect(km).toBeDisabled()
    expect(km).toHaveAttribute('title', 'Bloqueado por sustitución — registra los km sobre 2001CNY')
  })

  it('las marcas enmarcan la ficha: sin conductor, contrato vencido; la baja no se enmarca', async () => {
    mocks.fetchVehicle.mockResolvedValue({ ...VEHICLE, driver_name: '', driver_id: null })
    mocks.fetchVehicleSummary.mockResolvedValue({
      ...SUMMARY,
      contract: { ...SUMMARY.contract!, planned_end_date: '2026-01-31' },
    })
    const { unmount } = renderPage()
    await screen.findByRole('heading', { name: '1234KLM' })
    await waitFor(() => expect(document.querySelector('.vehicle-detail')).toHaveClass('is-expired'))
    const ficha = document.querySelector('.vehicle-detail')!
    expect(ficha).toHaveClass('has-marks', 'is-driverless')
    const marcas = ficha.querySelector('.detail-marks')!
    expect(marcas).toHaveTextContent('Contrato finalizado')
    expect(marcas).toHaveTextContent('Sin conductor')
    expect(kpi('Fin de contrato')).toHaveTextContent(/hace/)
    unmount()

    // De baja: ni marco por el contrato ni por el conductor, y sin
    // «Cambiar estado» ni «Devolver» (ya salió de la flota).
    mocks.fetchVehicle.mockResolvedValue({
      ...VEHICLE,
      state: 'retired',
      state_display: 'Devuelto (baja)',
      driver_name: '',
    })
    renderPage()
    await screen.findByRole('heading', { name: '1234KLM' })
    await waitFor(() => expect(kpi('Fin de contrato')).toHaveTextContent('2026-01-31'))
    expect(document.querySelector('.vehicle-detail')).not.toHaveClass('has-marks')
    expect(screen.queryByRole('button', { name: 'Cambiar estado' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Devolver' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
  })

  it('si el vehículo no carga, la ficha es el error; si falla un bloque secundario, avisa y reintenta', async () => {
    mocks.fetchVehicle.mockRejectedValue(new Error('404 Not Found'))
    const { unmount } = renderPage(99)
    expect(await screen.findByRole('alert')).toHaveTextContent('404 Not Found')
    expect(screen.queryByRole('heading')).toBeNull()
    unmount()

    // UX5: el resumen falla → banner con reintento, no huecos en silencio.
    mocks.fetchVehicle.mockClear().mockResolvedValue(VEHICLE)
    mocks.fetchVehicleSummary.mockRejectedValueOnce(new Error('500')).mockResolvedValue(SUMMARY)
    renderPage()
    await screen.findByRole('heading', { name: '1234KLM' })
    const banner = await screen.findByText(/Algunos bloques/)
    expect(kpi('Coste mensual')).toHaveTextContent('—')
    await userEvent.click(within(banner.parentElement as HTMLElement).getByRole('button', { name: 'Reintentar' }))
    expect(mocks.fetchVehicle).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(kpi('Coste mensual')).toHaveTextContent(/450/))
    await waitFor(() => expect(screen.queryByText(/Algunos bloques/)).toBeNull())
  })

  it('entrando directo (sin historial en la app), «Volver» lleva a la vista general', async () => {
    renderPage()
    await screen.findByRole('heading', { name: '1234KLM' })
    expect(screen.getByRole('button', { name: '← Vista general' })).toBeInTheDocument()
  })
})
