import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DocumentSupplyTab } from './DocumentSupplyTab.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { DocumentSupplyRequestRow } from '../api.ts'

const mocks = vi.hoisted(() => ({
  listDocumentSupplyRequests: vi.fn(),
  resolveDocumentSupplyRequest: vi.fn(),
  uploadDocument: vi.fn(),
  listDocuments: vi.fn(),
  listDocumentTypeAccess: vi.fn(),
  fetchDocumentAs: vi.fn(),
  grantDocumentAccess: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listDocumentSupplyRequests: mocks.listDocumentSupplyRequests,
  resolveDocumentSupplyRequest: mocks.resolveDocumentSupplyRequest,
  uploadDocument: mocks.uploadDocument,
  listDocuments: mocks.listDocuments,
  listDocumentTypeAccess: mocks.listDocumentTypeAccess,
  fetchDocumentAs: mocks.fetchDocumentAs,
  grantDocumentAccess: mocks.grantDocumentAccess,
}))

const PETICION: DocumentSupplyRequestRow = {
  id: 7,
  vehicle: 3,
  vehicle_plate: '8888TRX',
  user: null,
  user_name: '',
  type: 'contract',
  type_display: 'Contrato',
  note: 'Me lo piden en la obra.',
  requested_by: 9,
  requested_by_name: 'Carlos Ruiz',
  status: 'pending',
  status_display: 'Pendiente',
  document: null,
  document_name: '',
  resolved_by_name: '',
  resolved_at: null,
  resolution_note: '',
  created_at: '2026-10-20T10:00:00Z',
}

const PDF = () => new File(['x'], 'contrato.pdf', { type: 'application/pdf' })

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
        <DocumentSupplyTab />
      </LanguageProvider>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

async function gestionar(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Carlos Ruiz')
  await user.click(screen.getByRole('button', { name: 'Gestionar…' }))
}

