import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AlertsPage } from './AlertsPage.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  listAlerts: vi.fn(),
  listVehicles: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listAlerts: mocks.listAlerts,
  listVehicles: mocks.listVehicles,
}))

const VEHICLE = {
  id: 21,
  plate: '1234KLM',
  brand: 'Mercedes',
  model: 'Sprinter',
  state: 'active',
  state_display: 'Activo',
  is_substitute: false,
  supervisor: 8,
  supervisor_name: 'Sara Supervisora',
  driver_name: 'Carlos Ruiz',
  driver_id: 5,
}

/** Alerta base; cada caso ajusta lo que le interesa. */
const alert = (over: Record<string, unknown>) => ({
  id: 1,
  type: 'itv_due',
  type_display: 'ITV próxima / vencida',
  level: 'critical',
  level_display: 'Crítica',
  status: 'open',
  status_display: 'Abierta',
  vehicle: 21,
  vehicle_plate: '1234KLM',
  user: null,
  message: 'ITV vencida hace 6 días',
  due_date: '2026-08-31',
  created_at: '2026-07-22T00:00:00Z',
  driver_id: 5,
  driver_name: 'Carlos Ruiz',
  supervisor_id: 8,
  supervisor_name: 'Sara Supervisora',
  resolved_at: null,
  resolved_by: null,
  resolved_by_name: '',
  ...over,
})

const page = (rows: Array<Record<string, unknown>>) => ({
  count: rows.length,
  next: null,
  previous: null,
  results: rows,
})

