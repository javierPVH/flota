import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OpenIncidentsPanel } from './OpenIncidentsPanel.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Incident, Vehicle } from '../types.ts'

/**
 * El ciclo de una petición abierta —modificar → gestionar → resolver— vive aquí
 * y solo aquí. Se prueba sobre el componente, no desde el modal de estado: su
 * pestaña «Estados abiertos» está oculta (`SHOW_OPEN_TAB`) porque lo pendiente
 * se repasa en la ficha, y aun así este ciclo tiene que seguir funcionando.
 */

const mocks = vi.hoisted(() => ({
  manageIncident: vi.fn(),
  resolveIncident: vi.fn(),
  updateIncident: vi.fn(),
  listWorkshops: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  manageIncident: mocks.manageIncident,
  resolveIncident: mocks.resolveIncident,
  updateIncident: mocks.updateIncident,
  // El modal de resolver (dispatcher) carga el catálogo por esta función.
  listWorkshops: mocks.listWorkshops,
}))

const VEHICLE = {
  id: 21,
  plate: '1234KLM',
  brand: 'Mercedes',
  model: 'Sprinter',
  state: 'broken',
  state_display: 'Averiado',
} as unknown as Vehicle

const OPEN_INCIDENT = {
  id: 4,
  vehicle: 21,
  type: 'breakdown',
  type_display: 'Avería',
  date: '2026-08-20',
  description: 'No arranca en frío',
  mileage: null,
  workshop_postal_code: '',
  details: {},
  status: 'open',
  status_display: 'Abierta',
  cost: null,
} as unknown as Incident

function renderPanel(incidents: Incident[] | null = [OPEN_INCIDENT], loadFailed = false) {
  return render(
    <LanguageProvider>
      <OpenIncidentsPanel
        vehicle={VEHICLE}
        incidents={incidents}
        loadFailed={loadFailed}
        onReload={vi.fn()}
        onChanged={vi.fn()}
      />
    </LanguageProvider>,
  )
}

describe('OpenIncidentsPanel (peticiones abiertas de un vehículo)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listWorkshops.mockResolvedValue([])
    mocks.manageIncident.mockReset()
    mocks.resolveIncident.mockReset()
    mocks.updateIncident.mockReset()
  })

  it('gestiona la petición con la ubicación preferente y la resuelve por su tipo', async () => {
    mocks.manageIncident.mockResolvedValue({ ...OPEN_INCIDENT, workshop_postal_code: '28001' })
    mocks.resolveIncident.mockResolvedValue({ ...OPEN_INCIDENT, status: 'closed' })
    renderPanel()

    expect(screen.getByText('No arranca en frío')).toBeInTheDocument()
    // Cada línea: modificar la petición, gestionarla (ubicación) y resolverla.
    expect(screen.getByRole('button', { name: 'Modificar' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Gestión' }))
    const manageDialog = screen.getByRole('dialog', { name: 'Gestión · Avería' })
    // La gestión pide el CP, no un taller del catálogo: lo busca un tercero.
    expect(within(manageDialog).queryByRole('combobox', { name: /Taller/ })).toBeNull()
    await userEvent.type(
      within(manageDialog).getByLabelText('Código postal de la ubicación'),
      '28001',
    )
    await userEvent.click(within(manageDialog).getByRole('button', { name: 'Guardar' }))
    expect(mocks.manageIncident).toHaveBeenCalledWith(4, { workshop_postal_code: '28001' })

    // Resolver abre el modal ESPECÍFICO del tipo (avería) por el dispatcher.
    await userEvent.click(screen.getByRole('button', { name: 'Resolver' }))
    // R3-41: la FECHA es obligatoria (precargada con hoy) y el coste de la
    // reparación viaja en el payload como `cost`.
    const cost = await screen.findByLabelText('Coste (€)')
    await userEvent.type(cost, '120.5')
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))

    expect(mocks.resolveIncident).toHaveBeenCalledWith(4, {
      resolution_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      cost: '120.5',
      // Coche averiado: la casilla de vuelta a Activo viene marcada.
      return_to_active: true,
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/resuelta y cerrada/i)
  })

  it('modificar el parte guarda la fecha, la descripción y el CP', async () => {
    mocks.updateIncident.mockResolvedValue(OPEN_INCIDENT)
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Modificar' }))
    const dialog = screen.getByRole('dialog', { name: 'Modificar petición · Avería' })
    const description = within(dialog).getByLabelText('Descripción')
    await userEvent.clear(description)
    await userEvent.type(description, 'Sigue sin arrancar')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    expect(mocks.updateIncident).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ date: '2026-08-20', description: 'Sigue sin arrancar' }),
    )
  })

  it('sin nada abierto lo dice, y un fallo de carga se avisa', () => {
    renderPanel([])
    expect(screen.getByText(/No hay estados abiertos/)).toBeInTheDocument()

    renderPanel(null, true)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
