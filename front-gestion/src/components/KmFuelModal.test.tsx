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
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listKmReadingsAll: mocks.listKmReadingsAll,
  createKmReading: mocks.createKmReading,
  listFuelConsumptions: mocks.listFuelConsumptions,
  createFuelConsumption: mocks.createFuelConsumption,
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
        name: 'Consumo medio real en ese momento (l/km o kWh/km)',
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
})