describe('Bandeja de peticiones de documento', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listDocumentSupplyRequests.mockResolvedValue({
      count: 1,
      results: [PETICION],
      next: null,
    })
    mocks.uploadDocument.mockResolvedValue({ id: 55, status: 'archived' })
    mocks.resolveDocumentSupplyRequest.mockResolvedValue({ ...PETICION, status: 'done' })
    // La documentación que ya hay del coche: una ficha técnica que Carlos
    // ve directo y una póliza que no le sale en su lista.
    mocks.listDocuments.mockResolvedValue({
      count: 2,
      next: null,
      results: [
        documento({
          id: 100,
          type: 'technical_sheet',
          type_display: 'Ficha técnica',
          can_view: true,
          can_download: true,
          effective_access: {
            supervisor_read: true,
            driver_read: 'all',
            driver_view: 'allow',
            driver_download: 'allow',
            driver_delete: 'request',
          },
        }),
        documento({ id: 101, type: 'insurance', type_display: 'Seguro', subject_lists: false }),
      ],
    })
    mocks.listDocumentTypeAccess.mockResolvedValue([
      {
        type: 'contract',
        type_display: 'Contrato',
        supervisor_read: false,
        driver_read: 'own',
        driver_view: 'request',
        driver_download: 'request',
        driver_delete: 'request',
      },
    ])
    // El recién subido, visto como Carlos: lo lista y le va con solicitud.
    mocks.fetchDocumentAs.mockResolvedValue(documento({ id: 55 }))
    mocks.grantDocumentAccess.mockResolvedValue({})
  })

  it('la fila dice quién lo pide, de qué coche y para qué', async () => {
    pintar()
    expect(await screen.findByText('Carlos Ruiz')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '8888TRX' })).toHaveAttribute('href', '/vehiculos/3')
    expect(screen.getByText('Contrato')).toBeInTheDocument()
    expect(screen.getByText('Me lo piden en la obra.')).toBeInTheDocument()
  })

  it('atenderla con archivo sube el documento y lo guarda en la fila', async () => {
    const user = pintar()
    await gestionar(user)

    await user.upload(screen.getByLabelText(/Documento que se le facilita/), PDF())
    // El contrato CADUCA: en gestión su fecha es obligatoria.
    await user.click(screen.getByRole('button', { name: 'Resolver' }))
    expect(await screen.findByText(/Ese tipo de documento caduca/)).toBeInTheDocument()
    expect(mocks.uploadDocument).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/Caducidad/), '2030-01-31')
    await user.click(screen.getByRole('button', { name: 'Resolver' }))

    await waitFor(() =>
      expect(mocks.uploadDocument).toHaveBeenCalledWith(
        expect.objectContaining({ vehicle: 3, type: 'contract', expiry_date: '2030-01-31' }),
        expect.objectContaining({ name: 'contrato.pdf' }),
      ),
    )
    // Según su tipo: no viaja ningún ajuste.
    expect(mocks.uploadDocument.mock.calls[0][0]).not.toHaveProperty('driver_view_override')
    // Lo que al tipo le va con solicitud se le concede ya a quien pidió
    // (la casilla nace marcada): se mira el documento como Carlos y se le
    // concede la lectura y la descarga.
    await waitFor(() => expect(mocks.fetchDocumentAs).toHaveBeenCalledWith(55, 9))
    await waitFor(() =>
      expect(mocks.grantDocumentAccess).toHaveBeenCalledWith(55, { user: 9, kind: 'view' }),
    )
    expect(mocks.grantDocumentAccess).toHaveBeenCalledWith(55, { user: 9, kind: 'download' })
    // Y la resolución lleva el documento recién creado: la fila cuenta con
    // qué se atendió.
    await waitFor(() =>
      expect(mocks.resolveDocumentSupplyRequest).toHaveBeenCalledWith(7, 'done', '', 55),
    )
  })

  it('subirlo con un ajuste propio manda los mandos, y sin la casilla no concede nada', async () => {
    const user = pintar()
    await gestionar(user)
    await user.upload(screen.getByLabelText(/Documento que se le facilita/), PDF())
    await user.type(screen.getByLabelText(/Caducidad/), '2030-01-31')
    // De salida dice lo que el tipo hace hoy; con «ajuste propio» salen los mandos.
    expect(screen.getByText('Lo que dice hoy el tipo:')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Ajuste propio para este documento' }))
    const lectura = screen.getByRole('radiogroup', { name: 'Cómo lo ve el conductor' })
    await user.click(within(lectura).getByRole('radio', { name: 'Permitir' }))
    await user.click(screen.getByRole('checkbox', { name: /Concederle a Carlos Ruiz/ }))
    await user.click(screen.getByRole('button', { name: 'Resolver' }))

    await waitFor(() =>
      expect(mocks.uploadDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          driver_view_override: 'allow',
          driver_download_override: null,
          supervisor_read_override: null,
        }),
        expect.anything(),
      ),
    )
    await waitFor(() =>
      expect(mocks.resolveDocumentSupplyRequest).toHaveBeenCalledWith(7, 'done', '', 55),
    )
    expect(mocks.grantDocumentAccess).not.toHaveBeenCalled()
  })

  it('la lista dice qué hay del coche y cómo le va a quien pide, y se atiende con uno de ellos', async () => {
    const user = pintar()
    await gestionar(user)
    // La lista vive en su pestaña, que dice cuántos documentos hay.
    await user.click(await screen.findByRole('tab', { name: 'Documentación 2' }))
    const lista = await screen.findByRole('region', { name: 'Documentación de 8888TRX' })
    // La ficha técnica la ve y se la baja; la póliza ni le sale en su lista.
    expect(within(lista).getByText('Ficha técnica')).toBeInTheDocument()
    expect(within(lista).getByText('Lo ve')).toBeInTheDocument()
    expect(within(lista).getByText('Se lo baja')).toBeInTheDocument()
    expect(within(lista).getByText('No le sale en su lista')).toBeInTheDocument()
    // Y quién lee cada uno (lo de su tipo o su ajuste): la póliza, solo los suyos.
    expect(within(lista).getAllByText('Los suyos').length).toBeGreaterThan(0)

    // «Atender con este»: la petición se resuelve con ese documento, sin subir
    // nada, y el modal vuelve a la decisión con él puesto.
    await user.click(within(lista).getAllByRole('button', { name: 'Atender con este' })[0])
    expect(screen.getByRole('tab', { name: 'Decisión' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('radio', { name: 'Con uno que ya existe' })).toBeChecked()
    expect(screen.getByText('Se atenderá con: Ficha técnica')).toBeInTheDocument()
    mocks.fetchDocumentAs.mockResolvedValue(documento({ id: 100, can_view: true, can_download: true }))
    await user.click(screen.getByRole('button', { name: 'Resolver' }))
    await waitFor(() =>
      expect(mocks.resolveDocumentSupplyRequest).toHaveBeenCalledWith(7, 'done', '', 100),
    )
    expect(mocks.uploadDocument).not.toHaveBeenCalled()
    // Ya lo veía todo: no hay nada que concederle.
    expect(mocks.grantDocumentAccess).not.toHaveBeenCalled()
  })

  it('desde la lista se concede a quien pide lo que le va con solicitud', async () => {
    mocks.listDocuments.mockResolvedValue({
      count: 1,
      next: null,
      results: [documento({ id: 100, download_request: 'pending' })],
    })
    const user = pintar()
    await gestionar(user)
    await user.click(await screen.findByRole('tab', { name: 'Documentación 1' }))
    const lista = await screen.findByRole('region', { name: 'Documentación de 8888TRX' })
    expect(within(lista).getAllByText('Lectura con solicitud')).toHaveLength(2)
    expect(within(lista).getByText('Descarga pedida')).toBeInTheDocument()
    await user.click(within(lista).getByRole('button', { name: 'Conceder descarga' }))
    await waitFor(() =>
      expect(mocks.grantDocumentAccess).toHaveBeenCalledWith(100, { user: 9, kind: 'download' }),
    )
    expect(await within(lista).findByRole('status')).toHaveTextContent(
      'Descarga de Contrato concedida a Carlos Ruiz.',
    )
    // La lista se vuelve a pedir, otra vez vista como Carlos.
    await waitFor(() => expect(mocks.listDocuments).toHaveBeenCalledTimes(2))
    expect(mocks.listDocuments).toHaveBeenLastCalledWith({ vehicle: 3, access_for: 9 })
  })

  it('atenderla sin archivo no sube nada: se entregó por otra vía', async () => {
    const user = pintar()
    await gestionar(user)
    // «Sin archivo» es una decisión, no un olvido: se elige.
    await user.click(screen.getByRole('radio', { name: /Sin archivo/ }))
    await user.type(screen.getByLabelText(/Observaciones/), 'Se lo di en mano.')
    await user.click(screen.getByRole('button', { name: 'Resolver' }))

    await waitFor(() =>
      expect(mocks.resolveDocumentSupplyRequest).toHaveBeenCalledWith(
        7,
        'done',
        'Se lo di en mano.',
        null,
      ),
    )
    expect(mocks.uploadDocument).not.toHaveBeenCalled()
    expect(mocks.grantDocumentAccess).not.toHaveBeenCalled()
  })

  it('subiendo sin adjuntar nada no se resuelve: se dice que falta el archivo', async () => {
    const user = pintar()
    await gestionar(user)
    await user.click(screen.getByRole('button', { name: 'Resolver' }))
    expect(await screen.findByText(/Adjunta el documento/)).toBeInTheDocument()
    expect(mocks.resolveDocumentSupplyRequest).not.toHaveBeenCalled()
  })

  it('rechazarla no ofrece adjuntar nada', async () => {
    const user = pintar()
    await gestionar(user)
    await user.selectOptions(screen.getByLabelText(/Qué se hace con la petición/), 'reject')
    expect(screen.queryByLabelText(/Documento que se le facilita/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resolver' }))
    await waitFor(() =>
      expect(mocks.resolveDocumentSupplyRequest).toHaveBeenCalledWith(7, 'reject', '', null),
    )
  })

  it('si la subida va bien y la resolución no, lo dice y no pierde el documento', async () => {
    mocks.resolveDocumentSupplyRequest.mockRejectedValue(new Error('500'))
    const user = pintar()
    await gestionar(user)
    await user.upload(screen.getByLabelText(/Documento que se le facilita/), PDF())
    await user.type(screen.getByLabelText(/Caducidad/), '2030-01-31')
    await user.click(screen.getByRole('button', { name: 'Resolver' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/El documento se subió/)
    // El modal se queda abierto: la petición sigue pendiente a propósito.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
