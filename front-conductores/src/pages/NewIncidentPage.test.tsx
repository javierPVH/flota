import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NewIncidentPage } from './NewIncidentPage.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  listVehicles: vi.fn(),
  fetchVehicleSummary: vi.fn(),
  createIncident: vi.fn(),
  uploadDocument: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  fetchVehicleSummary: mocks.fetchVehicleSummary,
  createIncident: mocks.createIncident,
  uploadDocument: mocks.uploadDocument,
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'carlos', roles: ['driver'] } }),
}))

const VEHICLE = {
  id: 4,
  plate: '1234KLM',
  brand: 'Mercedes',
  model: 'Sprinter',
  state: 'active',
  state_display: 'Activo',
  is_substitute: false,
  next_itv_date: null,
  supervisor_name: '',
}

function abrir() {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <NewIncidentPage />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

/** El `<select>` del DS no ata su etiqueta al control: se busca por su opción. */
function selectDe(opcion: string) {
  return screen.getByRole('option', { name: opcion }).closest('select') as HTMLSelectElement
}

describe('NewIncidentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listVehicles.mockResolvedValue({ results: [VEHICLE] })
    mocks.fetchVehicleSummary.mockResolvedValue({ km_current: 12000, km_estimated: false })
    mocks.createIncident.mockResolvedValue({ id: 77, vehicle: 4 })
    mocks.uploadDocument.mockResolvedValue({ id: 9 })
  })

  // Toda petición que abre un conductor o un supervisor admite prueba, también
  // la que no va del coche (documentación, tarjetas…) y no tiene daño.
  it('deja adjuntar un documento también en la petición general', async () => {
    abrir()
    await waitFor(() => expect(mocks.fetchVehicleSummary).toHaveBeenCalled())

    await userEvent.selectOptions(selectDe('Petición general'), 'general')
    const adjunto = screen.getByLabelText(/Fotos o documentos/)
    await userEvent.upload(adjunto, new File(['x'], 'presupuesto.pdf', { type: 'application/pdf' }))
    expect(screen.getByText('1 archivo seleccionado')).toBeInTheDocument()

    await userEvent.type(screen.getByRole('textbox'), 'Falta la tarjeta de combustible')
    await userEvent.click(screen.getByRole('button', { name: 'Crear incidencia' }))

    await waitFor(() => expect(mocks.uploadDocument).toHaveBeenCalled())
    // Sin daño que fotografiar, el adjunto se archiva como «Otro».
    expect(mocks.uploadDocument.mock.calls[0][0]).toMatchObject({
      vehicle: 4,
      incident: 77,
      type: 'other',
    })
  })

  // El tipo por defecto es la avería, la misma que el modal de la tarjeta.
  it('en una avería el adjunto son fotos de daños', async () => {
    abrir()
    await waitFor(() => expect(mocks.fetchVehicleSummary).toHaveBeenCalled())

    await userEvent.upload(
      screen.getByLabelText(/Fotos o documentos/),
      new File(['x'], 'golpe.jpg', { type: 'image/jpeg' }),
    )
    await userEvent.type(screen.getByRole('textbox'), 'Ruido en el motor')
    await userEvent.click(screen.getByRole('button', { name: 'Crear incidencia' }))

    await waitFor(() => expect(mocks.uploadDocument).toHaveBeenCalled())
    expect(mocks.uploadDocument.mock.calls[0][0]).toMatchObject({ type: 'damage_photos' })
  })
})
