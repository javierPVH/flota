// IndexedDB no existe en jsdom: fake-indexeddb ANTES de importar la cola.
import 'fake-indexeddb/auto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import { ProfileEditModal } from './ProfileEditModal.tsx'
import type { FlotaDocument, FlotaUser } from '../types.ts'

const mocks = vi.hoisted(() => ({
  requestProfileChange: vi.fn(),
  requestDocumentChange: vi.fn(),
  requestDocumentDeletion: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  requestProfileChange: mocks.requestProfileChange,
  requestDocumentChange: mocks.requestDocumentChange,
  requestDocumentDeletion: mocks.requestDocumentDeletion,
}))

// El modal de corregir un documento es el de campo (`SupervisorModal`), que
// mira quién actúa para su aviso de responsabilidad.
vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 7, username: 'carlos', roles: ['driver'] } }),
}))

const USER = {
  id: 7,
  username: 'carlos',
  email: 'carlos@flota.dev',
  first_name: 'Carlos',
  last_name: 'Ruiz',
  roles: ['driver'],
  fuel_card: false,
  dni: '11111111H',
  phone: '600 000 000',
  license_type: 'B',
  is_staff: false,
  is_superuser: false,
} as FlotaUser

const DOC = {
  id: 9,
  vehicle: null,
  type: 'driving_license',
  type_display: 'Permiso de conducir',
  expiry_date: '2030-01-01',
  status: 'valid',
  status_display: 'Vigente',
  notes: '',
  deletion_pending: false,
  created_at: '2026-02-02T00:00:00Z',
  file_url: 'https://flota.example/media/permiso.jpg',
  drive_url: '',
} as unknown as FlotaDocument

function pintar(documents: FlotaDocument[] = [DOC]) {
  render(
    <LanguageProvider>
      <ProfileEditModal
        user={USER}
        documents={{ userId: 7, documents, loadFailed: false, reload: vi.fn() }}
        onClose={vi.fn()}
        onSent={vi.fn()}
      />
    </LanguageProvider>,
  )
}

/** Avanza por el carrusel hasta el paso que se pida. */
async function avanzar(user: ReturnType<typeof userEvent.setup>, pasos: number) {
  for (let i = 0; i < pasos; i += 1) {
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
  }
}

describe('«Mis datos y mis documentos» (lo que se pide desde el perfil)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.requestProfileChange.mockResolvedValue({ id: 3, status: 'pending' })
    mocks.requestDocumentChange.mockResolvedValue({ id: 4, status: 'pending' })
  })

  it('se recorre por pasos, como subir un documento', async () => {
    pintar()
    const user = userEvent.setup()

    // El aviso de qué es esta ventana encabeza TODOS los pasos: no es una nota
    // al pie, es lo que la enmarca.
    expect(screen.getByText('Desde aquí se PIDE, no se guarda')).toBeInTheDocument()
    // Paso 1: la ficha. Enviar todavía no se ofrece.
    expect(screen.getByLabelText('Teléfono')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enviar petición' })).not.toBeInTheDocument()

    // Paso 2: los documentos, ANTES de enviar.
    await avanzar(user, 1)
    expect(screen.getByText('Modificar los documentos subidos')).toBeInTheDocument()
    expect(screen.queryByLabelText('Teléfono')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enviar petición' })).not.toBeInTheDocument()

    // Paso 3: lo que se va a pedir y la nota; ahí sí está el botón.
    await avanzar(user, 1)
    expect(screen.getByText('Lo que vas a pedir')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar petición' })).toBeInTheDocument()
    // Y se puede volver: el carrusel no es de una sola dirección.
    await user.click(screen.getByRole('button', { name: 'Atrás' }))
    expect(screen.getByText('Modificar los documentos subidos')).toBeInTheDocument()
    expect(screen.getByText('Desde aquí se PIDE, no se guarda')).toBeInTheDocument()
  })

  it('la ficha viaja entera, pero solo con lo que CAMBIA', async () => {
    pintar()
    const user = userEvent.setup()
    // La ficha completa, el correo y el DNI incluidos: son los dos de
    // identidad, así que el back comprueba que no sean de otra cuenta.
    await user.clear(screen.getByLabelText('Teléfono'))
    await user.type(screen.getByLabelText('Teléfono'), '600 111 222')
    await user.click(screen.getByLabelText('Tarjeta de combustible'))
    await avanzar(user, 2)

    // El último paso dice lo que se va a pedir, campo a campo: enviar no es un
    // salto a ciegas.
    const repaso = screen.getByRole('list')
    expect(within(repaso).getByText('Teléfono')).toBeInTheDocument()
    expect(within(repaso).getByText('600 000 000')).toBeInTheDocument()
    expect(within(repaso).getByText('600 111 222')).toBeInTheDocument()
    // La tarjeta de combustible se lee como un sí/no, no como un booleano.
    expect(within(repaso).getByText('Sí')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Nota para la gestión'), 'Me la dieron ayer.')
    await user.click(screen.getByRole('button', { name: 'Enviar petición' }))

    await waitFor(() =>
      expect(mocks.requestProfileChange).toHaveBeenCalledWith({
        changes: { fuel_card: true, phone: '600 111 222' },
        note: 'Me la dieron ayer.',
      }),
    )
    // No se cierra: el acuse ofrece volver a los documentos, que es la otra
    // mitad de lo que se viene a hacer aquí.
    expect(await screen.findByText('Petición enviada')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Volver a mis documentos' }))
    expect(screen.getByText('Modificar los documentos subidos')).toBeInTheDocument()
  })

  it('sin cambiar nada y sin nota no se manda una petición vacía', async () => {
    pintar()
    const user = userEvent.setup()
    await avanzar(user, 2)
    expect(screen.getByText(/No has cambiado ningún dato/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enviar petición' }))
    expect(await screen.findByText('Cambia algún dato o escribe una nota.')).toBeInTheDocument()
    expect(mocks.requestProfileChange).not.toHaveBeenCalled()
  })

  it('los documentos se corrigen desde el mismo sitio, y también se piden', async () => {
    pintar()
    const user = userEvent.setup()
    await avanzar(user, 1)
    await user.click(screen.getByRole('button', { name: 'Pedir que se corrija Permiso de conducir' }))
    const dialogo = screen.getByRole('dialog', { name: 'Corregir Permiso de conducir' })
    await user.clear(within(dialogo).getByLabelText('Fecha de caducidad'))
    await user.type(within(dialogo).getByLabelText('Fecha de caducidad'), '2031-05-31')
    await user.type(within(dialogo).getByLabelText('Por qué hay que corregirlo'), 'Lo renové.')
    await user.click(within(dialogo).getByRole('button', { name: 'Enviar petición' }))

    await waitFor(() =>
      expect(mocks.requestDocumentChange).toHaveBeenCalledWith(
        9,
        { type: 'driving_license', expiry_date: '2031-05-31', notes: '' },
        'Lo renové.',
      ),
    )
  })

  it('con una petición viva, el documento no admite otra', async () => {
    pintar([{ ...DOC, deletion_pending: true }])
    await avanzar(userEvent.setup(), 1)
    // Una por documento: pedir a la vez que se corrija y que se borre no es
    // una petición, es un cambio de idea.
    expect(screen.getByRole('button', { name: /Pedir que se corrija/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Pedir el borrado/ })).toBeDisabled()
  })
})
