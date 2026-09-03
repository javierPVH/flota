import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'
import { AccidentModal } from './AccidentModal.tsx'

const mocks = vi.hoisted(() => ({
  createIncident: vi.fn(),
  uploadDocument: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  createIncident: mocks.createIncident,
  uploadDocument: mocks.uploadDocument,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'sara', roles: ['supervisor'] } }),
}))

const VEHICLE = {
  id: 7,
  plate: '1234KLM',
  brand: 'Peugeot',
  model: 'Partner',
  state: 'active',
  state_display: 'Activo',
  updated_at: '2026-08-20T10:00:00Z',
} as Vehicle

describe('AccidentModal del supervisor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.createIncident.mockResolvedValue({ id: 91, vehicle: 7 })
  })

  it('usa el parte guiado que materializa los mismos modelos que Gestión', async () => {
    const onSaved = vi.fn()
    render(
      <LanguageProvider>
        <AccidentModal vehicle={VEHICLE} onClose={vi.fn()} onSaved={onSaved} />
      </LanguageProvider>,
    )
    const user = userEvent.setup()

    const fileInput = screen.getByLabelText('Archivo del parte (opcional)')
    expect(fileInput.closest('label')).toHaveClass('photo-attach')

    await user.type(screen.getByRole('textbox', { name: 'Calle' }), 'Gran Vía')
    await user.type(screen.getByRole('textbox', { name: 'Código postal' }), '28013')
    await user.type(screen.getByRole('textbox', { name: 'Localidad' }), 'Madrid')
    await user.type(screen.getByRole('textbox', { name: 'Provincia' }), 'Madrid')
    fireEvent.change(screen.getByLabelText('Fecha y hora'), { target: { value: '2026-08-25T10:30' } })
    await user.type(screen.getByRole('textbox', { name: 'Teléfono' }), '600123123')
    await user.type(screen.getByRole('textbox', { name: 'Descripción de los daños' }), 'Golpe frontal')

    await user.click(screen.getAllByRole('button', { name: /Añadir/ })[0])
    await user.type(screen.getAllByRole('textbox', { name: 'Nombre y apellidos' })[0], 'Ana Tercera')
    await user.type(screen.getAllByRole('textbox', { name: 'Matrícula' })[0], '9999ZZZ')

    await user.click(screen.getByRole('button', { name: 'Comunicar accidente' }))

    expect(mocks.createIncident).toHaveBeenCalledWith(expect.objectContaining({
      vehicle: 7,
      type: 'accident',
      date: '2026-08-25',
      description: 'Golpe frontal',
      details: expect.objectContaining({
        report_version: 1,
        damage_description: 'Golpe frontal',
        third_parties: [expect.objectContaining({ full_name: 'Ana Tercera', plate: '9999ZZZ' })],
        injured_people: [],
      }),
    }))
    expect(await screen.findByText('Accidente comunicado correctamente.')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalledOnce()
  })
})
