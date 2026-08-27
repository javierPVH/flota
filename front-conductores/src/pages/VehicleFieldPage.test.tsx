// IndexedDB no existe en jsdom: fake-indexeddb lo aporta ANTES de importar la cola.
import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Role } from '../types.ts'

const mocks = vi.hoisted(() => ({
  fetchVehicle: vi.fn(),
  fetchVehicleSummary: vi.fn(),
  listDocuments: vi.fn(),
  listIncidents: vi.fn(),
  listAlerts: vi.fn(),
  listMaintenancePlans: vi.fn(),
  uploadDocument: vi.fn(),
  createKmReading: vi.fn(),
  roles: ['driver', 'supervisor'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  fetchVehicle: mocks.fetchVehicle,
  fetchVehicleSummary: mocks.fetchVehicleSummary,
  listDocuments: mocks.listDocuments,
  listIncidents: mocks.listIncidents,
  listAlerts: mocks.listAlerts,
  listMaintenancePlans: mocks.listMaintenancePlans,
  uploadDocument: mocks.uploadDocument,
  createKmReading: mocks.createKmReading,
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

describe('VehicleFieldPage (ficha de campo)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.roles = ['driver', 'supervisor']
    mocks.fetchVehicle.mockResolvedValue(VEHICLE)
    mocks.fetchVehicleSummary.mockResolvedValue(SUMMARY)
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

    // GAP-8: tercera tarjeta con el próximo mantenimiento.
    expect(screen.getByText('Próx. mantenimiento')).toBeInTheDocument()
    expect(screen.getByText('15/9/2026')).toBeInTheDocument()

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
    await userEvent.type(screen.getByLabelText('Odómetro (km totales del cuadro)'), '5000')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar lectura' }))
    expect(mocks.createKmReading).toHaveBeenCalledWith({
      vehicle: 1,
      km_reading: 5000,
      reading_date: expect.any(String),
    })
  })

  it('muestra debajo de Situación las mismas tarjetas de alertas', async () => {
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
    renderPage()
    await screen.findByText('1234KLM')

    const situationTitle = screen.getByText('Situación')
    const alertsTitle = screen.getByRole('heading', { name: 'Alertas' })
    expect(situationTitle.compareDocumentPosition(alertsTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('La ITV vence pronto.').closest('.alert-card')).toHaveClass('level-warning')
    await userEvent.click(screen.getByRole('button', { name: 'Alertas' }))
    expect(screen.getByText('La ITV vence pronto.').closest('.acc-body')).toHaveAttribute('hidden')
  })

  it('abre Subir documento en un modal con el vehículo fijado', async () => {
    renderPage()
    await screen.findByText('1234KLM')

    await userEvent.click(screen.getByRole('button', { name: 'Subir documento' }))
    const dialog = screen.getByRole('dialog', { name: 'Subir documento · 1234KLM' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText(/responsabilidad de registrar los km/)).toBeInTheDocument()

    const file = new File(['parte'], 'parte.pdf', { type: 'application/pdf' })
    await userEvent.upload(within(dialog).getByLabelText('Foto o PDF (cámara / galería)'), file)
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
})
