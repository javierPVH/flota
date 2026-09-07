// IndexedDB no existe en jsdom: fake-indexeddb ANTES de importar la cola.
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import { PersonalDocumentsPanel, usePersonalDocuments } from './PersonalDocuments.tsx'

const mocks = vi.hoisted(() => ({
  listPersonalDocuments: vi.fn(),
  uploadDocument: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listPersonalDocuments: mocks.listPersonalDocuments,
  uploadDocument: mocks.uploadDocument,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 7, username: 'carlos', roles: ['driver'] } }),
}))

const LICENSE = {
  id: 41,
  vehicle: null,
  type: 'driving_license',
  type_display: 'Permiso de conducir',
  incident: null,
  drive_url: '',
  drive_file_id: '',
  file: 'documents/2026/09/permiso.jpg',
  file_url: 'https://flota.example/media/documents/2026/09/permiso.jpg',
  uploaded_by: 1,
  uploaded_by_name: 'admin',
  expiry_date: '2030-01-01',
  status: 'archived',
  status_display: 'Archivado',
  replaces: null,
  notes: '',
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
}

/** El panel recibe el estado del hook: quien lo enmarca ya lo tiene cargado. */
function Harness() {
  return <PersonalDocumentsPanel {...usePersonalDocuments()} />
}

function renderCard() {
  render(
    <LanguageProvider>
      <Harness />
    </LanguageProvider>,
  )
}

describe('PersonalDocumentsPanel (R3-43: documentos personales en campo)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.listPersonalDocuments.mockResolvedValue({ count: 1, results: [LICENSE] })
    mocks.uploadDocument.mockResolvedValue({ id: 42, status: 'pending_archive' })
  })

  it('lista MIS documentos (los que gestión ya subía y aquí no se veían)', async () => {
    renderCard()
    expect(await screen.findByText('Permiso de conducir')).toBeInTheDocument()
    // La consulta va por titular PERSONA, no por vehículo.
    expect(mocks.listPersonalDocuments).toHaveBeenCalledWith(7)
    // El binario se abre por /media (autorizado por `users_for` tras R3-01).
    expect(screen.getByRole('link', { name: /Abrir Permiso de conducir/ })).toHaveAttribute(
      'href',
      LICENSE.file_url,
    )
  })

  it('sube un documento personal con titular USUARIO y su client_ref', async () => {
    renderCard()
    await screen.findByText('Permiso de conducir')
    await userEvent.click(screen.getByRole('button', { name: 'Subir documento personal' }))
    const file = new File(['jpg'], 'permiso-nuevo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText(/Foto o PDF/), file)
    await userEvent.click(screen.getByRole('button', { name: 'Subir' }))

    await waitFor(() =>
      expect(mocks.uploadDocument).toHaveBeenCalledWith(
        {
          user: 7,
          type: 'driving_license',
          expiry_date: null,
          client_ref: expect.any(String),
        },
        file,
      ),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Documento subido.')
  })

  it('sin red, el documento personal entra en la cola offline (M7)', async () => {
    mocks.uploadDocument.mockRejectedValue(new TypeError('Failed to fetch'))
    renderCard()
    await screen.findByText('Permiso de conducir')
    await userEvent.click(screen.getByRole('button', { name: 'Subir documento personal' }))
    const file = new File(['jpg'], 'permiso-nuevo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText(/Foto o PDF/), file)
    await userEvent.click(screen.getByRole('button', { name: 'Subir' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/Sin conexión/)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
