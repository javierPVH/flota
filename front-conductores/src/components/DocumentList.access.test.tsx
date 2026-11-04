import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import type { FlotaDocument } from '../types.ts'
import { DocumentList } from './DocumentList.tsx'

/**
 * Lo que la fila ofrece según el ACCESO que el back manda para ver y bajar
 * cada documento (`can_view` / `can_download` + `view_request` /
 * `download_request`): directo, con solicitud (el botón de la llave abre la
 * petición), pedido (reloj de arena: el toque explica) o no permitido (el
 * botón de siempre no está y el apagado dice por qué). El archivo no se pide
 * nunca por un camino que no sea el directo.
 */
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
    type: 'contract',
    type_display: 'Contrato',
    incident: null,
    drive_url: '',
    drive_file_id: '',
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

/** Los cuatro estados que puede traer cada acción, con nombre. */
const DIRECTO = { can_view: true, can_download: true, view_request: '', download_request: '' } as const
const CON_SOLICITUD = { can_view: false, can_download: false, view_request: '', download_request: '' } as const
const PEDIDO = {
  can_view: false,
  can_download: false,
  view_request: 'pending',
  download_request: 'pending',
} as const
const NO_PERMITIDO = {
  can_view: false,
  can_download: false,
  view_request: 'denied',
  download_request: 'denied',
} as const

function pintar(documents: FlotaDocument[], onChanged = vi.fn()) {
  render(
    <LanguageProvider>
      <DocumentList documents={documents} onChanged={onChanged} />
    </LanguageProvider>,
  )
  return { user: userEvent.setup(), onChanged }
}

function dialogo() {
  return screen.getByRole('dialog')
}

