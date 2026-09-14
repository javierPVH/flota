import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RenewInsuranceForm } from './RenewInsuranceForm.tsx'
import { fmtDate, plusOneYearIso } from '../../format.ts'
import { LanguageProvider } from '../../i18n.tsx'

const mocks = vi.hoisted(() => ({
  renewInsurance: vi.fn(),
  uploadDocument: vi.fn(),
}))

vi.mock('../../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.ts')>()),
  renewInsurance: mocks.renewInsurance,
  uploadDocument: mocks.uploadDocument,
}))

type Props = Parameters<typeof RenewInsuranceForm>[0]

function renderForm(props: Partial<Props> = {}) {
  const onDone = vi.fn()
  render(
    <LanguageProvider>
      <RenewInsuranceForm
        vehicleId={21}
        currentExpiry="2026-09-20"
        onClose={vi.fn()}
        onDone={onDone}
        {...props}
      />
    </LanguageProvider>,
  )
  return onDone
}

describe('RenewInsuranceForm (resolver el seguro es renovarlo)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.renewInsurance.mockReset()
    mocks.uploadDocument.mockReset()
    mocks.renewInsurance.mockResolvedValue({
      id: 21,
      changed: true,
      previous_expiry_date: '2026-09-20',
      insurance_expiry_date: '2027-09-20',
      event: 77,
      alerts_resolved: 1,
    })
  })

  it('propone un año más y renueva con la fecha y las notas', async () => {
    const onDone = renderForm()
    // El vencimiento vigente, formateado como el resto de fechas de la app.
    expect(
      screen.getByText(`Vencimiento actual: ${fmtDate('2026-09-20', 'es')}.`, { exact: false }),
    ).toBeInTheDocument()
    const date = screen.getByLabelText('Nueva fecha de vencimiento')
    expect(date).toHaveValue('2027-09-20')
    // No puede adelantar el vencimiento vigente.
    expect(date).toHaveAttribute('min', '2026-09-20')
    await userEvent.type(screen.getByLabelText('Notas'), 'Renovada con la misma aseguradora')
    await userEvent.click(screen.getByRole('button', { name: 'Renovar seguro' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.renewInsurance).toHaveBeenCalledWith(21, {
      expiry_date: '2027-09-20',
      notes: 'Renovada con la misma aseguradora',
    })
    expect(mocks.uploadDocument).not.toHaveBeenCalled()
    expect(onDone.mock.calls[0][0]).toContain(
      `Seguro renovado hasta el ${fmtDate('2027-09-20', 'es')}`,
    )
  })

  it('la póliza se sube DESPUÉS, como documento de seguro con la nueva caducidad', async () => {
    mocks.uploadDocument.mockResolvedValue({})
    const onDone = renderForm()
    const file = new File(['pdf'], 'poliza.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText(/Adjuntar la póliza/), file)
    await userEvent.click(screen.getByRole('button', { name: 'Renovar seguro' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.uploadDocument).toHaveBeenCalledWith(
      { vehicle: 21, type: 'insurance', expiry_date: '2027-09-20' },
      file,
    )
  })

  it('con la fecha ya aplicada avisa de que no había nada que renovar', async () => {
    mocks.renewInsurance.mockResolvedValue({ id: 21, changed: false, event: null, alerts_resolved: 0 })
    const onDone = renderForm()
    await userEvent.click(screen.getByRole('button', { name: 'Renovar seguro' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(onDone.mock.calls[0][0]).toMatch(/ya estaba aplicada/)
  })

  it('el atajo del correo a la renting solo sale si el padre lo ofrece', async () => {
    const onEmailRenting = vi.fn()
    renderForm({ onEmailRenting })
    await userEvent.click(screen.getByRole('button', { name: 'Mandar correo a la renting' }))
    expect(onEmailRenting).toHaveBeenCalled()
    expect(mocks.renewInsurance).not.toHaveBeenCalled()
  })

  it('sin vencimiento conocido propone hoy + 1 año y no limita la fecha', () => {
    renderForm({ currentExpiry: null })
    const date = screen.getByLabelText('Nueva fecha de vencimiento')
    expect(date).toHaveValue(plusOneYearIso(null))
    expect(date).not.toHaveAttribute('min')
    expect(screen.getByText(/Vencimiento actual: —/)).toBeInTheDocument()
  })
})

describe('plusOneYearIso (format.ts)', () => {
  it('suma un año en fecha local y tolera basura', () => {
    expect(plusOneYearIso('2026-09-20')).toBe('2027-09-20')
    expect(plusOneYearIso('2026-09-20T10:00:00Z')).toBe('2027-09-20')
    expect(plusOneYearIso('no-es-fecha')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
