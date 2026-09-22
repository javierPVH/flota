// IndexedDB no existe en jsdom: fake-indexeddb ANTES de importar la cola.
import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import { ProfilePage } from './ProfilePage.tsx'

const mocks = vi.hoisted(() => ({
  listPersonalDocuments: vi.fn(),
  listMyProfileChangeRequests: vi.fn(),
  listMyDocumentRequests: vi.fn(),
  listMyRequests: vi.fn(),
  listDriverChangeRequests: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listPersonalDocuments: mocks.listPersonalDocuments,
  listMyProfileChangeRequests: mocks.listMyProfileChangeRequests,
  listMyDocumentRequests: mocks.listMyDocumentRequests,
  listMyRequests: mocks.listMyRequests,
  listDriverChangeRequests: mocks.listDriverChangeRequests,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({
    user: {
      id: 7,
      username: 'carlos',
      email: 'carlos@example.com',
      first_name: 'Carlos',
      last_name: 'Ruiz',
      roles: ['driver'],
      fuel_card: true,
      dni: '12345678Z',
      phone: '',
      license_type: 'B',
      is_staff: false,
      is_superuser: false,
    },
  }),
}))

describe('ProfilePage (la pantalla del avatar)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.listMyProfileChangeRequests.mockResolvedValue({ count: 0, results: [] })
    mocks.listMyDocumentRequests.mockResolvedValue({ count: 0, results: [] })
    mocks.listMyRequests.mockResolvedValue([])
    mocks.listDriverChangeRequests.mockResolvedValue({ count: 0, results: [] })
    mocks.listPersonalDocuments.mockResolvedValue({
      count: 1,
      results: [
        {
          id: 9,
          vehicle: null,
          type_display: 'Permiso de conducir',
          status: 'archived',
          status_display: 'Archivado',
          created_at: '2026-02-02T00:00:00Z',
          expiry_date: '2030-01-01',
          drive_url: '',
          file_url: 'https://flota.example/media/permiso.jpg',
        },
      ],
    })
  })

  it('enseña mis datos y MI documentación personal', async () => {
    render(
      <LanguageProvider>
        <ProfilePage />
      </LanguageProvider>,
    )

    // Sin encabezado: el tab de arriba ya dice dónde estás, y repetirlo se
    // comía una pantalla de alto en el móvil.
    expect(screen.queryByText('Mi perfil')).not.toBeInTheDocument()
    expect(screen.getByText('Carlos Ruiz')).toBeInTheDocument()
    expect(screen.getByText('@carlos')).toBeInTheDocument()
    expect(screen.getByText('Conductor')).toBeInTheDocument()
    expect(screen.getByText('carlos@example.com')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    // Tarjeta de combustible: un sí/no, no un booleano crudo.
    expect(screen.getByText('Sí')).toBeInTheDocument()
    // Sin teléfono: se dice, no se deja el hueco en blanco.
    expect(screen.getByText('Sin datos')).toBeInTheDocument()

    // Los documentos personales, los mismos que la pestaña del conductor. La
    // tarjeta arranca PLEGADA: lo que se lee sin abrirla es su recuento.
    const documentos = await screen.findByRole('button', { name: /Mis documentos/ })
    expect(within(documentos).getByText('1')).toBeInTheDocument()
    expect(mocks.listPersonalDocuments).toHaveBeenCalledWith(7)
    await userEvent.click(documentos)
    expect(screen.getByText('Permiso de conducir')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Subir documento personal' })).toBeInTheDocument()

    // El perfil es quién eres, no cómo va tu flota: las cifras de «A tu
    // cargo» encabezan ahora «Flota», que es donde se mira. Aquí no salen ni
    // aunque supervises — y de paso el perfil no pide cuatro listas.
    expect(screen.queryByText('A tu cargo')).not.toBeInTheDocument()
  })

  it('no pinta el DNI entero: solo los últimos cuatro', async () => {
    render(
      <LanguageProvider>
        <ProfilePage />
      </LanguageProvider>,
    )
    await screen.findByText('Permiso de conducir')
    // Dato mínimo: la pantalla se mira de pie en una obra (RGPD).
    expect(screen.queryByText('12345678Z')).not.toBeInTheDocument()
    expect(screen.getByText('••••678Z')).toBeInTheDocument()
  })

  it('debajo de los documentos, lo que uno tiene pedido: pendiente y resuelto', async () => {
    // Las CUATRO bandejas en las que una persona de campo puede tener algo, en
    // dos tarjetas: desde aquí no se leen «bandejas», se lee «lo mío».
    mocks.listMyProfileChangeRequests.mockResolvedValue({
      count: 1,
      results: [
        {
          id: 3,
          changes: { phone: '600 111 222' },
          changes_display: [
            { field: 'phone', label: 'Teléfono', current: '', proposed: '600 111 222' },
          ],
          note: '',
          status: 'pending',
          status_display: 'Pendiente',
          resolution_note: '',
          created_at: '2026-09-18T10:00:00Z',
        },
      ],
    })
    mocks.listMyDocumentRequests.mockResolvedValue({
      count: 1,
      results: [
        {
          id: 4,
          document: 9,
          kind: 'change',
          kind_display: 'Corrección',
          changes: {},
          changes_display: [
            {
              field: 'expiry_date',
              label: 'Fecha de caducidad',
              current: '2030-01-01',
              proposed: '2031-05-31',
            },
          ],
          status: 'applied',
          status_display: 'Corrección aplicada',
          reason: '',
          created_at: '2026-09-10T10:00:00Z',
        },
      ],
    })
    // Una rechazada tiene que verse igual: si no, quien la abrió nunca sabría
    // que se decidió que no.
    mocks.listDriverChangeRequests.mockResolvedValue({
      count: 1,
      results: [
        {
          id: 5,
          vehicle: 2,
          vehicle_plate: '7890NPQ',
          requested_by: 7,
          proposed_display: 'Lucía M',
          note: '',
          status: 'rejected',
          status_display: 'Rechazada',
          created_at: '2026-09-05T10:00:00Z',
        },
      ],
    })
    render(
      <LanguageProvider>
        <ProfilePage />
      </LanguageProvider>,
    )

    const user = userEvent.setup()
    // Plegada de salida, pero su título ya dice cuántas esperan decisión: eso
    // es lo que se mira sin abrir nada.
    const cabecera = await screen.findByRole('button', { name: /Peticiones/ })
    expect(within(cabecera).getByText('1')).toBeInTheDocument()
    await user.click(cabecera)

    const tarjeta = cabecera.closest('section')!
    // Pestaña de salida: lo pendiente.
    expect(within(tarjeta).getByText('Mi ficha')).toBeInTheDocument()
    expect(within(tarjeta).getByText('Pendiente')).toBeInTheDocument()
    expect(within(tarjeta).queryByText('Rechazada')).not.toBeInTheDocument()

    await user.click(within(tarjeta).getByRole('tab', { name: /Resueltas/ }))
    expect(within(tarjeta).getByText('Documento · Corrección')).toBeInTheDocument()
    expect(within(tarjeta).getByText('Cambio de conductor · 7890NPQ')).toBeInTheDocument()
    expect(within(tarjeta).getByText('Rechazada')).toBeInTheDocument()
    expect(within(tarjeta).queryByText('Mi ficha')).not.toBeInTheDocument()
  })

  it('las propuestas de conductor de OTROS no son mías aunque las alcance', async () => {
    // Quien supervisa alcanza las de sus coches; esta pantalla es «lo mío».
    mocks.listDriverChangeRequests.mockResolvedValue({
      count: 1,
      results: [
        {
          id: 6,
          vehicle: 2,
          vehicle_plate: '7890NPQ',
          requested_by: 99,
          proposed_display: 'Otro',
          note: '',
          status: 'pending',
          status_display: 'Pendiente',
          created_at: '2026-09-05T10:00:00Z',
        },
      ],
    })
    render(
      <LanguageProvider>
        <ProfilePage />
      </LanguageProvider>,
    )
    expect(await screen.findByText('No tienes nada pendiente de decisión.')).toBeInTheDocument()
  })
})
