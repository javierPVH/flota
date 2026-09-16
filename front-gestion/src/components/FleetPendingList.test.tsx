// R5-45: las dos caras de `usePending` que no tenían test directo — la lista
// de TODA la flota (panel) y el modal de tres pestañas del menú ⋮.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FleetPendingList, VehiclePendingModal } from './VehiclePendingCard.tsx'
import { ConfirmProvider } from './ConfirmDialog.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listAlerts: vi.fn(),
  listIncidents: vi.fn(),
  listKmReadingsAll: vi.fn(),
  listOpenIncidents: vi.fn(),
  listEmailTemplates: vi.fn(),
  noticePreviewVehicle: vi.fn(),
  resolveIncident: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listAlerts: mocks.listAlerts,
  listIncidents: mocks.listIncidents,
  listKmReadingsAll: mocks.listKmReadingsAll,
  listOpenIncidents: mocks.listOpenIncidents,
  listEmailTemplates: mocks.listEmailTemplates,
  noticePreviewVehicle: mocks.noticePreviewVehicle,
  resolveIncident: mocks.resolveIncident,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

const CAR_A = {
  id: 21,
  plate: '1234KLM',
  brand: 'Seat',
  model: 'Leon',
  state: 'broken',
  state_display: 'Averiado',
  driver_name: 'Carlos Ruiz',
  next_itv_date: '2026-09-01',
  insurance_expiry_date: '2026-09-20',
} as unknown as Vehicle
const CAR_B = { ...CAR_A, id: 22, plate: '5678BCD', state: 'active', state_display: 'Activo' } as Vehicle

const ALERTS = [
  {
    id: 2,
    type: 'itv_due',
    type_display: 'ITV programada',
    level: 'critical',
    level_display: 'Crítica',
    status: 'open',
    vehicle: 21,
    vehicle_plate: '1234KLM',
    message: 'ITV vencida',
    due_date: '2026-09-01',
  },
  {
    id: 3,
    type: 'insurance_due',
    type_display: 'Seguro próximo / vencido',
    level: 'warning',
    level_display: 'Aviso',
    status: 'open',
    vehicle: 22,
    vehicle_plate: '5678BCD',
    message: 'Seguro vence en 10 días',
    due_date: '2026-09-25',
  },
]

const INCIDENTS = [
  {
    id: 4,
    vehicle: 22,
    vehicle_plate: '5678BCD',
    type: 'breakdown',
    type_display: 'Avería',
    date: '2026-08-20',
    description: 'No arranca en frío',
    details: {},
    status: 'on_going',
    status_display: 'En curso',
    cost: null,
    priority: 'normal',
  },
]

function wrap(ui: React.ReactNode) {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <ConfirmProvider>{ui}</ConfirmProvider>
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('FleetPendingList (lo pendiente de TODA la flota, en el panel)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listAlerts.mockResolvedValue(page(ALERTS))
    mocks.listOpenIncidents.mockResolvedValue(INCIDENTS)
    mocks.listIncidents.mockResolvedValue(page([]))
    mocks.listKmReadingsAll.mockResolvedValue([])
    mocks.listEmailTemplates.mockResolvedValue(page([]))
    mocks.noticePreviewVehicle.mockResolvedValue({ subject: '', body_html: '', has_template: false, has_en: false })
  })

  it('pide sin filtro de coche, nombra el coche en cada fila y su ✓ abre el modal de su tipo', async () => {
    wrap(
      <FleetPendingList
        vehicles={[CAR_A, CAR_B]}
        links={[]}
        grupoInicial="alerts"
        onChanged={vi.fn()}
      />,
    )
    // Las cargas van sin `vehicle` (es la flota entera).
    expect(await screen.findByText('ITV vencida')).toBeInTheDocument()
    expect(mocks.listAlerts).toHaveBeenCalledWith({ status: 'open' })
    expect(mocks.listOpenIncidents).toHaveBeenCalledWith({})
    // Cada fila dice de qué coche es, y así se nombra su ✓.
    expect(screen.getByText('5678BCD')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Resolver · 1234KLM · ITV programada' }))
    expect(await screen.findByRole('dialog', { name: 'Registrar ITV · 1234KLM' })).toBeInTheDocument()
  })

  it('la pestaña de incidencias lista las abiertas con su estado', async () => {
    wrap(
      <FleetPendingList
        vehicles={[CAR_A, CAR_B]}
        links={[]}
        grupoInicial="incidents"
        onChanged={vi.fn()}
      />,
    )
    expect(await screen.findByText('No arranca en frío')).toBeInTheDocument()
    expect(screen.getByText('En curso')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolver · 5678BCD · Avería' })).toBeInTheDocument()
  })
})

describe('VehiclePendingModal (menú ⋮: Nuevo estado · Alertas · Incidencias)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listAlerts.mockResolvedValue(page([ALERTS[0]]))
    mocks.listOpenIncidents.mockResolvedValue([{ ...INCIDENTS[0], vehicle: 21, vehicle_plate: '1234KLM' }])
    mocks.listIncidents.mockResolvedValue(page([]))
    mocks.listKmReadingsAll.mockResolvedValue([])
    mocks.listEmailTemplates.mockResolvedValue(page([]))
    mocks.noticePreviewVehicle.mockResolvedValue({ subject: '', body_html: '', has_template: false, has_en: false })
  })

  it('abre en «Nuevo estado» con los contadores en las otras dos pestañas, y cambia de lista sin perder el formulario', async () => {
    wrap(
      <VehiclePendingModal
        vehicle={CAR_A}
        allVehicles={[CAR_A, CAR_B]}
        links={[]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Alertas e incidencias · 1234KLM' })
    const tabs = within(dialog).getByRole('tablist', { name: 'Alertas e incidencias · 1234KLM' })
    expect(within(tabs).getByRole('tab', { name: /Nuevo estado/ })).toHaveAttribute('aria-selected', 'true')
    // Los contadores llegan con las cargas: 1 alerta, 1 incidencia.
    expect(await within(tabs).findByRole('tab', { name: /Alertas\s*1/ })).toBeInTheDocument()
    expect(within(tabs).getByRole('tab', { name: /Incidencias\s*1/ })).toBeInTheDocument()

    await userEvent.click(within(tabs).getByRole('tab', { name: /Incidencias/ }))
    expect(await within(dialog).findByText('No arranca en frío')).toBeInTheDocument()
    // El formulario sigue montado (oculto con `hidden`), no se desmonta al
    // cambiar de pestaña: por eso hay que consultarlo con `hidden: true`.
    expect(
      within(dialog).getByRole('combobox', { name: /Nuevo estado/, hidden: true }),
    ).toBeInTheDocument()
  })
})
