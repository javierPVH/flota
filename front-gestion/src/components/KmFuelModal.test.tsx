import { render, screen } from '@testing-library/react'
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
  updateFuelConsumption: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listKmReadingsAll: mocks.listKmReadingsAll,
  createKmReading: mocks.createKmReading,
  listFuelConsumptions: mocks.listFuelConsumptions,
  createFuelConsumption: mocks.createFuelConsumption,
  updateFuelConsumption: mocks.updateFuelConsumption,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

const VEHICLE = { id: 21, plate: '1234KLM', brand: 'Mercedes', model: 'Sprinter' } as Vehicle

const FUEL_ROW = {
  id: 3,
  vehicle: 21,
  vehicle_plate: '1234KLM',
  period: '2026-07-01',
  liters: '80.00',
  amount: '120.00',
  source: 'manual',
  source_display: 'Manual',
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
    mocks.listKmReadingsAll.mockResolvedValue(
      page([{ id: 1, vehicle: 21, reading_date: '2026-08-01', km_reading: 45000 }]),
    )
    mocks.listFuelConsumptions.mockResolvedValue(page([FUEL_ROW]))
    mocks.createKmReading.mockReset()
    mocks.createFuelConsumption.mockReset()
    mocks.updateFuelConsumption.mockReset()
  })

  it('la pestaña de kilómetros enseña la última lectura y registra la nueva', async () => {
    mocks.createKmReading.mockResolvedValue({})
    renderModal()

    // Última lectura a la vista (contexto para no meter una cifra menor).
    expect(await screen.findByText(/45\.000 km/)).toBeInTheDocument()
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Lectura de km' }), '45600')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar lectura' }))

    expect(mocks.createKmReading).toHaveBeenCalledWith({
      vehicle: 21,
      km_reading: 45600,
      reading_date: todayIso(),
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/Lectura registrada/)
  })

  it('el combustible es mensual: mes nuevo crea, mes ya registrado actualiza', async () => {
    mocks.createFuelConsumption.mockResolvedValue({})
    mocks.updateFuelConsumption.mockResolvedValue({})
    renderModal()

    await userEvent.click(screen.getByRole('tab', { name: 'Combustible' }))
    // La serie reciente sale listada.
    expect(await screen.findByText('2026-07')).toBeInTheDocument()

    // Sin importe: aquí solo se registran litros (el importe va por la ficha).
    expect(screen.queryByRole('spinbutton', { name: /Importe/ })).not.toBeInTheDocument()

    // Mes NUEVO → alta con origen manual.
    const month = document.querySelector<HTMLInputElement>('input[type="month"]')
    await userEvent.clear(month!)
    await userEvent.type(month!, '2026-08')
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Litros' }), '95.5')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar consumo' }))
    expect(mocks.createFuelConsumption).toHaveBeenCalledWith({
      vehicle: 21,
      period: '2026-08-01',
      liters: '95.5',
      source: 'manual',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/guardado/i)

    // Mes YA registrado → se ACTUALIZA su fila (no se duplica) y el importe
    // que tuviera guardado NO se pisa.
    await userEvent.clear(month!)
    await userEvent.type(month!, '2026-07')
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Litros' }), '82')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar consumo' }))
    expect(mocks.updateFuelConsumption).toHaveBeenCalledWith(3, { liters: '82' })
    expect(await screen.findByRole('status')).toHaveTextContent(/actualizado/i)
  })
})
