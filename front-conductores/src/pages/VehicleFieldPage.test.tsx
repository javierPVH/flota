// IndexedDB no existe en jsdom: fake-indexeddb lo aporta ANTES de importar la cola.
import 'fake-indexeddb/auto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Role } from '../types.ts'

const mocks = vi.hoisted(() => ({
  fetchVehicle: vi.fn(),
  fetchVehicleSummary: vi.fn(),
  fetchKmWindow: vi.fn(),
  listDocuments: vi.fn(),
  listIncidents: vi.fn(),
  listAlerts: vi.fn(),
  listMaintenancePlans: vi.fn(),
  uploadDocument: vi.fn(),
  createKmReading: vi.fn(),
  resolveIncident: vi.fn(),
  roles: ['driver', 'supervisor'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  fetchVehicle: mocks.fetchVehicle,
  fetchVehicleSummary: mocks.fetchVehicleSummary,
  fetchKmWindow: mocks.fetchKmWindow,
  listDocuments: mocks.listDocuments,
  listIncidents: mocks.listIncidents,
  listAlerts: mocks.listAlerts,
  listMaintenancePlans: mocks.listMaintenancePlans,
  uploadDocument: mocks.uploadDocument,
  createKmReading: mocks.createKmReading,
  resolveIncident: mocks.resolveIncident,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'sara', roles: mocks.roles } }),
}))

import { VehicleFieldPage } from './VehicleFieldPage.tsx'
import { LanguageProvider } from '../i18n.tsx'

const VEHICLE = {
  id: 1,
  plate: '1234KLM',
  brand: 'Mercedes',
  model: 'Sprinter',
  year: 2022,
  state: 'active',
  state_display: 'Activo',
  is_substitute: false,
  next_itv_date: '2026-09-30',
  supervisor_name: 'Sara S',
  business_use: '',
}

const SUMMARY = {
  vehicle: 1,
  plate: '1234KLM',
  state: 'active',
  next_itv_date: '2026-09-30',
  next_maintenance_date: '2026-09-15',
  unlimited_km: false,
  is_substitute: false,
  blocked_by_link: null,
  substituting_for: null,
  km_current: 4679,
  km_reading_date: '2026-07-26',
  km_driven: 31000,
  driver: { id: 5, name: 'Carlos C' },
  contract: {
    id: 1,
    month_fee: null,
    contract_km: 50000,
    contract_time: null,
    penalty_per_km: null,
    start_date: '2026-01-01',
    planned_end_date: '2026-12-31',
  },
  projection: {
    km_remaining: 19000,
    monthly_avg: 4000,
    contracted_rate: null,
    projected_end: 62000,
    pct_of_limit: 72.4,
    level: 'watch',
    overage_km: 0,
    estimated_penalty: null,
  },
}

function renderPage() {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/vehiculos/1']}>
        <Routes>
          <Route path="/vehiculos/:id" element={<VehicleFieldPage />} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  )
}

/** Como el shell real: la ficha cuelga de un Outlet con el modo y la pareja. */
function renderWithMode(ctx: {
  fleetMode: boolean
  ownPair: { ids: number[]; target: number | null }
}) {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/vehiculos/1']}>
        <Routes>
          <Route element={<Outlet context={{ ...ctx, setFleetMode: () => {} }} />}>
            <Route path="/vehiculos/:id" element={<VehicleFieldPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  )
}

