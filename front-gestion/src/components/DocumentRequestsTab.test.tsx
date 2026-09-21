import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DocumentRequestsTab } from './DocumentRequestsTab.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { DocumentDeletionRequestRow } from '../api.ts'

const mocks = vi.hoisted(() => ({
  listDocumentDeletionRequests: vi.fn(),
  resolveDocumentDeletionRequest: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listDocumentDeletionRequests: mocks.listDocumentDeletionRequests,
  resolveDocumentDeletionRequest: mocks.resolveDocumentDeletionRequest,
}))

const PETICION: DocumentDeletionRequestRow = {
  id: 5,
  document: 12,
  document_type_display: 'Seguro',
  document_created_at: '2026-09-01T09:00:00Z',
  vehicle: 3,
  vehicle_plate: '7890NPQ',
  owner_name: '7890NPQ',
  requested_by: 9,
  requested_by_name: 'Carlos Ruiz',
  reason: 'Es de otro coche.',
  status: 'pending',
  status_display: 'Pendiente',
  resolved_by_name: '',
  resolved_at: null,
  resolution_note: '',
  created_at: '2026-09-17T10:00:00Z',
}

function pintar() {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <DocumentRequestsTab />
      </LanguageProvider>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

describe('Bandeja de peticiones de borrado de documentos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listDocumentDeletionRequests.mockResolvedValue({
      count: 1,
      results: [PETICION],
      next: null,
    })
    mocks.resolveDocumentDeletionRequest.mockResolvedValue({ ...PETICION, status: 'deleted' })
  })

  it('la fila dice qué se pide borrar, de quién y por qué', async () => {
    pintar()
    expect(await screen.findByText('Seguro')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '7890NPQ' })).toHaveAttribute('href', '/vehiculos/3')
    expect(screen.getByText('Carlos Ruiz')).toBeInTheDocument()
    expect(screen.getByText('Es de otro coche.')).toBeInTheDocument()
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
  })

  it('«Gestionar» ofrece las tres salidas y cada una explica lo que hace', async () => {
    const user = pintar()
    await user.click(await screen.findByRole('button', { name: 'Gestionar…' }))

    const decision = screen.getByLabelText('Qué se hace con el documento')
    // De salida, borrar de verdad; y se dice adónde va.
    expect(decision).toHaveValue('delete')
    expect(screen.getByText(/espacio de erratas/)).toBeInTheDocument()

    await user.selectOptions(decision, 'hide')
    expect(screen.getByText(/pasa a ser tuyo/)).toBeInTheDocument()
    await user.selectOptions(decision, 'reject')
    expect(screen.getByText(/No se toca el documento/)).toBeInTheDocument()
  })

  it('ocultar para el conductor manda esa decisión y recarga la bandeja', async () => {
    const user = pintar()
    await user.click(await screen.findByRole('button', { name: 'Gestionar…' }))
    await user.selectOptions(screen.getByLabelText('Qué se hace con el documento'), 'hide')
    await user.type(screen.getByLabelText('Observaciones (opcional)'), 'Lo lleva gestión')
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    await waitFor(() =>
      expect(mocks.resolveDocumentDeletionRequest).toHaveBeenCalledWith(
        5,
        'hide',
        'Lo lleva gestión',
      ),
    )
    // Dice qué ha pasado con el documento, no solo «guardado».
    expect(await screen.findByRole('status')).toHaveTextContent(/protegido y a tu nombre/)
    await waitFor(() => expect(mocks.listDocumentDeletionRequests).toHaveBeenCalledTimes(2))
  })

  it('lo ya resuelto se consulta, no se vuelve a decidir', async () => {
    mocks.listDocumentDeletionRequests.mockResolvedValue({
      count: 1,
      next: null,
      results: [
        {
          ...PETICION,
          status: 'hidden',
          status_display: 'Oculto para el conductor',
          resolved_by_name: 'Ana Gestora',
          resolved_at: '2026-09-18T08:00:00Z',
        },
      ],
    })
    const user = pintar()
    // La bandeja abre por «Pendientes»: lo resuelto está en su chip.
    expect(await screen.findByText(/Sin peticiones de borrado/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Ocultas/ }))
    expect(screen.getByText('Ana Gestora')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gestionar…' })).not.toBeInTheDocument()
  })
})
