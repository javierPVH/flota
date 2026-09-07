import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VehiclesPage } from './VehiclesPage.tsx'
import { ConfirmProvider } from '../components/ConfirmDialog.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  listVehicles: vi.fn(),
  listVehicleLinks: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  listVehicleLinks: mocks.listVehicleLinks,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

function vehicle(id: number, plate: string, brand: string, model: string) {
  return {
    id,
    plate,
    brand,
    model,
    state: 'active',
    state_display: 'Activo',
    is_substitute: false,
    supervisor: null,
    supervisor_name: '',
    driver_name: '',
    driver_id: null,
    next_itv_date: null,
    insurance_expiry_date: null,
    business_use: 'works',
  }
}

// El snapshot que dejaría la lista al salir a una ficha (lo que guarda al
// desmontar). La clave debe coincidir con VIEW_KEY del componente.
const VIEW_KEY = 'gestion.vehiclesView'
function seedView(search: string) {
  sessionStorage.setItem(
    VIEW_KEY,
    JSON.stringify({
      tab: 'fleet',
      search,
      stateFilter: '',
      supervisorFilter: '',
      dueItv: false,
      dueInsurance: false,
      showBajas: false,
      appliedFrom: '',
      appliedTo: '',
      scrollTop: 0,
    }),
  )
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/vehiculos']}>
      <LanguageProvider>
        <ConfirmProvider>
          <VehiclesPage />
        </ConfirmProvider>
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('VehiclesPage — volver a donde estábamos', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    sessionStorage.clear()
    mocks.listVehicles.mockResolvedValue(
      page([vehicle(1, '1111AAA', 'Seat', 'Ibiza'), vehicle(2, '2222BBB', 'Ford', 'Focus')]),
    )
    mocks.listVehicleLinks.mockResolvedValue(page([]))
  })
  afterEach(() => sessionStorage.clear())

  it('al VOLVER (POP) restaura el filtro guardado de la lista', async () => {
    // Simula que salimos a una ficha con la lista filtrada por «2222».
    seedView('2222')
    const { container } = renderList()

    // La lista aparece filtrada como estaba (solo el 2222BBB)…
    await waitFor(() => expect(screen.getByText('2222BBB')).toBeInTheDocument())
    expect(screen.queryByText('1111AAA')).not.toBeInTheDocument()
    // …y el buscador de la barra recupera su texto (id propio: hay otro buscador
    // igual en el modal de exportación).
    const search = container.querySelector<HTMLInputElement>('#veh-search')
    expect(search?.value).toBe('2222')
  })

  it('sin snapshot (entrada nueva) la lista arranca limpia y completa', async () => {
    const { container } = renderList()

    await waitFor(() => expect(screen.getByText('1111AAA')).toBeInTheDocument())
    expect(screen.getByText('2222BBB')).toBeInTheDocument()
    const search = container.querySelector<HTMLInputElement>('#veh-search')
    expect(search?.value).toBe('')
  })
})