describe('VehicleFieldPage (ficha de campo)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.roles = ['driver', 'supervisor']
    mocks.fetchVehicle.mockResolvedValue(VEHICLE)
    mocks.fetchVehicleSummary.mockResolvedValue(SUMMARY)
    // N8a: ventana del 20 a fin de mes → el mejor día para registrar es el 31.
    mocks.fetchKmWindow.mockResolvedValue({
      open: true,
      enabled: true,
      start_day: 20,
      last_day: 31,
      today: '2026-08-28',
      admin_exempt: false,
    })
    mocks.listDocuments.mockResolvedValue({ count: 0, results: [] })
    mocks.listIncidents.mockResolvedValue({ count: 0, results: [] })
    mocks.listAlerts.mockResolvedValue({ count: 0, results: [] })
    mocks.listMaintenancePlans.mockResolvedValue({ count: 0, results: [] })
    mocks.uploadDocument.mockResolvedValue({ id: 7, status: 'archived' })
    mocks.createKmReading.mockResolvedValue({ id: 20, vehicle: 1, km_reading: 5000, reading_date: '2026-08-27' })
  })

  it('supervisor: mantenimiento, proyección y herramientas de gestión', async () => {
    renderPage()
    expect(await screen.findByText('1234KLM')).toBeInTheDocument()

    // El div de km es el COMPARTIDO con la home: última lectura y mejor día.
    expect(screen.getByText('Lectura del 26/7/2026')).toBeInTheDocument()
    expect(await screen.findByText('Mejor día para registrar los km: el 31')).toBeInTheDocument()

    // Y las MISMAS «Próximas citas» que la home: cada línea con la fecha y
    // cuántos días faltan (GAP-8: el próximo mantenimiento, entre ellas).
    expect(screen.getByText('Próximas citas')).toBeInTheDocument()
    expect(screen.getByText('Próx. mantenimiento')).toBeInTheDocument()
    expect(screen.getByText(/15\/9\/2026 · /)).toBeInTheDocument()
    expect(screen.getByText(/30\/9\/2026 · /)).toBeInTheDocument()
    // La lectura pendiente también es una cita: el último día de la ventana.
    expect(screen.getByText(/el día 31 · /)).toBeInTheDocument()

    // Proyección compacta contra el contrato, como en la vista del grupo.
    expect(screen.getByText('72%')).toHaveClass('km-pct')
    expect(screen.getByText('31.000 km de 50.000 km contratados')).toBeInTheDocument()

    // Sus herramientas de tarjeta, también aquí.
    expect(screen.getByRole('button', { name: 'Actualizar mantenimiento' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar recordatorio' })).toBeInTheDocument()

    const actions = document.querySelector('.quick-actions')
    expect(Array.from(actions?.children ?? []).map((action) => action.textContent?.trim())).toEqual([
      'Registrar km',
      'Registrar ITV',
      'Actualizar mantenimiento',
      'Avería',
      'Subir documento',
      'Enviar recordatorio',
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Actualizar mantenimiento' }))
    expect(screen.getByRole('dialog', { name: 'Actualizar mantenimiento · 1234KLM' })).toBeInTheDocument()
    expect(screen.getByText(/responsabilidad de registrar los km/)).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('conductor: sin proyección ni herramientas de gestión', async () => {
    mocks.roles = ['driver']
    renderPage()
    await screen.findByText('1234KLM')

    expect(screen.queryByText('72%')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Actualizar mantenimiento' })).not.toBeInTheDocument()
    // Registrar km permanece en la ficha y abre un modal.
    await userEvent.click(screen.getByRole('button', { name: /Registrar km/ }))
    expect(screen.getByRole('dialog', { name: 'Registrar km · 1234KLM' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/Odómetro/), '5000')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar lectura' }))
    expect(mocks.createKmReading).toHaveBeenCalledWith({
      vehicle: 1,
      km_reading: 5000,
      reading_date: expect.any(String),
    })
  })

  /** Incidencia abierta de fixture (avería comunicada desde campo). */
  function openIncident(extra: Record<string, unknown> = {}) {
    return {
      id: 31,
      vehicle: 1,
      type: 'breakdown',
      type_display: 'Avería',
      date: '2026-08-25',
      description: 'Testigo de motor encendido.',
      mileage: null,
      workshop_postal_code: '',
      details: {},
      status: 'open',
      status_display: 'Abierta',
      cost: null,
      ...extra,
    }
  }

  it('muestra debajo de Situación la tarjeta FUSIONADA de alertas e incidencias', async () => {
    mocks.listAlerts.mockResolvedValue({
      count: 1,
      results: [{
        id: 8,
        type: 'itv_due',
        type_display: 'ITV próxima',
        level: 'warning',
        level_display: 'Aviso',
        status: 'open',
        status_display: 'Abierta',
        vehicle: 1,
        vehicle_plate: '1234KLM',
        user: null,
        message: 'La ITV vence pronto.',
        due_date: '2026-09-30',
        created_at: '2026-08-20',
      }],
    })
    mocks.listIncidents.mockResolvedValue({
      count: 2,
      results: [
        openIncident(),
        // Neumáticos sin comentario: la fila se explica con el parte guiado.
        openIncident({
          id: 32,
          type: 'tires',
          type_display: 'Cambio de neumático',
          description: '',
          details: { report_version: 1, change_reason: 'wear', wheel_scope: 'rear', rear_measure: '225/45 R17' },
        }),
      ],
    })
    renderPage()
    await screen.findByText('1234KLM')

    expect(await screen.findByText('Desgaste · Traseras · 225/45 R17')).toBeInTheDocument()
    const situationTitle = screen.getByText('Situación')
    const alertsTitle = screen.getByRole('heading', { name: 'Alertas e incidencias' })
    expect(situationTitle.compareDocumentPosition(alertsTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('La ITV vence pronto.').closest('.alert-card')).toHaveClass('level-warning')
    // La incidencia vive en la MISMA tarjeta que las alertas.
    expect(await screen.findByText(/Testigo de motor encendido/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Incidencias abiertas' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Alertas e incidencias' }))
    expect(screen.getByText('La ITV vence pronto.').closest('.acc-body')).toHaveAttribute('hidden')
    expect(screen.getByText(/Testigo de motor encendido/).closest('.acc-body')).toHaveAttribute('hidden')
  })

  /** Alerta abierta del coche, por tipo (para el enrutado de Resolver). */
  function openAlert(type: string, typeDisplay: string) {
    return {
      id: 8,
      type,
      type_display: typeDisplay,
      level: 'warning',
      level_display: 'Aviso',
      status: 'open',
      status_display: 'Abierta',
      vehicle: 1,
      vehicle_plate: '1234KLM',
      user: null,
      message: `Aviso de ${typeDisplay}.`,
      due_date: '2026-09-30',
      created_at: '2026-08-20',
    }
  }

  // Resolver va por TIPO, como en la bandeja: cada alerta abre el MISMO modal
  // que su botón del nav/página (ITV → Registrar ITV…); solo las que no tienen
  // registro propio (seguro…) van al modal genérico de observaciones.
  it.each([
    ['itv_due', 'ITV próxima', 'Registrar ITV · 1234KLM'],
    ['km_reading_pending', 'Lectura de km pendiente', 'Registrar km · 1234KLM'],
    ['maintenance_due', 'Mantenimiento próximo', 'Actualizar mantenimiento · 1234KLM'],
    ['insurance_due', 'Seguro próximo a vencer', 'Resolver alerta · 1234KLM'],
  ])('Resolver una alerta %s abre el mismo modal que su botón', async (type, label, dialogName) => {
    mocks.listAlerts.mockResolvedValue({ count: 1, results: [openAlert(type, label)] })
    renderPage()
    await screen.findByText('1234KLM')

    await userEvent.click(await screen.findByRole('button', { name: 'Resolver' }))
    expect(await screen.findByRole('dialog', { name: dialogName })).toBeInTheDocument()
  })

  it('el supervisor SOLUCIONA una incidencia desde la tarjeta fusionada', async () => {
    // Tras resolver, la recarga ya no la trae.
    mocks.listIncidents
      .mockResolvedValueOnce({ count: 1, results: [openIncident()] })
      .mockResolvedValue({ count: 0, results: [] })
    mocks.resolveIncident.mockResolvedValue({ id: 31, status: 'closed' })
    renderPage()
    await screen.findByText('1234KLM')

    await userEvent.click(await screen.findByRole('button', { name: 'Solucionar' }))
    expect(screen.getByRole('dialog', { name: 'Solución · Avería' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar incidencia' }))

    await waitFor(() =>
      expect(mocks.resolveIncident).toHaveBeenCalledWith(31, {
        resolution_date: expect.any(String),
      }),
    )
    // La recarga ya no la trae: desaparece de la tarjeta.
    await waitFor(() =>
      expect(screen.queryByText(/Testigo de motor encendido/)).not.toBeInTheDocument(),
    )
  })

  it('el conductor ve la incidencia en la tarjeta pero SIN botón de solucionar', async () => {
    mocks.roles = ['driver']
    mocks.listIncidents.mockResolvedValue({ count: 1, results: [openIncident()] })
    renderPage()
    await screen.findByText('1234KLM')

    expect(await screen.findByText(/Testigo de motor encendido/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Solucionar' })).not.toBeInTheDocument()
  })

  it('abre Subir documento en un modal con el vehículo fijado', async () => {
    renderPage()
    await screen.findByText('1234KLM')

    await userEvent.click(screen.getByRole('button', { name: 'Subir documento' }))
    const dialog = screen.getByRole('dialog', { name: 'Subir documento · 1234KLM' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText(/responsabilidad de registrar los km/)).toBeInTheDocument()

    const file = new File(['parte'], 'parte.pdf', { type: 'application/pdf' })
    await userEvent.upload(within(dialog).getByLabelText(/Foto o PDF/), file)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Subir' }))

    expect(mocks.uploadDocument).toHaveBeenCalledWith({
      vehicle: 1,
      type: 'other',
      expiry_date: null,
      incident: null,
      notes: '',
    }, file)
    expect(await screen.findByText('Documento subido')).toBeInTheDocument()
  })

  it('principal bloqueado (N9): km, documento y avería apagados; la ITV sigue', async () => {
    mocks.fetchVehicleSummary.mockResolvedValue({
      ...SUMMARY,
      blocked_by_link: {
        substitute_id: 9,
        plate: '4567JKL',
        reason: 'Mantenimiento',
        since: '2026-08-01',
      },
    })
    renderPage()
    await screen.findByText('1234KLM')

    expect(screen.getByText('🔒 Bloqueado por sustitución')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Registrar km/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Subir documento/ })).not.toBeInTheDocument()
    expect(document.querySelectorAll('.quick-action.is-disabled').length).toBe(3)
    // La ITV es del coche físico: sigue disponible aunque esté cubierto.
    expect(screen.getByRole('button', { name: 'Registrar ITV' })).toBeInTheDocument()
  })

  it('la ITV se registra aunque la tarjeta de documentos esté plegada (BG)', async () => {
    renderPage()
    await screen.findByText('1234KLM')

    await userEvent.click(screen.getByRole('button', { name: 'Plegar todo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Registrar ITV' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Registrar ITV · 1234KLM')).toBeInTheDocument()
  })

  it('en Mi vehículo, la ficha del coche operativo NO repite las acciones del nav', async () => {
    renderWithMode({ fleetMode: false, ownPair: { ids: [1], target: 1 } })
    await screen.findByText('1234KLM')

    expect(document.querySelector('.quick-actions')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Registrar km' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar ITV' })).not.toBeInTheDocument()
  })

  it('la ficha de un coche que NO es el operativo del nav conserva sus acciones', async () => {
    // P. ej. el principal bloqueado de la pareja: el nav apunta al sustituto.
    renderWithMode({ fleetMode: false, ownPair: { ids: [1, 9], target: 9 } })
    await screen.findByText('1234KLM')

    expect(document.querySelector('.quick-actions')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Registrar km' })).toBeInTheDocument()
  })
})
