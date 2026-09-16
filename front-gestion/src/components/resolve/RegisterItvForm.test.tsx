import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RegisterItvForm } from './RegisterItvForm.tsx'
import { LanguageProvider } from '../../i18n.tsx'
import type { Vehicle } from '../../types.ts'

const mocks = vi.hoisted(() => ({
  registerItv: vi.fn(),
  uploadDocument: vi.fn(),
}))

vi.mock('../../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.ts')>()),
  registerItv: mocks.registerItv,
  uploadDocument: mocks.uploadDocument,
}))

// 21 está «En ITV» (la casilla aplica); 22 está Activo (no aplica).
const VEHICLES = [
  { id: 21, plate: '1234KLM', brand: 'Seat', model: 'Leon', state: 'itv' },
  { id: 22, plate: '5678XYZ', brand: 'Ford', model: 'Focus', state: 'active' },
] as unknown as Vehicle[]

type Props = Parameters<typeof RegisterItvForm>[0]

function renderForm(props: Partial<Props> = {}) {
  const onSaved = vi.fn()
  render(
    <LanguageProvider>
      <RegisterItvForm
        vehicles={VEHICLES}
        initialVehicleId={21}
        onClose={vi.fn()}
        onSaved={onSaved}
        {...props}
      />
    </LanguageProvider>,
  )
  return onSaved
}

describe('RegisterItvForm (estación, km, informe y vuelta a Activo)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.registerItv.mockReset()
    mocks.uploadDocument.mockReset()
    mocks.registerItv.mockResolvedValue({
      id: 1,
      alerts_resolved: 1,
      incident_closed: 8,
      vehicle_reactivated: true,
    })
  })

  it('favorable en un coche «En ITV»: km y casilla marcada van al back, sin estación', async () => {
    const onSaved = renderForm()
    // El registro ya NO pregunta la estación (dinámica antigua): el taller o la
    // estación se deciden en la gestión de la petición, con su CP.
    expect(screen.queryByRole('combobox', { name: 'Estación ITV' })).toBeNull()
    await userEvent.type(await screen.findByLabelText('Km en la inspección'), '81000')
    await userEvent.type(screen.getByLabelText('Próxima ITV'), '2028-09-01')
    expect(screen.getByRole('checkbox', { name: /Devolver el vehículo a Activo/ })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(mocks.registerItv).toHaveBeenCalledWith({
      vehicle: 21,
      event_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      notes: undefined,
      itv: { result: 'done', next_due: '2028-09-01', km: 81000 },
      return_to_active: true,
    })
    expect(onSaved.mock.calls[0][0]).toMatch(/vuelve a estar Activo/)
    expect(mocks.uploadDocument).not.toHaveBeenCalled()
  })

  it('desfavorable: sin próxima fecha, sin casilla y sin `return_to_active`', async () => {
    const onSaved = renderForm()
    await screen.findByLabelText('Km en la inspección')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Resultado' }), 'not done')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByLabelText('Próxima ITV')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(mocks.registerItv).toHaveBeenCalledWith({
      vehicle: 21,
      event_date: expect.any(String),
      notes: undefined,
      itv: { result: 'not done', next_due: null },
    })
  })

  it('la casilla sigue al vehículo elegido: en un coche Activo no aparece', async () => {
    renderForm({ initialVehicleId: 22 })
    await screen.findByLabelText('Km en la inspección')
    expect(screen.queryByRole('checkbox')).toBeNull()
    // Al pasar al coche «En ITV» aparece, y marcada por defecto.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Vehículo' }), '21')
    expect(screen.getByRole('checkbox', { name: /Devolver el vehículo a Activo/ })).toBeChecked()
  })

  it('el informe se sube DESPUÉS, ligado a la ITV recién registrada (su registro)', async () => {
    mocks.uploadDocument.mockResolvedValue({})
    const onSaved = renderForm()
    await screen.findByLabelText('Km en la inspección')
    await userEvent.type(screen.getByLabelText('Próxima ITV'), '2028-09-01')
    const file = new File(['pdf'], 'informe.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText(/Adjuntar el informe de la ITV/), file)
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    // Ni la incidencia dada ni la que el back cerró: el informe es DE esa ITV.
    expect(mocks.uploadDocument).toHaveBeenCalledWith(
      { vehicle: 21, event: 1, type: 'itv_report' },
      file,
    )
  })

  it('si el informe no se puede subir, el registro ya hecho no se rompe y se avisa', async () => {
    mocks.uploadDocument.mockRejectedValue(new Error('drive caído'))
    const onSaved = renderForm()
    await screen.findByLabelText('Km en la inspección')
    await userEvent.type(screen.getByLabelText('Próxima ITV'), '2028-09-01')
    const file = new File(['pdf'], 'informe.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText(/Adjuntar el informe de la ITV/), file)
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(mocks.uploadDocument).toHaveBeenCalledWith(
      { vehicle: 21, event: 1, type: 'itv_report' },
      file,
    )
    expect(onSaved.mock.calls[0][0]).toMatch(/no se pudo subir «informe.pdf»/)
  })
})
