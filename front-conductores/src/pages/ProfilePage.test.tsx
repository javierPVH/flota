// IndexedDB no existe en jsdom: fake-indexeddb ANTES de importar la cola.
import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import { ProfilePage } from './ProfilePage.tsx'

const mocks = vi.hoisted(() => ({ listPersonalDocuments: vi.fn() }))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listPersonalDocuments: mocks.listPersonalDocuments,
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

    expect(screen.getByText('Mi perfil')).toBeInTheDocument()
    expect(screen.getByText('Carlos Ruiz')).toBeInTheDocument()
    expect(screen.getByText('@carlos')).toBeInTheDocument()
    expect(screen.getByText('Conductor')).toBeInTheDocument()
    expect(screen.getByText('carlos@example.com')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    // Tarjeta de combustible: un sí/no, no un booleano crudo.
    expect(screen.getByText('Sí')).toBeInTheDocument()
    // Sin teléfono: se dice, no se deja el hueco en blanco.
    expect(screen.getByText('Sin datos')).toBeInTheDocument()

    // Los documentos personales, los mismos que la pestaña del conductor.
    expect(await screen.findByText('Permiso de conducir')).toBeInTheDocument()
    expect(mocks.listPersonalDocuments).toHaveBeenCalledWith(7)
    expect(screen.getByRole('button', { name: 'Subir documento personal' })).toBeInTheDocument()
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
})
