import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KmFuelModal } from './KmFuelModal.tsx'
import { todayIso } from '../format.ts'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listKmReadingsAll: vi.fn(),
  createKmReading: vi.fn(),
  listFuelConsumptions: vi.fn(),
  createFuelConsumption: vi.fn(),
  updateKmReading: vi.fn(),
  updateFuelConsumption: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listKmReadingsAll: mocks.listKmReadingsAll,
  createKmReading: mocks.createKmReading,
  listFuelConsumptions: mocks.listFuelConsumptions,
  createFuelConsumption: mocks.createFuelConsumption,
  updateKmReading: mocks.updateKmReading,
  updateFuelConsumption: mocks.updateFuelConsumption,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

const VEHICLE = { id: 21, plate: '1234KLM', brand: 'Mercedes', model: 'Sprinter' } as Vehicle

const FUEL_ROW = {
  id: 3,
  vehicle: 21,
  vehicle_plate: '1234KLM',
  reading_date: '2026-07-14',
  avg_consumption: '6.80',
}

function renderModal() {
  return render(
    <LanguageProvider>
      <KmFuelModal vehicle={VEHICLE} onClose={vi.fn()} onDone={vi.fn()} />
    </LanguageProvider>,
  )
}

describe('KmFuelModal (kilómetros y combustible)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    // Ordenadas por fecha DESCENDENTE, como las devuelve la API.
    mocks.listKmReadingsAll.mockResolvedValue(
      page([
        { id: 1, vehicle: 21, reading_date: '2026-08-01', km_reading: 45000 },
        { id: 2, vehicle: 21, reading_date: '2026-07-01', km_reading: 42000, estimated: true },
      ]),
    )
    mocks.listFuelConsumptions.mockResolvedValue(page([FUEL_ROW]))
    mocks.createKmReading.mockReset()
    mocks.createFuelConsumption.mockReset()
    mocks.updateKmReading.mockReset()
    mocks.updateFuelConsumption.mockReset()
  })

  it('la pestaña de kilómetros enseña la última lectura y registra la nueva', async () => {
    mocks.createKmReading.mockResolvedValue({})
    renderModal()

    // Última lectura a la vista (contexto para no meter una cifra menor).
    expect(await screen.findByText(/Última lectura/)).toHaveTextContent(/45\.000 km/)

    // Y debajo, el histórico corto: las últimas lecturas con su fecha.
    const historico = document.querySelector('.kmfuel-months') as HTMLElement
    expect(within(historico).getByText('1 ago 2026')).toBeInTheDocument()
    expect(within(historico).getByText(/42\.000 km \(estimada\)/)).toBeInTheDocument()
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Lectura de km' }), '45600')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar lectura' }))

    expect(mocks.createKmReading).toHaveBeenCalledWith({
      vehicle: 21,
      km_reading: 45600,
      reading_date: todayIso(),
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/Lectura registrada/)
  })

  it('el combustible es el consumo medio del ordenador de a bordo, con día y su nota', async () => {
    mocks.createFuelConsumption.mockResolvedValue({})
    renderModal()

    await userEvent.click(screen.getByRole('tab', { name: 'Combustible' }))
    // La nota dice qué cifra se anota (y cuál no).
    expect(
      screen.getByText(/anota el consumo medio que marca el ordenador de a bordo/),
    ).toBeInTheDocument()
    expect(screen.getByText(/NO anotes el "consumo histórico"/)).toBeInTheDocument()
    // Las últimas anotaciones salen con su DÍA y su cifra.
    const historico = document.querySelector('.kmfuel-months') as HTMLElement
    expect(within(historico).getByText('14 jul 2026')).toBeInTheDocument()
    expect(within(historico).getByText('6,80')).toBeInTheDocument()

    // Ni litros, ni importe, ni origen.
    expect(screen.queryByRole('spinbutton', { name: /Litros/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: /Importe/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Origen/)).not.toBeInTheDocument()

    // La fecha se elige con DÍA.
    const fecha = screen.getByLabelText('Fecha') as HTMLInputElement
    expect(fecha.type).toBe('date')
    await userEvent.clear(fecha)
    await userEvent.type(fecha, '2026-08-14')
    await userEvent.type(
      screen.getByRole('spinbutton', {
        name: 'Consumo medio real en ese momento (l/100km o kWh/100km)',
      }),
      '7.15',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Guardar consumo' }))
    expect(mocks.createFuelConsumption).toHaveBeenCalledWith({
      vehicle: 21,
      reading_date: '2026-08-14',
      avg_consumption: '7.15',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/anotado/i)
  })

  it('modificar la última lectura avisa antes y solo escribe con «Siguiente»', async () => {
    mocks.updateKmReading.mockResolvedValue({})
    renderModal()
    await screen.findByText(/Última lectura/)

    // Solo la ÚLTIMA fila lleva el lápiz.
    expect(screen.getAllByRole('button', { name: 'Modificar' })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Modificar' }))
    const lectura = screen.getByRole('spinbutton', { name: 'Lectura de km' })
    expect(lectura).toHaveValue(45000)
    await userEvent.clear(lectura)
    await userEvent.type(lectura, '44900')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambio' }))

    // El aviso dice el antes y el después, y todavía no se ha escrito nada.
    const aviso = await screen.findByRole('dialog', { name: 'Vas a modificar un registro' })
    expect(aviso).toHaveTextContent(/45\.000 km · 1 ago 2026 → 44\.900 km · 1 ago 2026/)
    expect(aviso).toHaveTextContent(/histórico/)
    expect(mocks.updateKmReading).not.toHaveBeenCalled()

    await userEvent.click(within(aviso).getByRole('button', { name: 'Siguiente' }))
    // Viaja solo lo que cambia, sobre el registro que ya existe.
    expect(mocks.updateKmReading).toHaveBeenCalledWith(1, { km_reading: 44900 })
    expect(mocks.createKmReading).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent(/Lectura modificada/)
  })

  it('cancelar el aviso no modifica nada y deja lo tecleado', async () => {
    renderModal()
    await screen.findByText(/Última lectura/)
    await userEvent.click(screen.getByRole('button', { name: 'Modificar' }))
    const lectura = screen.getByRole('spinbutton', { name: 'Lectura de km' })
    await userEvent.clear(lectura)
    await userEvent.type(lectura, '44900')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambio' }))
    const aviso = await screen.findByRole('dialog', { name: 'Vas a modificar un registro' })
    await userEvent.click(within(aviso).getByRole('button', { name: 'Cancelar' }))

    expect(mocks.updateKmReading).not.toHaveBeenCalled()
    expect(screen.getByRole('spinbutton', { name: 'Lectura de km' })).toHaveValue(44900)
  })

  it('sin cambiar nada no hay aviso: se dice y no se escribe', async () => {
    renderModal()
    await screen.findByText(/Última lectura/)
    await userEvent.click(screen.getByRole('button', { name: 'Modificar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambio' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No has cambiado nada')
    expect(mocks.updateKmReading).not.toHaveBeenCalled()
  })

  it('el último consumo se modifica igual, con su aviso', async () => {
    mocks.updateFuelConsumption.mockResolvedValue({})
    renderModal()
    await userEvent.click(screen.getByRole('tab', { name: 'Combustible' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Modificar' }))
    const consumo = screen.getByRole('spinbutton', {
      name: 'Consumo medio real en ese momento (l/100km o kWh/100km)',
    })
    await userEvent.clear(consumo)
    await userEvent.type(consumo, '7.2')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambio' }))
    const aviso = await screen.findByRole('dialog', { name: 'Vas a modificar un registro' })
    expect(aviso).toHaveTextContent(/última anotación de consumo/)
    await userEvent.click(within(aviso).getByRole('button', { name: 'Siguiente' }))

    expect(mocks.updateFuelConsumption).toHaveBeenCalledWith(3, { avg_consumption: '7.2' })
    expect(await screen.findByRole('status')).toHaveTextContent(/Consumo modificado/)
  })

  it('si el back rechaza el cambio, el motivo se lee y el formulario sigue abierto', async () => {
    mocks.updateKmReading.mockRejectedValue(new Error('El odómetro no puede retroceder'))
    renderModal()
    await screen.findByText(/Última lectura/)
    await userEvent.click(screen.getByRole('button', { name: 'Modificar' }))
    const lectura = screen.getByRole('spinbutton', { name: 'Lectura de km' })
    await userEvent.clear(lectura)
    await userEvent.type(lectura, '100')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambio' }))
    const aviso = await screen.findByRole('dialog', { name: 'Vas a modificar un registro' })
    await userEvent.click(within(aviso).getByRole('button', { name: 'Siguiente' }))

    expect(await screen.findByText(/No se pudo guardar|retroceder/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar cambio' })).toBeInTheDocument()
  })

  it('con una corrección de campo sin decidir no se modifica a mano', async () => {
    mocks.listKmReadingsAll.mockResolvedValue(
      page([
        {
          id: 1,
          vehicle: 21,
          reading_date: '2026-08-01',
          km_reading: 45000,
          pending_change: { id: 9, changes: { km_reading: 44900 } },
        },
      ]),
    )
    renderModal()
    await screen.findByText(/Última lectura/)
    expect(screen.getByRole('button', { name: 'Modificar' })).toBeDisabled()
    expect(screen.getByRole('note')).toHaveTextContent(/Solicitudes/)
  })

  it('registrar una lectura nueva con una corrección pendiente avisa de que la anula', async () => {
    mocks.createKmReading.mockResolvedValue({})
    mocks.listKmReadingsAll.mockResolvedValue(
      page([
        {
          id: 1,
          vehicle: 21,
          reading_date: '2026-08-01',
          km_reading: 45000,
          pending_change: { id: 9, changes: { km_reading: 44900 } },
        },
      ]),
    )
    renderModal()
    await screen.findByText(/Última lectura/)
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Lectura de km' }), '45600')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar lectura' }))

    const aviso = await screen.findByRole('dialog', { name: 'Hay una corrección pendiente' })
    expect(aviso).toHaveTextContent(/esa corrección se anula/)
    expect(mocks.createKmReading).not.toHaveBeenCalled()

    await userEvent.click(
      within(aviso).getByRole('button', { name: 'Registrar y anular la corrección' }),
    )
    expect(mocks.createKmReading).toHaveBeenCalledWith({
      vehicle: 21,
      km_reading: 45600,
      reading_date: todayIso(),
    })
  })
})
