import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import type { Incident } from '../types.ts'
import { IncidentChangeModal } from './IncidentChangeModal.tsx'

const mocks = vi.hoisted(() => ({
  requestIncidentChange: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  requestIncidentChange: mocks.requestIncidentChange,
}))

const INCIDENT: Incident = {
  id: 11,
  vehicle: 21,
  type: 'breakdown',
  type_display: 'Avería',
  priority: 'moderate',
  priority_display: 'Moderada',
  date: '2026-08-20',
  description: 'No arranca en frío',
  mileage: 41000,
  workshop_postal_code: '',
  details: {},
  status: 'open',
  status_display: 'Abierta',
  cost: null,
}

function pintar() {
  const onSent = vi.fn()
  const onClose = vi.fn()
  render(
    <LanguageProvider>
      <IncidentChangeModal incident={INCIDENT} onClose={onClose} onSent={onSent} />
    </LanguageProvider>,
  )
  return { user: userEvent.setup(), onSent, onClose }
}

/** El lápiz de la fila: proponer cambios al parte. Se PIDE, no se guarda. */
describe('IncidentChangeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requestIncidentChange.mockResolvedValue({ id: 1, status: 'pending' })
  })

  it('arranca con lo que la incidencia dice hoy y manda solo lo que cambia', async () => {
    const { user, onSent } = pintar()
    const dialogo = screen.getByRole('dialog', { name: 'Proponer cambios al parte' })
    expect(screen.getByLabelText('Kilometraje')).toHaveValue(41000)
    expect(screen.getByLabelText('Descripción')).toHaveValue('No arranca en frío')
    expect(dialogo).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Kilometraje'))
    await user.type(screen.getByLabelText('Kilometraje'), '41200')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Prioridad' }), 'critical')
    await user.type(screen.getByLabelText(/Por qué/), 'Me equivoqué con los km.')
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }))

    await waitFor(() =>
      expect(mocks.requestIncidentChange).toHaveBeenCalledWith({
        incident: 11,
        changes: { mileage: 41200, priority: 'critical' },
        note: 'Me equivoqué con los km.',
      }),
    )
    expect(onSent).toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('Propuesta enviada')
  })

  it('sin cambiar nada y sin nota, no manda nada y lo dice', async () => {
    const { user } = pintar()
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No has cambiado nada')
    expect(mocks.requestIncidentChange).not.toHaveBeenCalled()
  })

  it('con solo la nota, la nota es la petición', async () => {
    const { user } = pintar()
    await user.type(screen.getByLabelText(/Por qué/), 'La avería es del embrague.')
    await user.click(screen.getByRole('button', { name: 'Enviar propuesta' }))
    await waitFor(() =>
      expect(mocks.requestIncidentChange).toHaveBeenCalledWith({
        incident: 11,
        changes: {},
        note: 'La avería es del embrague.',
      }),
    )
  })
})