describe('DocumentList: ver y descargar según el acceso', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.lang = 'es'
    mocks.requestDocumentAccess.mockResolvedValue({ id: 9, status: 'pending' })
    mocks.fetchDocumentFile.mockResolvedValue({
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      filename: 'contrato-1234abc-7.jpg',
    })
  })

  describe('con solicitud: la llave abre la petición', () => {
    it('ver: el botón de siempre no está, la llave pide y el archivo no se toca', async () => {
      const { user, onChanged } = pintar([doc({ ...CON_SOLICITUD, can_download: true })])
      expect(screen.queryByRole('button', { name: 'Ver Contrato' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Descargar Contrato' })).toBeInTheDocument()
      expect(screen.getByText('Lectura: con solicitud')).toBeInTheDocument()

      const llave = screen.getByRole('button', { name: 'Pedir la lectura de Contrato' })
      expect(llave).not.toHaveClass('is-waiting')
      await user.click(llave)

      // El modal de la petición, con su título, su aviso y su motivo.
      const modal = dialogo()
      expect(within(modal).getByRole('heading', { name: 'Pedir la lectura de Contrato' })).toBeInTheDocument()
      expect(within(modal).getByText(/se ve o se descarga previa solicitud/)).toBeInTheDocument()
      await user.type(within(modal).getByLabelText('Para qué lo necesitas (opcional)'), 'Para una multa')
      await user.click(within(modal).getByRole('button', { name: 'Enviar petición' }))

      await waitFor(() => expect(mocks.requestDocumentAccess).toHaveBeenCalledWith(7, 'view', 'Para una multa'))
      expect(mocks.requestDocumentAccess).toHaveBeenCalledTimes(1)
      expect(onChanged).toHaveBeenCalled()
      // Pedida: acuse, el modal se cierra, la llave pasa a reloj de arena y la
      // fila lo dice. El archivo no se ha pedido por ningún camino.
      expect(await screen.findByRole('status')).toHaveTextContent(/Petición enviada/)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'Pedir la lectura de Contrato' })).toHaveClass('is-waiting')
      expect(screen.getByText('Lectura: pedida, pendiente de la gestión')).toBeInTheDocument()
      expect(mocks.fetchDocumentFile).not.toHaveBeenCalled()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('descargar: igual, con su propia petición y sin bajar nada', async () => {
      const { user } = pintar([doc({ ...CON_SOLICITUD, can_view: true })])
      expect(screen.getByRole('button', { name: 'Ver Contrato' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Descargar Contrato' })).not.toBeInTheDocument()
      expect(screen.getByText('Descarga: con solicitud')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Pedir la descarga de Contrato' }))
      const modal = dialogo()
      expect(within(modal).getByRole('heading', { name: 'Pedir la descarga de Contrato' })).toBeInTheDocument()
      await user.click(within(modal).getByRole('button', { name: 'Enviar petición' }))

      await waitFor(() => expect(mocks.requestDocumentAccess).toHaveBeenCalledWith(7, 'download', ''))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Pedir la descarga de Contrato' })).toHaveClass('is-waiting'),
      )
      expect(screen.getByText('Descarga: pedida, pendiente de la gestión')).toBeInTheDocument()
      expect(mocks.fetchDocumentFile).not.toHaveBeenCalled()
    })

    it('las dos con solicitud: cada llave pide LO SUYO', async () => {
      const { user } = pintar([doc(CON_SOLICITUD)])
      expect(screen.getByText('Lectura: con solicitud · Descarga: con solicitud')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Pedir la descarga de Contrato' }))
      expect(within(dialogo()).getByRole('heading', { name: 'Pedir la descarga de Contrato' })).toBeInTheDocument()
      await user.click(within(dialogo()).getByRole('button', { name: 'Enviar petición' }))
      await waitFor(() => expect(mocks.requestDocumentAccess).toHaveBeenLastCalledWith(7, 'download', ''))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      // La lectura sigue por pedir: su llave está viva y abre la suya.
      const verLlave = screen.getByRole('button', { name: 'Pedir la lectura de Contrato' })
      expect(verLlave).not.toHaveClass('is-waiting')
      await user.click(verLlave)
      expect(within(dialogo()).getByRole('heading', { name: 'Pedir la lectura de Contrato' })).toBeInTheDocument()
      await user.click(within(dialogo()).getByRole('button', { name: 'Enviar petición' }))
      await waitFor(() => expect(mocks.requestDocumentAccess).toHaveBeenLastCalledWith(7, 'view', ''))
      expect(mocks.requestDocumentAccess).toHaveBeenCalledTimes(2)
      await waitFor(() =>
        expect(screen.getByText('Lectura: pedida, pendiente de la gestión · Descarga: pedida, pendiente de la gestión')).toBeInTheDocument(),
      )
    })

    it('cancelar la petición no manda nada y deja la llave como estaba', async () => {
      const { user, onChanged } = pintar([doc(CON_SOLICITUD)])
      await user.click(screen.getByRole('button', { name: 'Pedir la lectura de Contrato' }))
      await user.click(within(dialogo()).getByRole('button', { name: 'Cancelar' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(mocks.requestDocumentAccess).not.toHaveBeenCalled()
      expect(onChanged).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Pedir la lectura de Contrato' })).not.toHaveClass('is-waiting')
      expect(screen.getByText(/Lectura: con solicitud/)).toBeInTheDocument()
    })

    it('si la petición falla, lo dice en el modal y no marca la fila como pedida', async () => {
      mocks.requestDocumentAccess.mockRejectedValue({})
      const { user, onChanged } = pintar([doc(CON_SOLICITUD)])
      await user.click(screen.getByRole('button', { name: 'Pedir la descarga de Contrato' }))
      await user.click(within(dialogo()).getByRole('button', { name: 'Enviar petición' }))
      expect(await within(dialogo()).findByRole('alert')).toHaveTextContent(/No se pudo enviar la petición/)
      expect(onChanged).not.toHaveBeenCalled()
      // Sigue abierto, para reintentar; y la fila no cambia.
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Lectura: con solicitud · Descarga: con solicitud')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Pedir la descarga de Contrato' })).not.toHaveClass('is-waiting')
    })

    it('la petición puede venir ya hecha del back: reloj de arena, y el toque explica', async () => {
      const { user } = pintar([doc(PEDIDO)])
      expect(screen.getByText('Lectura: pedida, pendiente de la gestión · Descarga: pedida, pendiente de la gestión')).toBeInTheDocument()
      const ver = screen.getByRole('button', { name: 'Pedir la lectura de Contrato' })
      expect(ver).toHaveClass('is-waiting')
      expect(ver).toBeEnabled()
      await user.click(ver)
      expect(within(dialogo()).getByRole('heading', { name: 'Acceso a Contrato' })).toBeInTheDocument()
      expect(within(dialogo()).getByText('Has pedido la lectura de Contrato: la gestión tiene que concederla.')).toBeInTheDocument()
      expect(within(dialogo()).getByText(/No hace falta pedirlo otra vez/)).toBeInTheDocument()
      await user.click(within(dialogo()).getByRole('button', { name: 'Entendido' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      // Ni se vuelve a pedir ni se abre nada.
      expect(mocks.requestDocumentAccess).not.toHaveBeenCalled()
      expect(mocks.fetchDocumentFile).not.toHaveBeenCalled()
    })
  })

  describe('no permitido: el botón de siempre no está y el apagado dice por qué', () => {
    it('ver no permitido: ni ver ni pedirlo; el toque abre el porqué y no trae el archivo', async () => {
      const { user } = pintar([doc({ ...NO_PERMITIDO, can_download: true, download_request: '' })])
      expect(screen.queryByRole('button', { name: 'Ver Contrato' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Pedir la lectura de Contrato' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Descargar Contrato' })).toBeInTheDocument()
      expect(screen.getByText('Lectura: no permitida')).toBeInTheDocument()

      const ver = screen.getByRole('button', { name: 'No se permite ver Contrato' })
      expect(ver).toHaveClass('is-waiting')
      expect(ver).toBeEnabled()
      await user.click(ver)
      const modal = dialogo()
      expect(within(modal).getByRole('heading', { name: 'Acceso a Contrato' })).toBeInTheDocument()
      expect(within(modal).getByText('No se permite la lectura de Contrato desde la app de campo.')).toBeInTheDocument()
      expect(within(modal).getByText(/no se puede pedir desde aquí/)).toBeInTheDocument()
      // Es un aviso: no hay motivo que escribir ni nada que enviar.
      expect(within(modal).queryByRole('textbox')).not.toBeInTheDocument()
      expect(within(modal).queryByRole('button', { name: 'Enviar petición' })).not.toBeInTheDocument()
      await user.click(within(modal).getByRole('button', { name: 'Entendido' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(mocks.requestDocumentAccess).not.toHaveBeenCalled()
      expect(mocks.fetchDocumentFile).not.toHaveBeenCalled()
    })

    it('las dos no permitidas: cada botón habla de lo suyo', async () => {
      const { user } = pintar([doc(NO_PERMITIDO)])
      expect(screen.getByText('Lectura: no permitida · Descarga: no permitida')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Pedir la (lectura|descarga)/ })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'No se permite ver Contrato' }))
      expect(within(dialogo()).getByText('No se permite la lectura de Contrato desde la app de campo.')).toBeInTheDocument()
      await user.click(within(dialogo()).getByRole('button', { name: 'Entendido' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: 'No se permite descargar Contrato' }))
      expect(within(dialogo()).getByText('No se permite la descarga de Contrato desde la app de campo.')).toBeInTheDocument()
      expect(mocks.requestDocumentAccess).not.toHaveBeenCalled()
      expect(mocks.fetchDocumentFile).not.toHaveBeenCalled()
    })

    it('«no permitido» manda sobre una concesión vieja: `denied` nunca es directo', () => {
      // El back ya lo hace (una concesión anterior deja de valer al cerrar el
      // mando); aquí la marca es la que decide, sin mirar `can_*`.
      pintar([doc({ can_view: false, can_download: false, view_request: 'denied', download_request: 'denied' })])
      expect(screen.getByRole('button', { name: 'No se permite ver Contrato' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'No se permite descargar Contrato' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Ver Contrato' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Descargar Contrato' })).not.toBeInTheDocument()
    })
  })

  describe('el visor respeta la descarga', () => {
    it('se puede ver pero no descargar: el visor no ofrece guardar la copia', async () => {
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:doc-7'), revokeObjectURL: vi.fn() })
      const { user } = pintar([doc({ ...DIRECTO, can_download: false, download_request: 'denied' })])
      await user.click(screen.getByRole('button', { name: 'Ver Contrato' }))
      expect(await screen.findByAltText('Contrato')).toHaveAttribute('src', 'blob:doc-7')
      // El blob ya está en el móvil, pero el enlace de guardarlo NO sale: por
      // aquí se saltaría el «no permitir» de la descarga.
      expect(within(dialogo()).queryByRole('link', { name: 'Descargar' })).not.toBeInTheDocument()
    })

    it('se puede ver y la descarga va con solicitud: tampoco se ofrece desde el visor', async () => {
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:doc-7'), revokeObjectURL: vi.fn() })
      const { user } = pintar([doc({ ...DIRECTO, can_download: false })])
      await user.click(screen.getByRole('button', { name: 'Ver Contrato' }))
      await screen.findByAltText('Contrato')
      expect(within(dialogo()).queryByRole('link', { name: 'Descargar' })).not.toBeInTheDocument()
    })

    it('con las dos directas, el visor sí deja guardar la copia', async () => {
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:doc-7'), revokeObjectURL: vi.fn() })
      const { user } = pintar([doc(DIRECTO)])
      await user.click(screen.getByRole('button', { name: 'Ver Contrato' }))
      await screen.findByAltText('Contrato')
      expect(within(dialogo()).getByRole('link', { name: 'Descargar' })).toHaveAttribute('href', 'blob:doc-7')
    })
  })

  describe('directo y concedido', () => {
    it('sin marcas de acceso (una copia cacheada vieja) se trata como directo', () => {
      pintar([doc()])
      expect(screen.getByRole('button', { name: 'Ver Contrato' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Descargar Contrato' })).toBeInTheDocument()
      expect(screen.queryByText(/Lectura:|Descarga:/)).not.toBeInTheDocument()
    })

    it('concedidas las dos: los botones de siempre, y la fila lo dice', async () => {
      // La descarga fabrica y pulsa un enlace; jsdom no navega, y aquí solo
      // importa que el archivo se pida por la puerta directa.
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:doc-7'), revokeObjectURL: vi.fn() })
      const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
      const { user } = pintar([doc({ can_view: true, can_download: true, view_request: 'granted', download_request: 'granted' })])
      expect(screen.getByText('Lectura: concedida · Descarga: concedida')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Descargar Contrato' }))
      await waitFor(() => expect(mocks.fetchDocumentFile).toHaveBeenCalledWith(7, { download: true }))
      expect(mocks.requestDocumentAccess).not.toHaveBeenCalled()
      clic.mockRestore()
    })
  })

  describe('en inglés', () => {
    beforeEach(() => {
      localStorage.setItem('gs_base_lang', 'en')
    })

    it('con solicitud: la llave abre la petición en inglés', async () => {
      const { user } = pintar([doc(CON_SOLICITUD)])
      expect(screen.getByText('View: on request · Download: on request')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Request to view Contract' }))
      expect(within(dialogo()).getByRole('heading', { name: 'Request to view Contract' })).toBeInTheDocument()
      await user.click(within(dialogo()).getByRole('button', { name: 'Send request' }))
      await waitFor(() => expect(mocks.requestDocumentAccess).toHaveBeenCalledWith(7, 'view', ''))
    })

    it('no permitido: el apagado explica en inglés', async () => {
      const { user } = pintar([doc(NO_PERMITIDO)])
      expect(screen.getByText('View: not allowed · Download: not allowed')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Downloading Contract is not allowed' }))
      expect(within(dialogo()).getByText('Permission to download Contract is not granted from the field app.')).toBeInTheDocument()
      expect(mocks.requestDocumentAccess).not.toHaveBeenCalled()
    })
  })
})