function renderPage(status?: string) {
  return render(
    <MemoryRouter initialEntries={[status ? `/alertas?status=${status}` : '/alertas']}>
      <LanguageProvider>
        <AlertsPage />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('AlertsPage (bandeja de alertas)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listVehicles.mockResolvedValue(page([VEHICLE]))
  })

  it('no ofrece descartar: resolver es el único cierre', async () => {
    mocks.listAlerts.mockResolvedValue(page([alert({})]))
    renderPage()
    expect(await screen.findByRole('button', { name: 'Resolver' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument()
    // Tampoco como pestaña de estado.
    expect(screen.queryByRole('tab', { name: 'Descartadas' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Resueltas' })).toBeInTheDocument()
  })

  it('en abiertas pinta conductor y responsable, y la fecha límite con formato', async () => {
    mocks.listAlerts.mockResolvedValue(page([alert({})]))
    renderPage()
    expect(await screen.findByRole('columnheader', { name: /Conductor/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Responsable/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Carlos Ruiz' })).toHaveAttribute(
      'href',
      '/conductores/5',
    )
    expect(screen.getByRole('link', { name: 'Sara Supervisora' })).toBeInTheDocument()
    // La misma forma que el resto de fechas, no el ISO crudo del back.
    expect(screen.getByText('31 ago 2026')).toBeInTheDocument()
    expect(screen.queryByText('2026-08-31')).not.toBeInTheDocument()
  })

  it('ofrece el correo de la fila', async () => {
    mocks.listAlerts.mockResolvedValue(page([alert({})]))
    renderPage()
    expect(await screen.findByRole('button', { name: 'Mandar correo' })).toBeEnabled()
  })

  it('en resueltas agrupa dentro de la tabla por año y mes, ambos plegables', async () => {
    mocks.listAlerts.mockResolvedValue(
      page([
        alert({
          id: 1,
          status: 'resolved',
          status_display: 'Resuelta',
          resolved_at: '2026-08-21T09:00:00Z',
          resolved_by: 8,
          resolved_by_name: 'Sara Supervisora',
        }),
        alert({
          id: 2,
          status: 'resolved',
          status_display: 'Resuelta',
          resolved_at: '2026-07-03T09:00:00Z',
          resolved_by: 99,
          resolved_by_name: 'Alicia Ajena',
        }),
        alert({
          id: 3,
          status: 'resolved',
          status_display: 'Resuelta',
          resolved_at: '2025-12-30T09:00:00Z',
          resolved_by: 99,
          resolved_by_name: 'Alicia Ajena',
        }),
      ]),
    )
    renderPage('resolved')

    // Un nivel por año y otro por mes, cada uno en su fila plegable.
    const y2026 = await screen.findByRole('button', { name: /^2026/ })
    const y2025 = screen.getByRole('button', { name: /^2025/ })
    const agosto = screen.getByRole('button', { name: /^Agosto/ })
    expect(y2026).toHaveAttribute('aria-expanded', 'true')
    expect(agosto).toHaveAttribute('aria-expanded', 'true')
    // Lo más reciente arriba: 2026 antes que 2025, y Agosto antes que Julio.
    const dividers = [...document.querySelectorAll('tbody button[aria-expanded]')].map(
      (b) => b.textContent,
    )
    expect(dividers[0]).toContain('2026')
    expect(dividers[1]).toContain('Agosto')
    expect(dividers[2]).toContain('Julio')
    expect(dividers[3]).toContain('2025')
    // El año cuenta todas sus filas; el mes, las suyas.
    expect(y2026.textContent).toContain('2 registros')
    expect(agosto.textContent).toContain('1 registro')

    // Cada separador ocupa TODAS las columnas.
    const columnCount = screen.getAllByRole('columnheader').length
    expect(y2026.closest('td')?.getAttribute('colspan')).toBe(String(columnCount))
    expect(agosto.closest('td')?.getAttribute('colspan')).toBe(String(columnCount))

    // Plegar el mes esconde sus filas, no las de los demás.
    await userEvent.click(agosto)
    expect(agosto).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('21 ago 2026')).not.toBeInTheDocument()
    expect(screen.getByText('3 jul 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Julio/ })).toBeInTheDocument()

    // Plegar el año esconde también sus meses.
    await userEvent.click(y2026)
    expect(screen.queryByRole('button', { name: /^Julio/ })).not.toBeInTheDocument()
    // Y el otro año sigue en su sitio.
    expect(y2025).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /^Diciembre/ })).toBeInTheDocument()
  })

  it('en resueltas no hay acciones, y sí las personas y el cierre', async () => {
    mocks.listAlerts.mockResolvedValue(
      page([
        alert({
          status: 'resolved',
          status_display: 'Resuelta',
          resolved_at: '2026-08-21T09:00:00Z',
          resolved_by: 8,
          resolved_by_name: 'Sara Supervisora',
        }),
      ]),
    )
    renderPage('resolved')
    expect(await screen.findByRole('columnheader', { name: /Resuelta el/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Resuelta por/ })).toBeInTheDocument()
    // Las personas del vehículo se ven también aquí.
    expect(screen.getByRole('columnheader', { name: /Conductor/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Responsable/ })).toBeInTheDocument()
    // Sin nada que accionar sobre una resuelta.
    expect(screen.queryByRole('columnheader', { name: 'Acciones' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mandar correo' })).not.toBeInTheDocument()
  })

  it('marca en rojo con aviso a quien cerró sin ser del vehículo', async () => {
    mocks.listAlerts.mockResolvedValue(
      page([
        alert({
          status: 'resolved',
          status_display: 'Resuelta',
          resolved_at: '2026-08-21T09:00:00Z',
          resolved_by: 99,
          resolved_by_name: 'Alicia Ajena',
        }),
      ]),
    )
    renderPage('resolved')
    const cell = (await screen.findByText('Alicia Ajena')).closest('span')
    expect(cell).toHaveClass('resolver--mismatch')
    // El bocadillo nombra a quien SÍ era conductor y responsable.
    const hint = screen.getByRole('note')
    expect(hint).toHaveAccessibleName(/Carlos Ruiz/)
    expect(hint).toHaveAccessibleName(/Sara Supervisora/)
    // Y se pinta fuera de la celda (portal en <body>) para que no la recorte.
    await userEvent.hover(hint)
    const pop = document.querySelector('.hint-bubble-pop')
    expect(pop).not.toBeNull()
    expect(pop?.parentElement).toBe(document.body)
  })

  it('el cierre automático del sistema no se marca como sospechoso', async () => {
    mocks.listAlerts.mockResolvedValue(
      page([
        alert({
          status: 'resolved',
          status_display: 'Resuelta',
          resolved_at: '2026-08-21T09:00:00Z',
          resolved_by: null,
          resolved_by_name: '',
        }),
      ]),
    )
    renderPage('resolved')
    expect(await screen.findByText('Cierre automático')).toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('resolver una alerta la cierra por la única vía que queda', async () => {
    const resolveAlert = vi.fn().mockResolvedValue({})
    const api = await import('../api.ts')
    vi.spyOn(api, 'resolveAlert').mockImplementation(resolveAlert)
    mocks.listAlerts.mockResolvedValue(page([alert({})]))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Resolver' }))
    expect(resolveAlert).toHaveBeenCalledWith(1)
    const [row] = await screen.findAllByRole('status')
    expect(within(row).getByText(/resuelta/i)).toBeInTheDocument()
  })
})
