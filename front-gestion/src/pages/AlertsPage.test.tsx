import { render, screen, waitFor, within } from '@testing-library/react'
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

  it('resolver abre su modal y cierra la alerta con la nota escrita', async () => {
    const resolveAlert = vi.fn().mockResolvedValue({})
    const api = await import('../api.ts')
    vi.spyOn(api, 'resolveAlert').mockImplementation(resolveAlert)
    mocks.listAlerts.mockResolvedValue(
      page([alert({ type: 'no_driver', type_display: 'Vehículo sin conductor' })]),
    )
    renderPage()
    // El botón de la fila ya no cierra: abre el modal de resolver.
    await userEvent.click(await screen.findByRole('button', { name: 'Resolver' }))
    expect(resolveAlert).not.toHaveBeenCalled()
    await userEvent.type(
      screen.getByPlaceholderText(/taller avisado/i),
      'Taller avisado',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Resolver alerta' }))
    expect(resolveAlert).toHaveBeenCalledWith(1, 'Taller avisado')
    const [row] = await screen.findAllByRole('status')
    expect(within(row).getByText(/resuelta/i)).toBeInTheDocument()
  })

  it('en ITV, resolver abre directamente el modal de Registrar ITV', async () => {
    mocks.listAlerts.mockResolvedValue(page([alert({})]))
    renderPage()
    // La fila ya no lleva su propio «Registrar ITV»: solo queda el de la barra.
    await screen.findByRole('button', { name: 'Resolver' })
    expect(screen.getAllByRole('button', { name: 'Registrar ITV' })).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Resolver' }))
    // Es el modal de ITV (resultado + registrar), no el de la nota.
    expect(screen.getByRole('combobox', { name: 'Resultado' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Registrar' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/taller avisado/i)).not.toBeInTheDocument()
    // Con el vehículo del aviso ya elegido.
    expect(screen.getByRole('combobox', { name: 'Vehículo' })).toHaveValue('21')
  })

  it('la lectura pendiente se resuelve registrando la lectura', async () => {
    const api = await import('../api.ts')
    const createKmReading = vi.spyOn(api, 'createKmReading').mockResolvedValue({} as never)
    const resolveAlert = vi.spyOn(api, 'resolveAlert').mockResolvedValue({} as never)
    mocks.listAlerts.mockResolvedValue(
      page([alert({ type: 'km_reading_pending', type_display: 'Lectura de km pendiente' })]),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Resolver' }))
    // La lectura es obligatoria: sin ella no se llama a nada.
    await userEvent.type(screen.getByRole('spinbutton'), '45200')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar lectura y resolver' }))
    expect(createKmReading).toHaveBeenCalledWith(
      expect.objectContaining({ vehicle: 21, km_reading: 45200 }),
    )
    expect(resolveAlert).toHaveBeenCalledWith(1, '')
  })

  it('el exceso de km ofrece candidatos con menos media y cambia el conductor', async () => {
    const api = await import('../api.ts')
    vi.spyOn(api, 'fetchDriverCandidates').mockResolvedValue({
      vehicle: {
        id: 21,
        plate: '1234KLM',
        monthly_avg: 3200,
        driver: { id: 5, name: 'Carlos Ruiz' },
      },
      candidates: [
        { id: 11, name: 'Pedro Libre', vehicles: [], monthly_avg: null },
        { id: 9, name: 'Laura Lenta', vehicles: [{ id: 30, plate: '9999ZZZ' }], monthly_avg: 700 },
      ],
    })
    const setVehicleDriver = vi.spyOn(api, 'setVehicleDriver').mockResolvedValue({} as never)
    const resolveAlert = vi.spyOn(api, 'resolveAlert').mockResolvedValue({} as never)
    mocks.listAlerts.mockResolvedValue(
      page([alert({ type: 'km_overage', type_display: 'Exceso de km proyectado' })]),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Resolver' }))

    // La media actual del coche y los candidatos, con la suya en la etiqueta.
    expect(await screen.findByText(/Media mensual del coche/)).toBeInTheDocument()
    const select = screen.getByRole('combobox', { name: 'Nuevo conductor' })
    expect(within(select).getByText(/Pedro Libre · sin coche/)).toBeInTheDocument()
    await userEvent.selectOptions(select, '9')

    await userEvent.click(screen.getByRole('button', { name: 'Cambiar conductor y resolver' }))
    expect(setVehicleDriver).toHaveBeenCalledWith(21, { driver: 9 })
    // Sin nota escrita, el histórico registra al menos el cambio de manos.
    expect(resolveAlert).toHaveBeenCalledWith(1, 'Cambio de conductor: Carlos Ruiz → Laura Lenta.')
  })

  it('el mantenimiento se resuelve registrando el servicio en su plan', async () => {
    const api = await import('../api.ts')
    vi.spyOn(api, 'listMaintenancePlans').mockResolvedValue(
      page([
        {
          id: 4,
          vehicle: 21,
          vehicle_plate: '1234KLM',
          name: 'Revisión general',
          every_km: 30000,
          every_months: 12,
          last_done_date: '2025-06-01',
          last_done_km: 10000,
          notes: '',
          created_at: '',
          updated_at: '',
        },
      ]) as never,
    )
    const done = vi.spyOn(api, 'maintenancePlanDone').mockResolvedValue({} as never)
    mocks.listAlerts.mockResolvedValue(
      page([alert({ type: 'maintenance_due', type_display: 'Mantenimiento programado' })]),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Resolver' }))

    // El plan viene preseleccionado; el servicio lleva coste y nota.
    expect(await screen.findByRole('combobox', { name: 'Plan de mantenimiento' })).toHaveValue('4')
    const [, cost] = screen.getAllByRole('spinbutton') // [km del servicio, coste]
    await userEvent.type(cost, '180.5')
    await userEvent.type(screen.getByPlaceholderText(/taller avisado/i), 'Hecho en taller')
    await userEvent.click(
      screen.getByRole('button', { name: 'Registrar mantenimiento y resolver' }),
    )
    expect(done).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ cost: '180.5', note: 'Hecho en taller' }),
    )
  })

  it('el aviso de seguro permite mandar el correo a la renting desde resolver', async () => {
    const api = await import('../api.ts')
    vi.spyOn(api, 'noticePreviewVehicle').mockResolvedValue({
      subject: 'Aviso de seguro',
      body_html: '<p>vence</p>',
      has_template: true,
      has_en: true,
    })
    mocks.listAlerts.mockResolvedValue(
      page([alert({ type: 'insurance_due', type_display: 'Seguro próximo / vencido' })]),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Resolver' }))

    // El atajo del tipo: abre el modal de correo con la renting premarcada.
    await userEvent.click(screen.getByRole('button', { name: 'Mandar correo a la renting' }))
    expect(await screen.findByRole('checkbox', { name: 'Empresa de renting' })).toBeChecked()
    // Y el modal de resolver se retira (tras su animación de salida).
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/taller avisado/i)).not.toBeInTheDocument(),
    )
  })
})
