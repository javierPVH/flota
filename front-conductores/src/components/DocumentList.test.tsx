import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import type { FlotaDocument } from '../types.ts'
import { DocumentList } from './DocumentList.tsx'

const mocks = vi.hoisted(() => ({
  requestDocumentDeletion: vi.fn(),
  requestDocumentAccess: vi.fn(),
  fetchDocumentFile: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  requestDocumentDeletion: mocks.requestDocumentDeletion,
  requestDocumentAccess: mocks.requestDocumentAccess,
  fetchDocumentFile: mocks.fetchDocumentFile,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'carlos', roles: ['driver'] } }),
}))

function doc(extra: Partial<FlotaDocument> = {}): FlotaDocument {
  return {
    id: 7,
    vehicle: 1,
    type: 'insurance',
    type_display: 'Seguro',
    incident: null,
    drive_url: 'https://drive.example/file/d/abc/view',
    drive_file_id: 'abc',
    file: null,
    file_url: '',
    uploaded_by: null,
    uploaded_by_name: '',
    expiry_date: null,
    status: 'valid',
    status_display: 'Vigente',
    replaces: null,
    notes: '',
    deletion_pending: false,
    created_at: '2026-09-18T08:00:00Z',
    updated_at: '2026-09-18T08:00:00Z',
    ...extra,
  } as FlotaDocument
}

function pintar(documents: FlotaDocument[], onChanged = vi.fn()) {
  render(
    <LanguageProvider>
      <DocumentList documents={documents} onChanged={onChanged} />
    </LanguageProvider>,
  )
  return { user: userEvent.setup(), onChanged }
}

