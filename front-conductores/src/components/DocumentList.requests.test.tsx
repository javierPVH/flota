import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import type { FlotaDocument } from '../types.ts'
import { DocumentList } from './DocumentList.tsx'

const mocks = vi.hoisted(() => ({
  requestDocumentChange: vi.fn(),
  requestDocumentPlea: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  requestDocumentChange: mocks.requestDocumentChange,
  requestDocumentPlea: mocks.requestDocumentPlea,
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

/** El lápiz de la fila: las PETICIONES sobre el documento, en tres pestañas
 * —corregir, pedir como excepción lo que el mando tiene cerrado (la descarga,
 * el borrado) y cualquier otra petición—. */
describe('DocumentList: las peticiones del lápiz', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requestDocumentChange.mockResolvedValue({ id: 1, kind: 'change', status: 'pending' })
    mocks.requestDocumentPlea.mockResolvedValue({ id: 2, kind: 'other', status: 'pending' })
  })

  it('el lápiz va el último de la fila y abre las peticiones en pestañas', async () => {
    const { user } = pintar([doc()])
    const botones = within(screen.getByRole('listitem')).getAllByRole('button')
    expect(botones[botones.length - 1]).toHaveAccessibleName('Peticiones sobre Seguro')
    await user.click(botones[botones.length - 1])
    const dialogo = screen.getByRole('dialog', { name: 'Peticiones · Seguro' })
    // Sin nada cerrado en el documento no hay excepción que pedir: dos
    // pestañas, y se entra por «Corregir».
    expect(within(dialogo).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Corregir',
      'Otra petición',
    ])
    expect(within(dialogo).getByRole('tab', { name: 'Corregir' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(within(dialogo).getByLabelText('Por qué hay que corregirlo')).toBeInTheDocument()
  })

  it('«Corregir» sigue mandando la corrección con lo que cambia', async () => {
    const { user, onChanged } = pintar([doc({ expiry_date: '2027-01-01' })])
    await user.click(screen.getByRole('button', { name: 'Peticiones sobre Seguro' }))
    const dialogo = screen.getByRole('dialog')
    await user.clear(within(dialogo).getByLabelText('Fecha de caducidad'))
    await user.type(within(dialogo).getByLabelText('Fecha de caducidad'), '2028-01-01')
    await user.type(within(dialogo).getByLabelText('Por qué hay que corregirlo'), 'Renovada.')
    await user.click(within(dialogo).getByRole('button', { name: 'Enviar petición' }))
    await waitFor(() =>
      expect(mocks.requestDocumentChange).toHaveBeenCalledWith(
        7,
        { type: 'insurance', expiry_date: '2028-01-01', notes: '' },
        'Renovada.',
      ),
    )
    expect(onChanged).toHaveBeenCalled()
    expect(
      await screen.findByText('Petición enviada. La gestión decidirá si se corrige.'),
    ).toBeInTheDocument()
    expect(mocks.requestDocumentPlea).not.toHaveBeenCalled()
  })

  it('con la descarga cerrada, «Pedir permiso» la pide como excepción (con nota)', async () => {
    const { user, onChanged } = pintar([doc({ can_download: false, download_request: 'denied' })])
    await user.click(screen.getByRole('button', { name: 'Peticiones sobre Seguro' }))
    const dialogo = screen.getByRole('dialog')
    await user.click(within(dialogo).getByRole('tab', { name: 'Pedir permiso' }))
    // Solo lo que está cerrado: la descarga sí, el borrado no.
    expect(within(dialogo).getByRole('radio', { name: 'Poder descargarlo' })).toBeChecked()
    expect(within(dialogo).queryByRole('radio', { name: 'Que se borre' })).not.toBeInTheDocument()
    // La nota es obligatoria: es lo único que lee quien decide.
    await user.click(within(dialogo).getByRole('button', { name: 'Pedir la excepción' }))
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Escribe qué pides')
    expect(mocks.requestDocumentPlea).not.toHaveBeenCalled()
    await user.type(within(dialogo).getByLabelText('Por qué lo necesitas'), 'Me la pide el taller.')
    await user.click(within(dialogo).getByRole('button', { name: 'Pedir la excepción' }))
    await waitFor(() =>
      expect(mocks.requestDocumentPlea).toHaveBeenCalledWith(
        7,
        'allow_download',
        'Me la pide el taller.',
      ),
    )
    expect(onChanged).toHaveBeenCalled()
    expect(await screen.findByText(/La gestión decidirá si hace la excepción/)).toBeInTheDocument()
  })

  it('con el borrado cerrado se pide el borrado excepcional, y pedido no se repite', async () => {
    const { user } = pintar([doc({ can_request_delete: false })])
    await user.click(screen.getByRole('button', { name: 'Peticiones sobre Seguro' }))
    let dialogo = screen.getByRole('dialog')
    await user.click(within(dialogo).getByRole('tab', { name: 'Pedir permiso' }))
    expect(within(dialogo).getByRole('radio', { name: 'Que se borre' })).toBeChecked()
    expect(within(dialogo).queryByRole('radio', { name: 'Poder descargarlo' })).not.toBeInTheDocument()
    await user.type(within(dialogo).getByLabelText('Por qué lo necesitas'), 'Es de otro coche.')
    await user.click(within(dialogo).getByRole('button', { name: 'Pedir la excepción' }))
    await waitFor(() =>
      expect(mocks.requestDocumentPlea).toHaveBeenCalledWith(7, 'allow_delete', 'Es de otro coche.'),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Abierto otra vez, lo dice y no deja pedirlo de nuevo.
    await user.click(screen.getByRole('button', { name: 'Peticiones sobre Seguro' }))
    dialogo = screen.getByRole('dialog')
    await user.click(within(dialogo).getByRole('tab', { name: 'Pedir permiso' }))
    expect(
      within(dialogo).getByText('Ya lo has pedido: la gestión lo está revisando.'),
    ).toBeInTheDocument()
    expect(within(dialogo).getByRole('button', { name: 'Pedir la excepción' })).toBeDisabled()
  })

  it('«Otra petición» manda la libre, y con una corrección viva sigue abierta', async () => {
    const { user } = pintar([doc({ deletion_pending: true })])
    // El lápiz sigue vivo con una petición viva: las otras pestañas no
    // hablan del documento.
    await user.click(screen.getByRole('button', { name: 'Peticiones sobre Seguro' }))
    const dialogo = screen.getByRole('dialog')
    // «Corregir» lo dice en vez de pintar el formulario, y no se manda.
    expect(within(dialogo).getByText(/Ya hay una petición sobre este documento/)).toBeInTheDocument()
    expect(within(dialogo).queryByLabelText('Por qué hay que corregirlo')).not.toBeInTheDocument()
    expect(within(dialogo).getByRole('button', { name: 'Enviar petición' })).toBeDisabled()
    await user.click(within(dialogo).getByRole('tab', { name: 'Otra petición' }))
    expect(within(dialogo).getByRole('button', { name: 'Enviar petición' })).toBeEnabled()
    await user.type(within(dialogo).getByLabelText('Qué pides'), '¿De qué compañía es la póliza?')
    await user.click(within(dialogo).getByRole('button', { name: 'Enviar petición' }))
    await waitFor(() =>
      expect(mocks.requestDocumentPlea).toHaveBeenCalledWith(
        7,
        'other',
        '¿De qué compañía es la póliza?',
      ),
    )
    expect(await screen.findByText('Petición enviada. La gestión la atenderá.')).toBeInTheDocument()
  })

  it('si el envío falla, lo dice dentro de la ventana y no marca nada', async () => {
    mocks.requestDocumentPlea.mockRejectedValue(new Error('Sin cobertura'))
    const { user, onChanged } = pintar([doc()])
    await user.click(screen.getByRole('button', { name: 'Peticiones sobre Seguro' }))
    const dialogo = screen.getByRole('dialog')
    await user.click(within(dialogo).getByRole('tab', { name: 'Otra petición' }))
    await user.type(within(dialogo).getByLabelText('Qué pides'), 'Algo.')
    await user.click(within(dialogo).getByRole('button', { name: 'Enviar petición' }))
    expect(await within(dialogo).findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('con la app en inglés, las pestañas y el lápiz hablan inglés', async () => {
    localStorage.setItem('gs_base_lang', 'en')
    try {
      const { user } = pintar([doc({ can_download: false, download_request: 'denied' })])
      await user.click(screen.getByRole('button', { name: 'Requests about Insurance' }))
      const dialogo = screen.getByRole('dialog', { name: 'Requests · Insurance' })
      expect(within(dialogo).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'Fix',
        'Ask for an exception',
        'Other request',
      ])
    } finally {
      localStorage.removeItem('gs_base_lang')
    }
  })
})
