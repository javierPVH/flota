import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AlertsPage } from './AlertsPage.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Role } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listAlerts: vi.fn(),
  fetchVehicleSummaries: vi.fn(),
  createKmReading: vi.fn(),
  registerItv: vi.fn(),
  listMaintenancePlans: vi.fn(),
  markMaintenanceDone: vi.fn(),
  resolveAlert: vi.fn(),
  roles: ['driver'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listAlerts: mocks.listAlerts,
  fetchVehicleSummaries: mocks.fetchVehicleSummaries,
  createKmReading: mocks.createKmReading,
  registerItv: mocks.registerItv,
  listMaintenancePlans: mocks.listMaintenancePlans,
  markMaintenanceDone: mocks.markMaintenanceDone,
  resolveAlert: mocks.resolveAlert,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'x', roles: mocks.roles } }),
}))

// El push (M8) no aplica en jsdom: estado 'disabled' oculta su panel.
vi.mock('../push.ts', () => ({
  pushState: () => Promise.resolve('disabled'),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}))

const KM_ALERT = {
  id: 1,
  type: 'km_reading_pending',
  type_display: 'Lectura de km pendiente',
  level: 'warning',
  level_display: 'Aviso',
  status: 'open',
  status_display: 'Abierta',
  vehicle: 7,
  vehicle_plate: '7890NPQ',
  user: null,
  message: 'Falta la lectura de km de 2026-07.',
  due_date: null,
  created_at: '2026-07-22T00:00:00Z',
}

// Segunda alerta del MISMO coche (para el desglose de la cabecera) y una
// crítica de otro coche (para el orden por urgencia).
const ITV_ALERT = {
  ...KM_ALERT,
  id: 2,
  type: 'itv_due',
  type_display: 'ITV próxima',
  message: 'La ITV vence el 2026-09-01.',
}
const OTHER_CAR_ALERT = {
  ...KM_ALERT,
  id: 3,
  type: 'itv_due',
  type_display: 'ITV próxima',
  level: 'critical',
  level_display: 'Crítica',
  vehicle: 8,
  vehicle_plate: '1111AAA',
  message: 'ITV vencida.',
}

function renderPage() {
  // AlertsPage usa useLang: el provider es obligatorio (idioma por defecto: es).
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <AlertsPage />
      </MemoryRouter>
    </LanguageProvider>,
  )
}

