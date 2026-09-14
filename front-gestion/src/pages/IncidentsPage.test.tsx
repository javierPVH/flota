import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IncidentsPage } from './IncidentsPage.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  listIncidents: vi.fn(),
  listVehicles: vi.fn(),
  listWorkshops: vi.fn(),
  resolveIncident: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listIncidents: mocks.listIncidents,
  listVehicles: mocks.listVehicles,
  listWorkshops: mocks.listWorkshops,
  resolveIncident: mocks.resolveIncident,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

const VEHICLE = {
  id: 21,
  plate: '1234KLM',
  brand: 'Seat',
  model: 'Leon',
  state: 'broken',
  state_display: 'No activo - Averiado',
}

const OPEN = {
  id: 4,
  vehicle: 21,
  type: 'breakdown',
  type_display: 'Avería',
  date: '2026-08-20',
  description: 'No arranca en frío',
  mileage: null,
  workshop_postal_code: '',
  details: {},
  status: 'open',
  status_display: 'Abierta',
  cost: null,
}
const CLOSED = {
  ...OPEN,
  id: 5,
  type: 'tires',
  type_display: 'Avería de neumáticos',
  description: 'Rueda cambiada',
  status: 'closed',
  status_display: 'Cerrada',
}

const ON_GOING = {
  ...OPEN,
  id: 6,
  type: 'maintenance',
  type_display: 'Mantenimiento puntual',
  description: 'En el taller',
  status: 'on_going',
  status_display: 'En curso',
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <IncidentsPage />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('IncidentsPage (bandeja de incidencias)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listIncidents.mockResolvedValue(page([OPEN, ON_GOING, CLOSED]))
    mocks.listVehicles.mockResolvedValue(page([VEHICLE]))
    mocks.listWorkshops.mockResolvedValue([])
    mocks.resolveIncident.mockReset()
  })

  it('dos pestañas: «Abiertas» agrupa lo pendiente y la tabla dice cómo está el coche', async () => {
    renderPage()
    await screen.findByTitle('No arranca en frío')

    // Ni «Todas» ni «En curso»: o está pendiente o está cerrada.
    expect(screen.getAllByRole('tab').map((b) => b.textContent)).toEqual(['Abiertas', 'Cerradas'])

    // De salida, lo pendiente: la abierta y la que está en curso; la cerrada no.
    expect(screen.getByTitle('En el taller')).toBeInTheDocument()
    expect(screen.queryByTitle('Rueda cambiada')).toBeNull()

    // La columna nueva: el coche de esas incidencias no rueda.
    expect(screen.getAllByText('No activo - Averiado')).toHaveLength(2)

    // La descripción se lee en la propia fila (y sigue abriendo el texto entero).
    expect(screen.getByText('En el taller')).toBeInTheDocument()
    // «Documentos» es un icono más de la fila, sin texto.
    expect(screen.getAllByRole('button', { name: 'Documentos' })).toHaveLength(2)
    // Y la otra bandeja, a un clic desde la cabecera.
    expect(screen.getByRole('button', { name: /Ver alertas/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Cerradas' }))
    expect(await screen.findByTitle('Rueda cambiada')).toBeInTheDocument()
    expect(screen.queryByTitle('No arranca en frío')).toBeNull()
  })

  it('«Resolver» solo en las no cerradas, y abre el modal del tipo', async () => {
    renderPage()
    // La descripción vive en un TextCell (botón «Ver descripción»): el texto
    // completo queda en el title de la celda, no como texto visible.
    expect(await screen.findByTitle('No arranca en frío')).toBeInTheDocument()
    const resolveButtons = screen.getAllByRole('button', { name: 'Resolver' })
    expect(resolveButtons).toHaveLength(2)
    await userEvent.click(resolveButtons[0])
    expect(
      await screen.findByRole('dialog', { name: 'Resolver avería · 1234KLM' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolver y cerrar' })).toBeInTheDocument()
  })

  it('el select de estado no ofrece «Cerrada» para una abierta (cerrar es Resolver)', async () => {
    renderPage()
    await screen.findByTitle('No arranca en frío')
    await userEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0])
    const statusSelect = await screen.findByDisplayValue('Abierta')
    expect(within(statusSelect).queryByRole('option', { name: 'Cerrada' })).toBeNull()
    expect(within(statusSelect).getByRole('option', { name: 'En curso' })).toBeInTheDocument()
  })

  it('el filtro de tipo incluye «Petición general»', async () => {
    renderPage()
    await screen.findByTitle('No arranca en frío')
    const typeFilter = screen.getByRole('combobox', { name: 'Tipo' })
    expect(within(typeFilter).getByRole('option', { name: 'Petición general' })).toBeInTheDocument()
  })
})
