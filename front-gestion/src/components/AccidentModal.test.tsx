import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AccidentModal } from './AccidentModal.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  createIncident: vi.fn(),
  updateVehicleFields: vi.fn(),
  uploadDocument: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  createIncident: mocks.createIncident,
  updateVehicleFields: mocks.updateVehicleFields,
  uploadDocument: mocks.uploadDocument,
}))

const VEHICLE = {
  id: 21,
  plate: '1234KLM',
  brand: 'Mercedes',
  model: 'Sprinter',
  state: 'active',
  state_display: 'Activo',
  is_substitute: false,
  updated_at: '2026-08-01T00:00:00Z',
} as unknown as Vehicle

function renderModal() {
  return render(
    <LanguageProvider>
      <AccidentModal vehicle={VEHICLE} onClose={vi.fn()} onDone={vi.fn()} />
    </LanguageProvider>,
  )
}

const type = (name: string, value: string) =>
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } })

describe('AccidentModal (comunicación de accidente)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.createIncident.mockReset()
    mocks.updateVehicleFields.mockReset()
    mocks.uploadDocument.mockReset()
  })

  it('envía el parte con terceros y lesionados y marca el coche accidentado', async () => {
    mocks.createIncident.mockResolvedValue({ id: 9, vehicle: 21 })
    mocks.updateVehicleFields.mockResolvedValue({})
    renderModal()

    // Datos del accidente (el mismo parte guiado que la PWA).
    type('Calle', 'Calle de Ejemplo')
    type('Número', '12')
    const [cp] = [...document.querySelectorAll<HTMLInputElement>('input[pattern="[0-9]{5}"]')]
    fireEvent.change(cp, { target: { value: '28001' } })
    type('Localidad', 'Madrid')
    type('Provincia', 'Madrid')
    const when = document.querySelector<HTMLInputElement>('input[type="datetime-local"]')
    fireEvent.change(when!, { target: { value: '2026-08-20T09:30' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Teléfono' }), {
      target: { value: '910 000 001' },
    })
    fireEvent.change(screen.getByLabelText('Descripción de los daños'), {
      target: { value: 'Golpe lateral en un cruce' },
    })

    // Un tercero implicado y un lesionado, con «+ Añadir».
    const [addThird, addInjured] = screen.getAllByRole('button', { name: /Añadir/ })
    await userEvent.click(addThird)
    type('Nombre y apellidos', 'Tercero de Ejemplo')
    type('Nº de póliza', 'POL-0001')
    await userEvent.click(addInjured)
    const seat = screen.getByRole('combobox', { name: 'Posición' })
    await userEvent.selectOptions(seat, 'passenger')

    await userEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }))

    expect(mocks.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicle: 21,
        type: 'accident',
        date: '2026-08-20',
        description: 'Golpe lateral en un cruce',
        details: expect.objectContaining({
          report_version: 1,
          street: 'Calle de Ejemplo',
          postal_code: '28001',
          locality: 'Madrid',
          province: 'Madrid',
          occurred_at: '2026-08-20T09:30',
          phone: '910 000 001',
          police_report_reference: '',
          third_parties: [
            expect.objectContaining({ full_name: 'Tercero de Ejemplo', policy_number: 'POL-0001' }),
          ],
          injured_people: [expect.objectContaining({ seat: 'passenger' })],
        }),
      }),
    )
    // La casilla (marcada por defecto) deja el coche «Accidentado».
    expect(mocks.updateVehicleFields).toHaveBeenCalledWith(
      21,
      expect.objectContaining({ state: 'accidente' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(/Accidente comunicado/)
  })

  it('sin la casilla no toca el estado del vehículo', async () => {
    mocks.createIncident.mockResolvedValue({ id: 10, vehicle: 21 })
    renderModal()
    type('Calle', 'Calle de Ejemplo')
    const [cp] = [...document.querySelectorAll<HTMLInputElement>('input[pattern="[0-9]{5}"]')]
    fireEvent.change(cp, { target: { value: '28001' } })
    type('Localidad', 'Madrid')
    type('Provincia', 'Madrid')
    const when = document.querySelector<HTMLInputElement>('input[type="datetime-local"]')
    fireEvent.change(when!, { target: { value: '2026-08-20T09:30' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Teléfono' }), {
      target: { value: '910 000 001' },
    })
    fireEvent.change(screen.getByLabelText('Descripción de los daños'), {
      target: { value: 'Rozadura leve' },
    })

    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Marcar el vehículo como «Accidentado»' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }))

    expect(mocks.createIncident).toHaveBeenCalled()
    expect(mocks.updateVehicleFields).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent(/Accidente comunicado/)
  })
})
