import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IncidentChangeTab } from './IncidentChangeTab.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { IncidentChangeRequestRow } from '../api.ts'

const mocks = vi.hoisted(() => ({
  listIncidentChangeRequests: vi.fn(),
  resolveIncidentChangeRequest: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listIncidentChangeRequests: mocks.listIncidentChangeRequests,
  resolveIncidentChangeRequest: mocks.resolveIncidentChangeRequest,
}))

const PROPUESTA: IncidentChangeRequestRow = {
  id: 4,
  incident: 11,
  vehicle: 21,
  vehicle_plate: '1234KLM',
  incident_type: 'breakdown',
  incident_type_display: 'Avería',
  incident_description: 'No arranca en frío',
  requested_by: 9,
  requested_by_name: 'Carlos Ruiz',
  changes: { mileage: 41200 },
  changes_display: [
    { field: 'mileage', label: 'Kilometraje', current: '41000', proposed: '41200' },
  ],
  note: 'Me equivoqué con los km.',
  status: 'pending',
  status_display: 'Pendiente',
  resolved_by_name: '',
  resolved_at: null,
  resolution_note: '',
  created_at: '2026-09-18T10:00:00Z',
}

function pintar() {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <IncidentChangeTab />
      </LanguageProvider>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

describe('Bandeja de propuestas de modificar el parte', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listIncidentChangeRequests.mockResolvedValue({
      count: 1,
      results: [PROPUESTA],
      next: null,
    })
    mocks.resolveIncidentChangeRequest.mockResolvedValue({ ...PROPUESTA, status: 'done' })
  })

  it('la fila dice de qué incidencia es y el antes y el después de cada campo', async () => {
    const user = pintar()
    expect(await screen.findByText('1234KLM')).toBeInTheDocument()
    expect(screen.getByText('Avería')).toBeInTheDocument()
    expect(screen.getByText('41000')).toBeInTheDocument()
    expect(screen.getByText(/41200/)).toBeInTheDocument()
    // Quién la propuso y su nota, a la vista.
    expect(screen.getByText('Carlos Ruiz')).toBeInTheDocument()
    // La tabla repite el texto en el `title` de la celda y del recorte.
    expect(screen.getAllByTitle('Me equivoqué con los km.').length).toBeGreaterThan(0)
    // Y el modal la repite entera antes de decidir.
    await user.click(screen.getByRole('button', { name: 'Gestionar…' }))
    expect(await screen.findByRole('dialog', { name: 'Modificar el parte · 1234KLM' })).toBeInTheDocument()
  })

  it('aplicarla la manda como «done» y avisa de que el parte cambió', async () => {
    const user = pintar()
    await user.click(await screen.findByRole('button', { name: 'Gestionar…' }))
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    await waitFor(() =>
      expect(mocks.resolveIncidentChangeRequest).toHaveBeenCalledWith(4, 'done', ''),
    )
    expect(await screen.findByText('Parte de 1234KLM modificado.')).toBeInTheDocument()
  })

  it('rechazarla viaja con su motivo', async () => {
    const user = pintar()
    await user.click(await screen.findByRole('button', { name: 'Gestionar…' }))
    await user.selectOptions(screen.getByLabelText('Qué se hace con la propuesta'), 'reject')
    await user.type(screen.getByLabelText('Observaciones (opcional)'), 'Los km son los del taller.')
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    await waitFor(() =>
      expect(mocks.resolveIncidentChangeRequest).toHaveBeenCalledWith(
        4,
        'reject',
        'Los km son los del taller.',
      ),
    )
  })
})
