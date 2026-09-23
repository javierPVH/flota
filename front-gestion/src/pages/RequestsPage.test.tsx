/**
 * La bandeja de solicitudes: se entra a DECIDIR.
 *
 * Lo que se vigila aquí es que la página abra por lo pendiente —como ya hacían
 * sus otras tres pestañas— y que «Todas» siga siendo alcanzable: el filtro vive
 * en la URL (el aviso de la cabecera enlaza `?status=pending`), así que el
 * defecto y el chip tienen que convivir sin pisarse.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RequestsPage } from './RequestsPage.tsx'
import { ConfirmProvider } from '../components/ConfirmDialog.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { VehicleRequestRow } from '../api.ts'

const mocks = vi.hoisted(() => ({
  listVehicleRequests: vi.fn(),
  listVehicles: vi.fn(),
  listDocumentDeletionRequests: vi.fn(),
  listDriverChangeRequests: vi.fn(),
  listProfileChangeRequests: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicleRequests: mocks.listVehicleRequests,
  listVehicles: mocks.listVehicles,
  listDocumentDeletionRequests: mocks.listDocumentDeletionRequests,
  listDriverChangeRequests: mocks.listDriverChangeRequests,
  listProfileChangeRequests: mocks.listProfileChangeRequests,
}))

function solicitud(over: Partial<VehicleRequestRow>): VehicleRequestRow {
  return {
    id: 1,
    requester: 5,
    requester_name: 'Carlos Ruiz',
    vehicle: null,
    requested_type: 'turismo',
    start_date: null,
    end_date: null,
    jira_key: '',
    incident: null,
    incident_plate: '',
    incident_type: '',
    incident_type_display: '',
    status: 'pending',
    status_display: 'Pendiente',
    notes: '',
    created_at: '2026-09-18T10:00:00Z',
    ...over,
  }
}

const PENDIENTE = solicitud({ id: 1, requester_name: 'Carlos Ruiz' })
const RECHAZADA = solicitud({
  id: 2,
  requester_name: 'Lucía Prats',
  status: 'rejected',
  status_display: 'Rechazada',
})
/** La que abre el parte de campo: se reconoce por su incidencia, y lo que
 * se pide es CUBRIR ese coche (por eso `vehicle` sigue vacío). */
const SUSTITUCION = solicitud({
  id: 3,
  requester_name: 'Sara Gil',
  incident: 77,
  incident_plate: '7890NPQ',
  incident_type: 'breakdown',
  incident_type_display: 'Avería',
})

function pintar(ruta = '/solicitudes') {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <LanguageProvider>
        <ConfirmProvider>
          <RequestsPage />
        </ConfirmProvider>
      </LanguageProvider>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

describe('Bandeja de solicitudes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listVehicleRequests.mockResolvedValue({
      count: 3,
      results: [PENDIENTE, RECHAZADA, SUSTITUCION],
    })
    mocks.listVehicles.mockResolvedValue({ count: 0, results: [] })
    mocks.listDocumentDeletionRequests.mockResolvedValue({ count: 0, results: [] })
    mocks.listDriverChangeRequests.mockResolvedValue({ count: 0, results: [] })
    mocks.listProfileChangeRequests.mockResolvedValue({ count: 0, results: [] })
  })

  it('abre por lo PENDIENTE: lo ya decidido no estorba al entrar', async () => {
    pintar()
    expect(await screen.findByText('Carlos Ruiz')).toBeInTheDocument()
    // La rechazada existe y se ha cargado (los chips la cuentan), pero no se
    // pinta: se viene a decidir, no a leer el histórico.
    expect(screen.queryByText('Lucía Prats')).not.toBeInTheDocument()
  })

  it('«Todas» las trae, aunque el defecto sean las pendientes', async () => {
    const user = pintar()
    await screen.findByText('Carlos Ruiz')

    // El chip tiene que dejar su marca en la URL: si se limitara a quitar el
    // parámetro, el defecto volvería a filtrar por pendientes y el clic no
    // haría nada visible.
    await user.click(screen.getByRole('button', { name: /^Todas/ }))
    expect(await screen.findByText('Lucía Prats')).toBeInTheDocument()
    expect(screen.getByText('Carlos Ruiz')).toBeInTheDocument()
  })

  it('el enlace del aviso de la cabecera sigue cayendo en las pendientes', async () => {
    pintar('/solicitudes?status=pending')
    expect(await screen.findByText('Carlos Ruiz')).toBeInTheDocument()
    expect(screen.queryByText('Lucía Prats')).not.toBeInTheDocument()
  })

  it('dice qué hace cada botón antes de pulsarlo', async () => {
    pintar()
    const ayuda = await screen.findByText('Cómo se decide')
    const caja = ayuda.closest('aside') as HTMLElement
    expect(within(caja).getByText('Conceder')).toBeInTheDocument()
    expect(within(caja).getByText(/asigna el vehículo/)).toBeInTheDocument()
    expect(within(caja).getByText('Rechazar')).toBeInTheDocument()
    expect(within(caja).getByText(/cierra la solicitud sin tocar nada/)).toBeInTheDocument()
  })

  // --- El coche de sustitución, aparte ------------------------------------
  // La pestaña mezcla dos flujos que se conceden igual pero no se leen igual:
  // cubrir un coche parado (lo pide el parte de campo) y dar coche a quien no
  // tiene. Estaban revueltos y no había forma de mirar solo uno.
  describe('filtro por origen', () => {
    it('«Coche de sustitución» deja solo las que nacen de un parte', async () => {
      const user = pintar()
      await screen.findByText('Sara Gil')
      expect(screen.getByText('Carlos Ruiz')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /^Coche de sustitución/ }))
      expect(await screen.findByText('Sara Gil')).toBeInTheDocument()
      expect(screen.queryByText('Carlos Ruiz')).not.toBeInTheDocument()
    })

    it('«Sin vehículo» deja justo las otras', async () => {
      const user = pintar()
      await screen.findByText('Carlos Ruiz')

      await user.click(screen.getByRole('button', { name: /^Sin vehículo/ }))
      expect(await screen.findByText('Carlos Ruiz')).toBeInTheDocument()
      expect(screen.queryByText('Sara Gil')).not.toBeInTheDocument()
    })

    it('la fila dice qué coche hay que cubrir y por qué', async () => {
      pintar()
      // Sin eso, una solicitud de sustitución no se distingue de las demás.
      expect(await screen.findByText(/7890NPQ/)).toBeInTheDocument()
      expect(screen.getByText(/Avería/)).toBeInTheDocument()
    })

    it('los dos ejes se cruzan: estado Y origen a la vez', async () => {
      const user = pintar()
      await screen.findByText('Carlos Ruiz')

      // Rechazadas + sustitución no deja ninguna: la de campo está pendiente.
      await user.click(screen.getByRole('button', { name: /^Rechazadas/ }))
      await user.click(screen.getByRole('button', { name: /^Coche de sustitución/ }))
      expect(screen.queryByText('Lucía Prats')).not.toBeInTheDocument()
      expect(screen.queryByText('Sara Gil')).not.toBeInTheDocument()
    })
  })

  it('sin nada pendiente lo dice, en vez de hablar de filtros', async () => {
    mocks.listVehicleRequests.mockResolvedValue({ count: 1, results: [RECHAZADA] })
    pintar()
    await waitFor(() =>
      expect(screen.getByText('Nada sin decidir por aquí.')).toBeInTheDocument(),
    )
  })
})
