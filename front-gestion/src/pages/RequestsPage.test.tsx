/**
 * La bandeja de solicitudes: se entra a DECIDIR.
 *
 * Lo que se vigila aquí es que la página abra por lo pendiente —como sus
 * otras cuatro pestañas— y que lo decidido siga siendo alcanzable marcando su
 * casilla en la barra; el `?status=pending` con el que enlaza el aviso de la
 * cabecera tiene que seguir cayendo en lo mismo.
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
  listDocumentSupplyRequests: vi.fn(),
  listDriverChangeRequests: vi.fn(),
  listProfileChangeRequests: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicleRequests: mocks.listVehicleRequests,
  listVehicles: mocks.listVehicles,
  listDocumentDeletionRequests: mocks.listDocumentDeletionRequests,
  listDocumentSupplyRequests: mocks.listDocumentSupplyRequests,
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
/** La que entra de Jira ya aprobada allí: aquí sigue esperando coche. */
const JIRA = solicitud({
  id: 4,
  requester_name: 'Pedro Mas',
  jira_key: 'FLOTA-12',
  status: 'approved',
  status_display: 'Aprobada',
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
    mocks.listDocumentSupplyRequests.mockResolvedValue({ count: 0, results: [] })
    mocks.listDriverChangeRequests.mockResolvedValue({ count: 0, results: [] })
    mocks.listProfileChangeRequests.mockResolvedValue({ count: 0, results: [] })
  })

  it('la quinta pestaña es la del papel que falta, y va en la URL', async () => {
    mocks.listDocumentSupplyRequests.mockResolvedValue({
      count: 1,
      results: [
        {
          id: 7,
          vehicle: 3,
          vehicle_plate: '8888TRX',
          user: null,
          user_name: '',
          type: 'contract',
          type_display: 'Contrato',
          note: 'Me lo piden en la obra.',
          requested_by: 9,
          requested_by_name: 'Carlos Ruiz',
          status: 'pending',
          status_display: 'Pendiente',
          document: null,
          document_name: '',
          resolved_by_name: '',
          resolved_at: null,
          resolution_note: '',
          created_at: '2026-10-20T10:00:00Z',
        },
      ],
    })
    pintar('/solicitudes?tab=pedidos')
    expect(await screen.findByText('Me lo piden en la obra.')).toBeInTheDocument()
    // Y la de vehículos no se pinta: son cinco bandejas, una por pestaña.
    expect(screen.queryByText('Sara Gil')).not.toBeInTheDocument()
  })

  it('abre por lo PENDIENTE: lo ya decidido no estorba al entrar', async () => {
    pintar()
    expect(await screen.findByText('Carlos Ruiz')).toBeInTheDocument()
    // La rechazada existe y se ha cargado (los chips la cuentan), pero no se
    // pinta: se viene a decidir, no a leer el histórico.
    expect(screen.queryByText('Lucía Prats')).not.toBeInTheDocument()
  })

  it('lo decidido se enseña marcando su casilla, sumado a lo pendiente', async () => {
    const user = pintar()
    await screen.findByText('Carlos Ruiz')

    // Las casillas dicen cuántas hay de cada grupo, y de salida solo
    // «Pendientes» está marcada.
    const rechazadas = screen.getByRole('checkbox', { name: 'Rechazadas (1)' })
    expect(rechazadas).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Pendientes (2)' })).toBeChecked()
    await user.click(rechazadas)
    expect(await screen.findByText('Lucía Prats')).toBeInTheDocument()
    expect(screen.getByText('Carlos Ruiz')).toBeInTheDocument()
    // Y desmarcando «Pendientes» quedan solo las rechazadas.
    await user.click(screen.getByRole('checkbox', { name: 'Pendientes (2)' }))
    expect(screen.queryByText('Carlos Ruiz')).not.toBeInTheDocument()
    expect(screen.getByText('Lucía Prats')).toBeInTheDocument()
  })

  it('la aprobada en Jira es una pendiente más: espera coche igual', async () => {
    mocks.listVehicleRequests.mockResolvedValue({
      count: 2,
      results: [PENDIENTE, JIRA],
    })
    pintar()
    expect(await screen.findByText('Pedro Mas')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Pendientes (2)' })).toBeChecked()
    // Ya no hay chip de «Aprobadas (Jira)»: no era una distinción útil.
    expect(screen.queryByText(/Aprobadas/)).not.toBeInTheDocument()
  })

  it('el buscador acota por lo que la tabla enseña', async () => {
    const user = pintar()
    await screen.findByText('Carlos Ruiz')
    await user.type(screen.getByRole('searchbox', { name: 'Buscar' }), 'sara')
    expect(await screen.findByText('Sara Gil')).toBeInTheDocument()
    expect(screen.queryByText('Carlos Ruiz')).not.toBeInTheDocument()
    // La casilla sigue diciendo cuántas HAY, no cuántas casan con lo tecleado.
    expect(screen.getByRole('checkbox', { name: 'Pendientes (2)' })).toBeChecked()
  })

  it('la cifra de la cabecera suma las cinco bandejas, también el papel que falta', async () => {
    mocks.listDocumentDeletionRequests.mockResolvedValue({ count: 1, results: [] })
    mocks.listDocumentSupplyRequests.mockResolvedValue({ count: 3, results: [] })
    pintar()
    await screen.findByText('Carlos Ruiz')
    // 2 de coche + 1 de documentos + 3 pedidos.
    const rotulo = await screen.findByText('Sin decidir')
    await waitFor(() => expect(rotulo.parentElement).toHaveTextContent('6'))
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

      // Solo rechazadas + sustitución no deja ninguna: la de campo está pendiente.
      await user.click(screen.getByRole('checkbox', { name: /^Rechazadas/ }))
      await user.click(screen.getByRole('checkbox', { name: /^Pendientes/ }))
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
