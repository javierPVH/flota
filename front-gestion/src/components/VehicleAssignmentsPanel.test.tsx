import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VehicleAssignmentsPanel } from './VehicleAssignmentsPanel.tsx'
import { ConfirmProvider } from './ConfirmDialog.tsx'
import { useAccordion } from './CollapsibleCard.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listAssignments: vi.fn(),
  listDrivers: vi.fn(),
  listSupervisors: vi.fn(),
  listSupervisorChanges: vi.fn(),
  listVehicleUsages: vi.fn(),
  fetchManagedUser: vi.fn(),
  setVehicleDriver: vi.fn(),
  setUsageSplit: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listAssignments: mocks.listAssignments,
  listDrivers: mocks.listDrivers,
  listSupervisors: mocks.listSupervisors,
  listSupervisorChanges: mocks.listSupervisorChanges,
  listVehicleUsages: mocks.listVehicleUsages,
  fetchManagedUser: mocks.fetchManagedUser,
  setVehicleDriver: mocks.setVehicleDriver,
  setUsageSplit: mocks.setUsageSplit,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

// Datos de ejemplo, como el seed.
const VEHICLE = {
  id: 21,
  plate: '2026JHF',
  brand: 'Seat',
  model: 'Ibiza',
  state: 'active',
  driver_id: 7,
  driver_name: 'Víctor Cabrera',
  supervisor: 5,
  supervisor_name: 'Sara Supervisora',
  updated_at: '2026-08-01T00:00:00Z',
} as unknown as Vehicle

/** La tarjeta necesita el acordeón de la ficha: se monta como allí. */
function Host({ onChanged }: { onChanged: () => void }) {
  const accordion = useAccordion(['assignments'], [])
  return <VehicleAssignmentsPanel vehicle={VEHICLE} onChanged={onChanged} accordion={accordion} />
}

function renderPanel() {
  const onChanged = vi.fn()
  render(
    <LanguageProvider>
      <ConfirmProvider>
        <Host onChanged={onChanged} />
      </ConfirmProvider>
    </LanguageProvider>,
  )
  return { onChanged }
}

describe('VehicleAssignmentsPanel (conductor y reparto)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listAssignments.mockResolvedValue(
      page([
        {
          id: 3,
          vehicle: 21,
          driver: 7,
          driver_name: 'Víctor Cabrera',
          start_date: '2025-10-30',
          end_date: null,
          status: 'accepted',
        },
      ]),
    )
    mocks.listDrivers.mockResolvedValue([
      { id: 7, name: 'Víctor Cabrera' },
      { id: 8, name: 'Lucía Conductora' },
    ])
    mocks.listSupervisors.mockResolvedValue([{ id: 5, name: 'Sara Supervisora' }])
    mocks.listSupervisorChanges.mockResolvedValue(page([]))
    mocks.listVehicleUsages.mockResolvedValue(page([]))
    mocks.fetchManagedUser.mockResolvedValue({ id: 7, name: 'Víctor Cabrera' })
    mocks.setVehicleDriver.mockReset()
    mocks.setVehicleDriver.mockResolvedValue({})
    mocks.setUsageSplit.mockReset()
    mocks.setUsageSplit.mockResolvedValue({})
  })

  /** «Cambiar conductor» abre el MISMO modal que el ⋮ del inventario
   * (`VehicleDriverModal`), no una segunda copia con otros campos: de ahí que
   * traiga el supervisor y la papelera para dejar el puesto vacío. */
  it('«Cambiar conductor» abre el modal compartido, con supervisor y papelera', async () => {
    renderPanel()
    await screen.findAllByText('Víctor Cabrera')

    await userEvent.click(screen.getByRole('button', { name: 'Cambiar conductor' }))

    expect(await screen.findByRole('combobox', { name: 'Nuevo conductor' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Supervisor' })).toBeInTheDocument()
    // La papelera del modal compartido: quitar a quien está puesto.
    expect(
      screen.getByRole('button', { name: 'Quitar conductor o supervisor' }),
    ).toBeInTheDocument()
    // Y sale en «— Sin cambios —»: abrirlo no propone mover a nadie.
    expect(screen.getByRole('combobox', { name: 'Nuevo conductor' })).toHaveValue('__nochange__')
  })

  /** Y guarda por la misma llamada atómica, con el bloqueo optimista. */
  it('el cambio va por set-driver con el `expected_updated_at` del vehículo', async () => {
    const { onChanged } = renderPanel()
    await screen.findAllByText('Víctor Cabrera')
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar conductor' }))

    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Nuevo conductor' }),
      '8',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(mocks.setVehicleDriver).toHaveBeenCalledWith(
      21,
      expect.objectContaining({ driver: 8, expected_updated_at: '2026-08-01T00:00:00Z' }),
    )
    expect(onChanged).toHaveBeenCalled()
  })

  /** El reparto: cada conductor una sola vez, no se guarda con líneas a medias
   * y «a partes iguales» deja la suma en 100 sin echar cuentas a mano. */
  it('el reparto de uso no deja repetir persona, ni guardar sin completarlo', async () => {
    renderPanel()
    await screen.findAllByText('Víctor Cabrera')
    await userEvent.click(screen.getByRole('button', { name: 'Reparto de uso' }))

    // Sale con el conductor de hoy al 100%.
    expect(await screen.findByRole('combobox', { name: 'Persona 1' })).toHaveValue('7')
    await userEvent.click(screen.getByRole('button', { name: 'Añadir persona' }))

    // La segunda línea ya no ofrece a quien está en la primera.
    const segunda = screen.getByRole('combobox', { name: 'Persona 2' })
    expect(within(segunda).queryByRole('option', { name: 'Víctor Cabrera' })).toBeNull()
    // Y sin persona no se guarda, aunque la suma cuadre.
    expect(screen.getByText('Falta elegir la persona de alguna línea.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar reparto' })).toBeDisabled()

    await userEvent.selectOptions(segunda, '8')
    await userEvent.click(screen.getByRole('button', { name: 'Repartir a partes iguales' }))
    expect(screen.getByRole('spinbutton', { name: 'Porcentaje de la persona 1' })).toHaveValue(50)
    expect(screen.getByText('✓ El reparto cuadra (100%)')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Guardar reparto' }))
    await waitFor(() =>
      expect(mocks.setUsageSplit).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicle: 21,
          items: [
            { driver: 7, usage_percent: '50' },
            { driver: 8, usage_percent: '50' },
          ],
        }),
      ),
    )
  })
})
