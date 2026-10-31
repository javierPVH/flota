import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DocumentRequestsTab } from './DocumentRequestsTab.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { DocumentDeletionRequestRow } from '../api.ts'

const mocks = vi.hoisted(() => ({
  listDocumentDeletionRequests: vi.fn(),
  resolveDocumentDeletionRequest: vi.fn(),
  listDocuments: vi.fn(),
  listDocumentTypeAccess: vi.fn(),
  grantDocumentAccess: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listDocumentDeletionRequests: mocks.listDocumentDeletionRequests,
  resolveDocumentDeletionRequest: mocks.resolveDocumentDeletionRequest,
  listDocuments: mocks.listDocuments,
  listDocumentTypeAccess: mocks.listDocumentTypeAccess,
  grantDocumentAccess: mocks.grantDocumentAccess,
}))

const PETICION: DocumentDeletionRequestRow = {
  id: 5,
  document: 12,
  document_type: 'insurance',
  document_type_display: 'Seguro',
  document_created_at: '2026-09-01T09:00:00Z',
  vehicle: 3,
  vehicle_plate: '7890NPQ',
  owner_user: null,
  owner_name: '7890NPQ',
  requested_by: 9,
  requested_by_name: 'Carlos Ruiz',
  reason: 'Es de otro coche.',
  kind: 'delete',
  kind_display: 'Borrado',
  changes: {},
  changes_display: [],
  status: 'pending',
  status_display: 'Pendiente',
  resolved_by_name: '',
  resolved_at: null,
  resolution_note: '',
  created_at: '2026-09-17T10:00:00Z',
}


/** Un documento del titular tal y como lo manda el listado «visto como»
 * quien pide (`access_for`): solo lo que la lista mira. */
function documento(over: Record<string, unknown>) {
  return {
    id: 100,
    vehicle: 3,
    user: null,
    type: 'contract',
    type_display: 'Contrato',
    notes: '',
    created_at: '2026-09-01T09:00:00Z',
    supervisor_read_override: null,
    driver_read_override: null,
    driver_view_override: null,
    driver_download_override: null,
    driver_delete_override: null,
    effective_access: {
      supervisor_read: true,
      driver_read: 'own',
      driver_view: 'request',
      driver_download: 'request',
      driver_delete: 'request',
    },
    access_adjusted: false,
    can_view: false,
    can_download: false,
    view_request: '',
    download_request: '',
    subject_lists: true,
    ...over,
  }
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
    // La documentación del coche: la póliza de la petición (lectura pedida)
    // y una ficha técnica que Carlos ve directo.
    mocks.listDocuments.mockResolvedValue({
      count: 2,
      next: null,
      results: [
        documento({ id: 12, type: 'insurance', type_display: 'Seguro', view_request: 'pending' }),
        documento({
          id: 13,
          type: 'technical_sheet',
          type_display: 'Ficha técnica',
          can_view: true,
          can_download: true,
        }),
      ],
    })
    mocks.listDocumentTypeAccess.mockResolvedValue([])
    mocks.grantDocumentAccess.mockResolvedValue({})
  })

  it('«Gestionar» enseña la documentación del titular, marca la de la petición y concede fila a fila', async () => {
    mocks.listDocumentDeletionRequests.mockResolvedValue({
      count: 1,
      next: null,
      results: [{ ...PETICION, kind: 'view', kind_display: 'Lectura' }],
    })
    const user = pintar()
    await user.click(await screen.findByRole('button', { name: 'Gestionar…' }))
    // La lista vive en su pestaña, que dice cuántos documentos hay.
    await user.click(await screen.findByRole('tab', { name: 'Documentación 2' }))
    const lista = await screen.findByRole('region', { name: 'Documentación de 7890NPQ' })
    // Se pide vista como quien pide.
    expect(mocks.listDocuments).toHaveBeenCalledWith({ vehicle: 3, access_for: 9 })
    expect(within(lista).getByText('Esta petición')).toBeInTheDocument()
    expect(within(lista).getByText('Lectura pedida')).toBeInTheDocument()
    expect(within(lista).getByText('Ficha técnica')).toBeInTheDocument()
    expect(within(lista).getByText('Lo ve')).toBeInTheDocument()
    // La póliza: se le concede la lectura desde la fila; la ficha técnica no
    // ofrece nada que conceder (ya lo ve todo). Y «Acceso del grupo» en todas.
    expect(within(lista).getAllByRole('button', { name: /Acceso del grupo/ })).toHaveLength(2)
    await user.click(within(lista).getByRole('button', { name: 'Conceder lectura' }))
    await waitFor(() =>
      expect(mocks.grantDocumentAccess).toHaveBeenCalledWith(12, { user: 9, kind: 'view' }),
    )
    // Esa concesión decide la petición abierta: la bandeja se recarga.
    await waitFor(() => expect(mocks.listDocumentDeletionRequests).toHaveBeenCalledTimes(2))
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
    // La bandeja abre por «Pendientes» y, sin ninguna, lo dice; lo resuelto
    // está tras su casilla.
    expect(await screen.findByText('Nada sin decidir por aquí.')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Resueltas (1)' }))
    expect(screen.getByText('Ana Gestora')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gestionar…' })).not.toBeInTheDocument()
  })
})