describe('AlertsPage (M5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.roles = ['driver']
    mocks.listAlerts.mockResolvedValue({
      count: 3,
      results: [KM_ALERT, ITV_ALERT, OTHER_CAR_ALERT],
    })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { vehicle: 7, plate: '7890NPQ', km_reading_date: null, km_current: null, driver: null },
    ])
    mocks.registerItv.mockResolvedValue({})
    mocks.listMaintenancePlans.mockResolvedValue({ count: 0, results: [] })
  })

  it('agrupa por coche en acordeones plegados con el desglose por tipo', async () => {
    renderPage()
    // Cabecera del 7890NPQ: total y cuántas de cada tipo.
    expect(await screen.findByText('7890NPQ')).toBeInTheDocument()
    expect(screen.getByText('2 alertas')).toBeInTheDocument()
    expect(
      screen.getByText('Lectura de km pendiente ×1 · ITV próxima ×1'),
    ).toBeInTheDocument()
    // El otro coche, con la suya (crítica: su grupo va primero).
    expect(screen.getByText('1111AAA')).toBeInTheDocument()
    expect(screen.getByText('1 alerta')).toBeInTheDocument()

    // Plegados por defecto: el detalle de la alerta no se ve…
    expect(screen.getByText('Falta la lectura de km de 2026-07.')).not.toBeVisible()
    // …hasta desplegar el acordeón de su coche Y el subgrupo de su tipo
    // (los subgrupos también nacen encogidos).
    await userEvent.click(screen.getByText('7890NPQ'))
    expect(screen.getByText('Falta la lectura de km de 2026-07.')).not.toBeVisible()
    await userEvent.click(screen.getByText('Lectura de km pendiente ×1'))
    expect(screen.getByText('Falta la lectura de km de 2026-07.')).toBeVisible()
    // Acción natural: registrar km con el vehículo preseleccionado.
    expect(screen.getByRole('link', { name: /Registrar km/ })).toHaveAttribute(
      'href',
      '/registrar?vehiculo=7',
    )
    // El conductor no resuelve.
    expect(screen.queryByRole('button', { name: 'Resolver' })).not.toBeInTheDocument()
  })

  it('cada acordeón clasifica sus alertas con un select por tipo, en "Todas" por defecto', async () => {
    renderPage()
    await userEvent.click(await screen.findByText('7890NPQ'))

    // El select del coche con dos tipos: "Todas (2)" por defecto + un tipo por
    // opción con su recuento. El coche de un solo tipo no lo pinta.
    const filter = screen.getByRole('combobox', { name: 'Filtrar por tipo de alerta' })
    expect(filter).toHaveValue('all')
    expect(within(filter).getAllByRole('option').map((x) => x.textContent)).toEqual([
      'Todas (2)',
      'Lectura de km pendiente (1)',
      'ITV próxima (1)',
    ])

    // En «Todas», las alertas van SECCIONADAS por tipo: línea divisoria y un
    // título por tipo que funciona como acordeón. Los subgrupos nacen
    // ENCOGIDOS: al abrir el coche se ve solo el índice de tipos.
    const kmSection = screen.getByText('Lectura de km pendiente ×1')
    expect(screen.getByText('Falta la lectura de km de 2026-07.')).not.toBeVisible()
    expect(screen.getByText('La ITV vence el 2026-09-01.')).not.toBeVisible()
    // El título abre SOLO su grupo (el de ITV sigue plegado).
    await userEvent.click(kmSection)
    expect(screen.getByText('Falta la lectura de km de 2026-07.')).toBeVisible()
    expect(screen.getByText('La ITV vence el 2026-09-01.')).not.toBeVisible()
    await userEvent.click(kmSection)
    expect(screen.getByText('Falta la lectura de km de 2026-07.')).not.toBeVisible()

    // Clasificar por ITV recorta la lista del coche (plana, sin subgrupos);
    // la cabecera no cambia.
    await userEvent.selectOptions(filter, 'itv_due')
    expect(screen.getByText('La ITV vence el 2026-09-01.')).toBeVisible()
    expect(screen.queryByText('Falta la lectura de km de 2026-07.')).not.toBeInTheDocument()
    expect(screen.getByText('2 alertas')).toBeInTheDocument()

    // Y de vuelta a "Todas": los subgrupos vuelven encogidos.
    await userEvent.selectOptions(filter, 'all')
    expect(screen.getByText('Falta la lectura de km de 2026-07.')).not.toBeVisible()
  })

  it('el clasificador global deja solo ese tipo y retira los selects internos', async () => {
    renderPage()
    // Al inicio de la bandeja, en «Todas» por defecto, con el recuento global
    // por tipo (el orden sigue la urgencia: la crítica de ITV va primero).
    const global = await screen.findByRole('combobox', {
      name: 'Clasificar las alertas por tipo',
    })
    expect(global).toHaveValue('all')
    expect(within(global).getAllByRole('option').map((x) => x.textContent)).toEqual([
      'Todas (3)',
      'ITV próxima (2)',
      'Lectura de km pendiente (1)',
    ])

    // Clasificar por lectura pendiente: el coche sin ese tipo desaparece y el
    // que queda pierde su select interno y sus subgrupos (lista plana).
    await userEvent.selectOptions(global, 'km_reading_pending')
    expect(screen.queryByText('1111AAA')).not.toBeInTheDocument()
    expect(screen.getByText('Lectura de km pendiente ×1')).toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', { name: 'Filtrar por tipo de alerta' }),
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('7890NPQ'))
    expect(screen.getByText('Falta la lectura de km de 2026-07.')).toBeVisible()

    // De vuelta a «Todas», la bandeja completa.
    await userEvent.selectOptions(global, 'all')
    expect(screen.getByText('1111AAA')).toBeInTheDocument()
  })

  it('el supervisor resuelve con un modal personalizado por tipo', async () => {
    mocks.roles = ['driver', 'supervisor']
    mocks.createKmReading.mockResolvedValue({})
    mocks.resolveAlert.mockResolvedValue({})
    renderPage()
    await screen.findAllByText('7890NPQ')
    // El panel de lecturas pendientes ya no existe; los summaries se siguen
    // pidiendo (M12: SOLO los pendientes) para la pista del modal de resolver.
    expect(screen.queryByText('Lecturas pendientes del grupo')).not.toBeInTheDocument()
    expect(mocks.fetchVehicleSummaries).toHaveBeenCalledWith([7])
    // Resolver es el único cierre: descartar ya no existe en el dominio.
    expect(screen.queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument()

    // Lectura pendiente: Resolver abre el FORMULARIO de registrar km (y el
    // botón suelto de "Registrar km" desaparece para el supervisor).
    await userEvent.click(screen.getAllByText('7890NPQ')[0])
    await userEvent.click(screen.getByText('Lectura de km pendiente ×1'))
    expect(screen.queryByRole('link', { name: /Registrar km/ })).not.toBeInTheDocument()
    const kmCard = screen
      .getByText('Falta la lectura de km de 2026-07.')
      .closest('.alert-card') as HTMLElement
    await userEvent.click(within(kmCard).getByRole('button', { name: 'Resolver' }))
    const kmDialog = screen.getByRole('dialog', { name: 'Registrar km · 7890NPQ' })
    expect(kmDialog).toBeInTheDocument()
    await userEvent.type(within(kmDialog).getByLabelText(/Odómetro/), '4750')
    await userEvent.click(within(kmDialog).getByRole('button', { name: 'Guardar lectura' }))
    expect(mocks.createKmReading).toHaveBeenCalledWith({
      vehicle: 7,
      km_reading: 4750,
      reading_date: expect.any(String),
      client_ref: expect.any(String),
    })
    expect(mocks.resolveAlert).not.toHaveBeenCalled()
    expect(await screen.findByText('Alerta de 7890NPQ resuelta.')).toBeInTheDocument()

    // ITV: reutiliza exactamente el modal Registrar ITV de la ficha.
    await userEvent.click(screen.getAllByText('7890NPQ')[0])
    await userEvent.click(screen.getAllByText('ITV próxima ×1')[1])
    const itvCard = screen
      .getByText('La ITV vence el 2026-09-01.')
      .closest('.alert-card') as HTMLElement
    await userEvent.click(within(itvCard).getByRole('button', { name: 'Resolver' }))
    const itvDialog = screen.getByRole('dialog', { name: 'Registrar ITV · 7890NPQ' })
    fireEvent.change(within(itvDialog).getByLabelText('Próxima ITV (opcional)'), {
      target: { value: '2027-09-01' },
    })
    await userEvent.click(within(itvDialog).getByRole('button', { name: 'Registrar ITV' }))
    expect(mocks.registerItv).toHaveBeenCalledWith({
      vehicle: 7,
      event_date: expect.any(String),
      itv: { result: 'done', next_due: '2027-09-01' },
      client_ref: expect.any(String),
    })
  })

  it('una alerta de mantenimiento abre el mismo modal exclusivo de la ficha', async () => {
    mocks.roles = ['driver', 'supervisor']
    mocks.listAlerts.mockResolvedValue({
      count: 1,
      results: [{
        ...KM_ALERT,
        id: 4,
        type: 'maintenance_due',
        type_display: 'Mantenimiento próximo',
        message: 'La revisión anual está pendiente.',
      }],
    })
    mocks.fetchVehicleSummaries.mockResolvedValue([])
    mocks.listMaintenancePlans.mockResolvedValue({
      count: 1,
      results: [{
        id: 9,
        vehicle: 7,
        vehicle_plate: '7890NPQ',
        name: 'Revisión anual',
        every_km: null,
        every_months: 12,
        last_done_date: '2025-08-20',
        last_done_km: null,
      }],
    })
    mocks.markMaintenanceDone.mockResolvedValue({
      id: 9,
      vehicle: 7,
      vehicle_plate: '7890NPQ',
      name: 'Revisión anual',
      every_km: null,
      every_months: 12,
      last_done_date: '2026-08-27',
      last_done_km: null,
      alerts_resolved: 1,
    })

    renderPage()
    await userEvent.click(await screen.findByText('7890NPQ'))
    await userEvent.click(screen.getByText('Mantenimiento próximo ×1'))
    const card = screen.getByText('La revisión anual está pendiente.').closest('.alert-card') as HTMLElement
    await userEvent.click(within(card).getByRole('button', { name: 'Resolver' }))

    const dialog = screen.getByRole('dialog', { name: 'Actualizar mantenimiento · 7890NPQ' })
    expect(within(dialog).queryByRole('tab')).not.toBeInTheDocument()
    expect(await within(dialog).findByText('Revisión anual')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Realizado en:' }))
    const dateDialog = screen.getByRole('dialog', { name: 'Realizar mantenimiento · Revisión anual' })
    await userEvent.click(within(dateDialog).getByRole('button', { name: 'Aceptar fecha' }))
    expect(mocks.markMaintenanceDone).toHaveBeenCalledWith(9, { date: expect.any(String) })
  })

  it('sin alertas abiertas, estado vacío amable', async () => {
    mocks.listAlerts.mockResolvedValue({ count: 0, results: [] })
    renderPage()
    expect(await screen.findByText('Sin alertas abiertas. Todo al día.')).toBeInTheDocument()
  })
})
