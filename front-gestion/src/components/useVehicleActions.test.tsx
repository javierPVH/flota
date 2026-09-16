// R5-45: el menú ⋮ de un vehículo (M18), compartido por inventario y panel.
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useVehicleActions, type VehicleActionsOptions } from './useVehicleActions.tsx'
import { ConfirmProvider } from './ConfirmDialog.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({ deactivateVehicle: vi.fn(), convertToFleet: vi.fn() }))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  deactivateVehicle: mocks.deactivateVehicle,
  convertToFleet: mocks.convertToFleet,
}))

const FLEET = { id: 21, plate: '1234KLM', is_substitute: false } as unknown as Vehicle
const SUB = { id: 22, plate: '2001CNY', is_substitute: true } as unknown as Vehicle

function options(overrides: Partial<VehicleActionsOptions> = {}): VehicleActionsOptions {
  return {
    onEmail: vi.fn(),
    onDriver: vi.fn(),
    onInvoices: vi.fn(),
    onPending: vi.fn(),
    onAccident: vi.fn(),
    onKmFuel: vi.fn(),
    onSchedule: vi.fn(),
    onEdit: vi.fn(),
    activeMainOfSub: new Map(),
    onDone: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  }
}

/** Pinta la celda de acciones de UNA fila, como haría la tabla. */
function Cell({ vehicle, opts }: { vehicle: Vehicle; opts: VehicleActionsOptions }) {
  const { actionsColumn } = useVehicleActions(opts)
  return <>{actionsColumn.render?.(vehicle)}</>
}

function renderCell(vehicle: Vehicle, opts: VehicleActionsOptions) {
  return render(
    <LanguageProvider>
      <ConfirmProvider>
        <Cell vehicle={vehicle} opts={opts} />
      </ConfirmProvider>
    </LanguageProvider>,
  )
}

async function openMenu() {
  await userEvent.click(screen.getByRole('button', { name: 'Acciones' }))
  return screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())
}

describe('useVehicleActions (menú ⋮ del vehículo)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.deactivateVehicle.mockReset().mockResolvedValue(undefined)
    mocks.convertToFleet.mockReset().mockResolvedValue(undefined)
  })

  it('un coche de flota tiene todo menos «Convertir», y cada entrada abre lo suyo', async () => {
    const opts = options()
    renderCell(FLEET, opts)
    const items = await openMenu()
    expect(items).toEqual([
      'Enviar correo',
      'Cambiar conductor / supervisor',
      'Gestionar facturas',
      'Kilómetros y combustible',
      'Alertas e incidencias',
      'Accidente',
      'Programar ITV y mantenimiento',
      'Editar',
      'Dar de baja',
    ])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Alertas e incidencias' }))
    expect(opts.onPending).toHaveBeenCalledWith(FLEET)
    // El menú se cierra al elegir.
    expect(screen.queryByRole('menu')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Acciones' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Editar' }))
    expect(opts.onEdit).toHaveBeenCalledWith(FLEET)
  })

  it('un sustituto no tiene correo ni conductor, y solo se convierte si no cubre a nadie', async () => {
    const { unmount } = renderCell(SUB, options())
    let items = await openMenu()
    expect(items).not.toContain('Enviar correo')
    expect(items).not.toContain('Cambiar conductor / supervisor')
    expect(items).toContain('Convertir en coche de flota')
    unmount()

    // Cubriendo al 21: convertirlo dejaría a ese coche sin sustituto.
    renderCell(SUB, options({ activeMainOfSub: new Map([[SUB.id, FLEET.id]]) }))
    items = await openMenu()
    expect(items).not.toContain('Convertir en coche de flota')
  })

  it('dar de baja pide dos confirmaciones y un motivo (N7), y recarga', async () => {
    const opts = options()
    renderCell(FLEET, opts)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Dar de baja' }))
    // Primera: «¿Desactivar…?».
    await userEvent.click(await screen.findByRole('button', { name: 'Desactivar' }))
    // Segunda, con el motivo.
    await userEvent.type(await screen.findByLabelText(/Motivo/), 'Fin de contrato')
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }))
    await waitFor(() => expect(mocks.deactivateVehicle).toHaveBeenCalledWith(21, 'Fin de contrato'))
    expect(opts.onDone).toHaveBeenCalledTimes(1)
    expect(opts.onError).not.toHaveBeenCalled()
  })

  it('cancelar la baja en la segunda confirmación no toca nada', async () => {
    const opts = options()
    renderCell(FLEET, opts)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Dar de baja' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Desactivar' }))
    await screen.findByLabelText(/Motivo/)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.deactivateVehicle).not.toHaveBeenCalled()
    expect(opts.onDone).not.toHaveBeenCalled()
  })

  it('convertir en flota lleva TRIPLE aviso; el tercero es el que convierte', async () => {
    const opts = options()
    renderCell(SUB, opts)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Convertir en coche de flota' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Continuar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Continuar' }))
    expect(mocks.convertToFleet).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: 'Convertir en flota' }))
    await waitFor(() => expect(mocks.convertToFleet).toHaveBeenCalledWith(22))
    expect(opts.onDone).toHaveBeenCalledTimes(1)
  })

  it('un fallo del back sale por onError, sin recargar', async () => {
    mocks.convertToFleet.mockRejectedValue(new Error('Está cubriendo un coche.'))
    const opts = options()
    renderCell(SUB, opts)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Convertir en coche de flota' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Continuar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Continuar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Convertir en flota' }))
    await waitFor(() => expect(opts.onError).toHaveBeenCalledWith('Está cubriendo un coche.'))
    expect(opts.onDone).not.toHaveBeenCalled()
  })

  it('R5-38: con callbacks estables la columna mantiene su identidad entre renders', () => {
    const opts = options()
    const { result, rerender } = renderHook(() => useVehicleActions(opts), {
      wrapper: ({ children }) => (
        <LanguageProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </LanguageProvider>
      ),
    })
    const primera = result.current.actionsColumn
    rerender()
    expect(result.current.actionsColumn).toBe(primera)
  })
})
