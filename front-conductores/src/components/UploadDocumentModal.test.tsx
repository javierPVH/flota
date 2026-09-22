import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'
import { UploadDocumentModal } from './UploadDocumentModal.tsx'

const mocks = vi.hoisted(() => ({
  listIncidents: vi.fn(),
  uploadDocument: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listIncidents: mocks.listIncidents,
  uploadDocument: mocks.uploadDocument,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'sara', roles: ['supervisor'] } }),
}))

const VEHICLE = { id: 3, plate: '7890NPQ', brand: 'Tesla', model: 'Model 3' } as Vehicle

const ACCIDENTE = {
  id: 44,
  vehicle: 3,
  type: 'accident',
  type_display: 'Accidente',
  status: 'open',
  status_display: 'Abierta',
  date: '2026-09-10',
}

function abrir(driver: { id: number; name: string } | null = null) {
  render(
    <LanguageProvider>
      <UploadDocumentModal vehicle={VEHICLE} driver={driver} onClose={vi.fn()} onSaved={vi.fn()} />
    </LanguageProvider>,
  )
  return userEvent.setup()
}

const PDF = () => new File(['x'], 'poliza.pdf', { type: 'application/pdf' })

describe('UploadDocumentModal: tres pasos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.listIncidents.mockResolvedValue({ count: 1, results: [ACCIDENTE] })
    mocks.uploadDocument.mockResolvedValue({ id: 8, status: 'archived' })
  })

  it('tipo y documento · ligado a · notas, y solo el último sube', async () => {
    const user = abrir()
    await waitFor(() => expect(mocks.listIncidents).toHaveBeenCalled())

    // Sin archivo no se pasa del primer paso: es lo que se viene a subir.
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    await user.upload(screen.getByLabelText(/Foto o PDF/), PDF())
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    // «Otro» no exige incidencia, pero puede llevarla: aquí hay una abierta.
    expect(await screen.findByText(/A qué incidencia del coche acompaña/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    // Las notas van solas en el último paso, que es el que sube.
    await user.type(screen.getByLabelText('Notas (opcional)'), 'Póliza 2026')
    await user.click(screen.getByRole('button', { name: 'Subir' }))

    await waitFor(() =>
      expect(mocks.uploadDocument).toHaveBeenCalledWith(
        expect.objectContaining({ vehicle: 3, type: 'other', incident: null, notes: 'Póliza 2026' }),
        expect.objectContaining({ name: 'poliza.pdf' }),
      ),
    )
  })

  it('el parte de accidente no pasa del paso «Ligado a» sin su accidente', async () => {
    const user = abrir()
    await waitFor(() => expect(mocks.listIncidents).toHaveBeenCalled())

    await user.selectOptions(screen.getByLabelText('Tipo de documento'), 'accident_report')
    await user.upload(screen.getByLabelText(/Foto o PDF/), PDF())
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    // El vínculo es obligatorio (lo exige el back): hasta elegirlo, no avanza.
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Accidente abierto'), '44')
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    await user.click(screen.getByRole('button', { name: 'Subir' }))

    await waitFor(() =>
      expect(mocks.uploadDocument).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'accident_report', incident: 44 }),
        expect.anything(),
      ),
    )
  })

  it('sin conductor a quien colgárselo, no se pregunta de quién es', async () => {
    abrir()
    await waitFor(() => expect(mocks.listIncidents).toHaveBeenCalled())
    // Quien sube es supervisor (no conduce) y el coche no trae conductor.
    expect(screen.queryByLabelText('Documento de')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Tipo de documento')).toHaveDisplayValue('Otro')
  })

  it('«Del conductor» cambia el catálogo de tipos, salta «Ligado a» y sube a la persona', async () => {
    const user = abrir({ id: 5, name: 'Ana Conductora' })
    await waitFor(() => expect(mocks.listIncidents).toHaveBeenCalled())

    const titular = screen.getByLabelText('Documento de')
    expect(titular).toHaveDisplayValue('El vehículo · 7890NPQ')
    await user.selectOptions(titular, 'driver')

    // Los tipos son ahora los personales: el permiso de conducir está y el
    // parte de accidente no.
    const tipo = screen.getByLabelText('Tipo de documento')
    expect(screen.getByRole('option', { name: 'Permiso de conducir' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Parte de accidente' })).not.toBeInTheDocument()
    await user.selectOptions(tipo, 'driving_license')
    // El permiso caduca: pide la fecha aquí mismo.
    await user.type(screen.getByLabelText(/Caducidad/), '2030-05-01')
    await user.upload(screen.getByLabelText(/Foto o PDF/), PDF())
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    // Sin paso «Ligado a»: del archivo se pasa a las notas y se sube.
    expect(screen.queryByText(/A qué incidencia del coche acompaña/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Notas (opcional)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Subir' }))

    await waitFor(() =>
      expect(mocks.uploadDocument).toHaveBeenCalledWith(
        expect.objectContaining({ user: 5, type: 'driving_license', expiry_date: '2030-05-01', incident: null }),
        expect.anything(),
      ),
    )
    expect(mocks.uploadDocument.mock.calls[0][0]).not.toHaveProperty('vehicle')
  })
})
