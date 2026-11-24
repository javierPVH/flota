import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'
import { ReadingCorrection } from './ReadingCorrection.tsx'
import { KmPane } from './RegisterKmModal.tsx'

const mocks = vi.hoisted(() => ({
  latestReading: vi.fn(),
  requestReadingChange: vi.fn(),
  createKmReading: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  latestReading: mocks.latestReading,
  requestReadingChange: mocks.requestReadingChange,
  createKmReading: mocks.createKmReading,
}))

const LECTURA = {
  id: 31,
  reading_date: '2026-10-25',
  km_reading: 49000,
  pending_change: null,
  previous: { reading_date: '2026-09-25', km_reading: 47500 },
}
const CONSUMO = {
  id: 52,
  reading_date: '2026-10-25',
  avg_consumption: '65.00',
  pending_change: null,
}

function pintar(kind: 'km' | 'fuel' = 'km') {
  render(
    <LanguageProvider>
      <ReadingCorrection kind={kind} vehicleId={21} />
    </LanguageProvider>,
  )
  return userEvent.setup()
}

/** Corregir la última lectura: se PIDE, y mientras espera se ven las dos. */
describe('ReadingCorrection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.latestReading.mockResolvedValue(LECTURA)
    mocks.requestReadingChange.mockResolvedValue({ id: 1, status: 'pending' })
  })

  it('abre cargado con la última lectura y manda solo lo que cambia', async () => {
    const user = pintar()
    await user.click(await screen.findByRole('button', { name: 'Corregir la última lectura' }))
    expect(
      screen.getByRole('dialog', { name: 'Corregir la última lectura de km' }),
    ).toBeInTheDocument()
    // La referencia es la lectura ANTERIOR a la que se corrige (la penúltima).
    expect(screen.getByText('Lectura anterior')).toBeInTheDocument()
    expect(screen.getByText('47.500 km')).toBeInTheDocument()
    const odometro = screen.getByLabelText('Odómetro (km)')
    // Con su punto de miles, como se va a leer mientras se teclea.
    expect(odometro).toHaveValue('49.000')

    await user.clear(odometro)
    await user.type(odometro, '41900')
    await user.type(screen.getByLabelText(/Por qué/), 'Bailé dos cifras.')
    await user.click(screen.getByRole('button', { name: 'Pedir la corrección' }))

    await waitFor(() =>
      expect(mocks.requestReadingChange).toHaveBeenCalledWith({
        kind: 'km',
        reading: 31,
        changes: { km_reading: 41900 },
        note: 'Bailé dos cifras.',
      }),
    )
    expect(await screen.findByText(/Corrección pedida/)).toBeInTheDocument()
    // Y se vuelve a leer la anotación: ya trae las dos cifras.
    expect(mocks.latestReading).toHaveBeenCalledTimes(2)
  })

  it('sin cambiar nada no manda nada y lo dice', async () => {
    const user = pintar()
    await user.click(await screen.findByRole('button', { name: 'Corregir la última lectura' }))
    await user.click(screen.getByRole('button', { name: 'Pedir la corrección' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No has cambiado nada')
    expect(mocks.requestReadingChange).not.toHaveBeenCalled()
  })

  it('con una corrección viva enseña las dos lecturas y no deja pedir otra', async () => {
    mocks.latestReading.mockResolvedValue({
      ...LECTURA,
      pending_change: {
        id: 4,
        changes: { km_reading: 41900 },
        note: '',
        created_at: '2026-11-18T10:00:00Z',
      },
    })
    pintar()
    expect(await screen.findByText('Corrección pendiente')).toBeInTheDocument()
    expect(screen.getByText('Original')).toBeInTheDocument()
    expect(screen.getByText('49.000 km')).toBeInTheDocument()
    expect(screen.getByText('Pendiente de cambio')).toBeInTheDocument()
    expect(screen.getByText('41.900 km')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Corregir la última lectura' })).toBeNull()
  })

  it('el consumo admite coma y viaja como decimal', async () => {
    mocks.latestReading.mockResolvedValue(CONSUMO)
    const user = pintar('fuel')
    await user.click(await screen.findByRole('button', { name: 'Corregir la última anotación' }))
    // Sin ninguna anterior, se dice.
    expect(screen.getByText(/no hay ninguna anterior/)).toBeInTheDocument()
    const consumo = screen.getByLabelText(/Consumo medio/)
    await user.clear(consumo)
    await user.type(consumo, '6,5')
    await user.click(screen.getByRole('button', { name: 'Pedir la corrección' }))
    await waitFor(() =>
      expect(mocks.requestReadingChange).toHaveBeenCalledWith({
        kind: 'fuel',
        reading: 52,
        changes: { avg_consumption: '6.5' },
        note: '',
      }),
    )
  })

  it('sin ninguna anotación (o si la carga falla) no pinta nada', async () => {
    mocks.latestReading.mockRejectedValue(new Error('sin red'))
    pintar()
    await waitFor(() => expect(mocks.latestReading).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Corregir la última lectura' })).toBeNull()
  })

  it('pedir la corrección NO guarda una lectura nueva en el formulario que la contiene', async () => {
    const user = userEvent.setup()
    render(
      <LanguageProvider>
        <KmPane vehicle={{ id: 21, plate: '1234KLM' } as Vehicle} summary={null} onSaved={vi.fn()} />
      </LanguageProvider>,
    )
    // Una lectura a medio teclear en el formulario de registrar.
    await user.type(screen.getByPlaceholderText('0'), '50000')
    await user.click(await screen.findByRole('button', { name: 'Corregir la última lectura' }))
    const odometro = screen.getByLabelText('Odómetro (km)')
    await user.clear(odometro)
    await user.type(odometro, '41900')
    await user.click(screen.getByRole('button', { name: 'Pedir la corrección' }))

    await waitFor(() => expect(mocks.requestReadingChange).toHaveBeenCalled())
    expect(mocks.createKmReading).not.toHaveBeenCalled()
  })

  it('registrar una lectura con una corrección pendiente avisa, y solo al continuar registra', async () => {
    mocks.latestReading.mockResolvedValue({
      ...LECTURA,
      pending_change: { id: 4, changes: { km_reading: 41900 }, created_at: '2026-11-18T10:00:00Z' },
    })
    mocks.createKmReading.mockResolvedValue({ id: 99 })
    const onSaved = vi.fn()
    const user = userEvent.setup()
    render(
      <LanguageProvider>
        <KmPane vehicle={{ id: 21, plate: '1234KLM' } as Vehicle} summary={null} onSaved={onSaved} />
      </LanguageProvider>,
    )
    await user.type(screen.getByPlaceholderText('0'), '50000')
    await user.click(screen.getByRole('button', { name: 'Guardar lectura' }))

    // El aviso, y todavía nada guardado.
    const aviso = await screen.findByRole('dialog', { name: 'Tienes una corrección pendiente' })
    expect(aviso).toHaveTextContent(/esa corrección se anula/)
    expect(mocks.createKmReading).not.toHaveBeenCalled()

    // Echarse atrás no registra nada.
    await user.click(within(aviso).getByRole('button', { name: 'Cancelar' }))
    expect(mocks.createKmReading).not.toHaveBeenCalled()

    // Y continuar, sí.
    await user.click(screen.getByRole('button', { name: 'Guardar lectura' }))
    const otra = await screen.findByRole('dialog', { name: 'Tienes una corrección pendiente' })
    await user.click(within(otra).getByRole('button', { name: 'Registrar y anular la corrección' }))
    await waitFor(() => expect(mocks.createKmReading).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('sin corrección pendiente registra sin preguntar nada', async () => {
    mocks.createKmReading.mockResolvedValue({ id: 99 })
    const user = userEvent.setup()
    render(
      <LanguageProvider>
        <KmPane vehicle={{ id: 21, plate: '1234KLM' } as Vehicle} summary={null} onSaved={vi.fn()} />
      </LanguageProvider>,
    )
    await user.type(screen.getByPlaceholderText('0'), '50000')
    await user.click(screen.getByRole('button', { name: 'Guardar lectura' }))
    await waitFor(() => expect(mocks.createKmReading).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