describe('DocumentList: descargar y pedir el borrado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.requestDocumentDeletion.mockResolvedValue({ id: 3, status: 'pending' })
    mocks.fetchDocumentFile.mockResolvedValue({
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      filename: 'seguro-1234abc-7.jpg',
    })
  })

  it('ni ver ni descargar mandan al conductor a Drive', () => {
    pintar([doc()])
    // Los dos son botones, no enlaces: el archivo lo trae el back con la
    // cuenta de servicio — un conductor no tiene acceso a esa carpeta de
    // Drive, ni para abrirla ni para bajarse el fichero.
    expect(screen.getByRole('button', { name: 'Ver Seguro' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descargar Seguro' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Abrir|Descargar/ })).not.toBeInTheDocument()
  })

  it('lo que va con solicitud se PIDE: ver y descargar', async () => {
    mocks.requestDocumentAccess.mockResolvedValue({ id: 9, kind: 'view', status: 'pending' })
    const { user, onChanged } = pintar([
      doc({ can_view: false, can_download: false, view_request: '', download_request: 'pending' }),
    ])
    // Ni ver ni bajar directamente; corregir y la papelera, siempre.
    expect(screen.queryByRole('button', { name: 'Ver Seguro' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Descargar Seguro' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pedir que se corrija Seguro' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pedir el borrado de Seguro' })).toBeInTheDocument()
    // La fila dice cómo va cada cosa.
    expect(screen.getByText('Lectura: con solicitud · Descarga: pedida, pendiente de la gestión')).toBeInTheDocument()
    // La descarga ya está pedida: el botón va apagado pero vivo, y el toque
    // explica qué pasará cuando se conceda.
    const bajar = screen.getByRole('button', { name: 'Pedir la descarga de Seguro' })
    expect(bajar).toHaveClass('is-waiting')
    expect(bajar).toBeEnabled()
    await user.click(bajar)
    expect(await screen.findByText('Has pedido la descarga de Seguro: la gestión tiene que concederla.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Entendido' }))
    expect(mocks.requestDocumentAccess).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Pedir la lectura de Seguro' }))
    expect(screen.getByText(/previa solicitud/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enviar petición' }))
    await waitFor(() => expect(mocks.requestDocumentAccess).toHaveBeenCalledWith(7, 'view', ''))
    expect(onChanged).toHaveBeenCalled()
    // Pedida: el botón se apaga (vivo) hasta que la gestión la conceda, y la
    // fila lo dice.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pedir la lectura de Seguro' })).toHaveClass('is-waiting'),
    )
    expect(screen.getByText(/Lectura: pedida, pendiente de la gestión/)).toBeInTheDocument()
  })

  it('concedida, vuelve el botón de siempre y la fila lo dice', () => {
    pintar([doc({ can_view: true, can_download: true, view_request: 'granted', download_request: '' })])
    expect(screen.getByRole('button', { name: 'Ver Seguro' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Descargar Seguro' })).toBeEnabled()
    expect(screen.getByText('Lectura: concedida')).toBeInTheDocument()
  })

  it('lo que NO se permite se dice, apagado pero vivo: el toque explica por qué', async () => {
    const { user } = pintar([doc({ can_view: true, can_download: false, view_request: '', download_request: 'denied' })])
    expect(screen.getByRole('button', { name: 'Ver Seguro' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Descargar Seguro' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pedir la descarga de Seguro' })).not.toBeInTheDocument()
    expect(screen.getByText('Descarga: no permitida')).toBeInTheDocument()
    const bajar = screen.getByRole('button', { name: 'No se permite descargar Seguro' })
    expect(bajar).toHaveClass('is-waiting')
    await user.click(bajar)
    expect(await screen.findByText('No se permite la descarga de Seguro desde la app de campo.')).toBeInTheDocument()
    expect(screen.getByText(/no se puede pedir desde aquí/)).toBeInTheDocument()
    expect(mocks.requestDocumentAccess).not.toHaveBeenCalled()
  })

  it('la papelera puede estar cerrada del todo: apagada pero viva, y lo dice', async () => {
    const { user } = pintar([doc({ can_request_delete: false })])
    expect(screen.queryByRole('button', { name: 'Pedir el borrado de Seguro' })).not.toBeInTheDocument()
    expect(screen.getByText('Borrado: no permitido')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'No se permite pedir el borrado de Seguro' }))
    expect(await screen.findByText('No se permite el borrado de Seguro desde la app de campo.')).toBeInTheDocument()
  })

  it('descargar pide el archivo al back y lo guarda con su nombre', async () => {
    const creada = vi.fn(() => 'blob:doc-7')
    Object.assign(URL, { createObjectURL: creada, revokeObjectURL: vi.fn() })
    // El enlace de guardado se fabrica y se pulsa solo: jsdom no descarga nada,
    // así que se mira el que recibió el clic.
    const pulsados: HTMLAnchorElement[] = []
    const clic = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        pulsados.push(this)
      })

    const { user } = pintar([doc()])
    await user.click(screen.getByRole('button', { name: 'Descargar Seguro' }))

    await waitFor(() =>
      expect(mocks.fetchDocumentFile).toHaveBeenCalledWith(7, { download: true }),
    )
    await waitFor(() => expect(pulsados).toHaveLength(1))
    expect(pulsados[0]).toHaveAttribute('href', 'blob:doc-7')
    // El nombre lo pone el back, que es quien sabe de qué documento es.
    expect(pulsados[0]).toHaveAttribute('download', 'seguro-1234abc-7.jpg')
    clic.mockRestore()
  })

  it('si la descarga falla, se dice en la lista', async () => {
    mocks.fetchDocumentFile.mockRejectedValue({})
    const { user } = pintar([doc()])
    await user.click(screen.getByRole('button', { name: 'Descargar Seguro' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo descargar el documento/)
  })

  it('la papelera NO borra: pide y la fila queda pendiente de la gestión', async () => {
    const { user, onChanged } = pintar([doc()])

    await user.click(screen.getByRole('button', { name: 'Pedir el borrado de Seguro' }))
    expect(screen.getByText(/la petición va a la gestión/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Motivo (opcional)'), 'Está repetido')
    await user.click(screen.getByRole('button', { name: 'Pedir borrado' }))

    await waitFor(() =>
      expect(mocks.requestDocumentDeletion).toHaveBeenCalledWith(7, 'Está repetido'),
    )
    expect(onChanged).toHaveBeenCalled()
    // El documento sigue en la lista, marcado, y no se puede volver a pedir.
    const fila = screen.getByText('Seguro').closest('li') as HTMLElement
    expect(
      within(fila).getByText(/Pendiente de borrado por parte del administrador/),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pedir el borrado de Seguro' })).toBeDisabled(),
    )
  })

  it('ver trae el archivo, lo pinta y SUELTA la copia al cerrar', async () => {
    // jsdom no implementa los blob URL: se ponen a mano para poder mirarlos.
    const creada = vi.fn(() => 'blob:doc-7')
    const soltada = vi.fn()
    Object.assign(URL, { createObjectURL: creada, revokeObjectURL: soltada })
    const { user } = pintar([doc()])

    await user.click(screen.getByRole('button', { name: 'Ver Seguro' }))
    await waitFor(() => expect(mocks.fetchDocumentFile).toHaveBeenCalledWith(7, expect.anything()))
    // Una imagen se pinta como imagen, desde el blob (no desde Drive).
    const imagen = await screen.findByAltText('Seguro')
    expect(imagen).toHaveAttribute('src', 'blob:doc-7')
    expect(creada).toHaveBeenCalled()
    // Y se dice que no queda nada en el móvil al cerrar.
    expect(screen.getByText(/la copia desaparece del móvil/)).toBeInTheDocument()
    // Guardarlo desde aquí usa ESA copia: el mismo blob, sin pedirlo otra vez.
    const guardar = screen.getByRole('link', { name: 'Descargar' })
    expect(guardar).toHaveAttribute('href', 'blob:doc-7')
    expect(guardar).toHaveAttribute('download', 'seguro-1234abc-7.jpg')
    expect(mocks.fetchDocumentFile).toHaveBeenCalledTimes(1)

    // Dos botones dicen «Cerrar» (la X del modal y el del pie): el del pie.
    const cerrar = screen.getAllByRole('button', { name: 'Cerrar' })
    await user.click(cerrar[cerrar.length - 1])
    await waitFor(() => expect(soltada).toHaveBeenCalledWith('blob:doc-7'))
  })

  it('si el back no puede servirlo, lo dice dentro de la ventana', async () => {
    mocks.fetchDocumentFile.mockRejectedValue({})
    const { user } = pintar([doc()])
    await user.click(screen.getByRole('button', { name: 'Ver Seguro' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo abrir el documento/)
  })

  it('lo ya pedido nace marcado y con la papelera apagada', () => {
    pintar([doc({ deletion_pending: true })])
    expect(screen.getByText(/Pendiente de borrado por parte del administrador/)).toBeInTheDocument()
    expect(screen.queryByText('Vigente')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pedir el borrado de Seguro' })).toBeDisabled()
  })

  it('si el envío falla, lo dice y no marca nada', async () => {
    // Sin mensaje aprovechable (una caída de red cruda): sale el del front.
    mocks.requestDocumentDeletion.mockRejectedValue({})
    const { user } = pintar([doc()])
    await user.click(screen.getByRole('button', { name: 'Pedir el borrado de Seguro' }))
    await user.click(screen.getByRole('button', { name: 'Pedir borrado' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo pedir el borrado/)
    expect(screen.queryByText(/Pendiente de borrado por parte del administrador/)).not.toBeInTheDocument()
  })
  it('con la app en inglés, la fila NO repite lo que manda el back', () => {
    // El back escribe `type_display`/`status_display` siempre en castellano:
    // la fila los traduce por CÓDIGO (`domainLabels`), o en inglés salía
    // «Seguro · Vigente» y el botón, mezclado.
    localStorage.setItem('gs_base_lang', 'en')
    pintar([doc()])
    expect(screen.getByText('Insurance')).toBeInTheDocument()
    expect(screen.getByText('Valid')).toBeInTheDocument()
    expect(screen.queryByText('Seguro')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask for Insurance to be fixed' })).toBeInTheDocument()
  })
})
