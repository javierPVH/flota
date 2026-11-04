import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AccidentReportForm } from './AccidentReportForm.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Incident, Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  updateIncident: vi.fn(),
  createIncident: vi.fn(),
  uploadDocument: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  updateIncident: mocks.updateIncident,
  createIncident: mocks.createIncident,
  uploadDocument: mocks.uploadDocument,
}))

const VEHICLE = {
  id: 21,
  plate: '1234KLM',
  brand: 'Seat',
  model: 'Leon',
  state: 'accidente',
  updated_at: '2026-08-20T10:00:00Z',
} as unknown as Vehicle

/** Un accidente comunicado desde la PWA: el parte canónico vive en `details`. */
const INCIDENT = {
  id: 7,
  vehicle: 21,
  type: 'accident',
  type_display: 'Accidente',
  priority: 'critical',
  date: '2026-08-20',
  description: 'Alcance por detrás',
  mileage: 82000,
  workshop_postal_code: '28045',
  status: 'on_going',
  status_display: 'En curso',
  cost: '150.00',
  details: {
    report_version: 1,
    street: 'Calle Mayor',
    street_number: '12',
    postal_code: '28013',
    locality: 'Madrid',
    province: 'Madrid',
    occurred_at: '2026-08-20T14:35',
    phone: '600111222',
    damage_description: 'Alcance por detrás',
    police_report_reference: 'ATG-2026-77',
    third_parties: [
      { full_name: 'Lucía Ramos', plate: '9999ZZZ', insurer: 'Aseguradora Ejemplo' },
    ],
    injured_people: [{ full_name: 'Marta Gil', seat: 'passenger' }],
  },
  accident_report: null,
} as unknown as Incident

function renderEdit() {
  const onDone = vi.fn()
  render(
    <LanguageProvider>
      <AccidentReportForm vehicle={VEHICLE} incident={INCIDENT} onClose={vi.fn()} onDone={onDone} />
    </LanguageProvider>,
  )
  return { onDone, user: userEvent.setup() }
}

describe('AccidentReportForm: modificar un accidente', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.updateIncident.mockReset()
    mocks.createIncident.mockReset()
    mocks.updateIncident.mockResolvedValue({ ...INCIDENT })
  })

  it('arranca con el parte cargado, se recorre y guarda TODO con un PATCH', async () => {
    const { onDone, user } = renderEdit()

    // 1 · Dónde y cuándo, ya relleno; se corrige la calle.
    expect(screen.getByLabelText('Calle')).toHaveValue('Calle Mayor')
    expect(screen.getByLabelText('Fecha y hora')).toHaveValue('2026-08-20T14:35')
    await user.clear(screen.getByLabelText('Calle'))
    await user.type(screen.getByLabelText('Calle'), 'Gran Vía')
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))

    // 2 · Daños: la descripción, el CP, el kilometraje y la prioridad.
    expect(screen.getByLabelText(/Descripción de los daños/)).toHaveValue('Alcance por detrás')
    expect(screen.getByLabelText('Kilometraje (opcional)')).toHaveValue(82000)
    expect(screen.getByRole('combobox', { name: 'Prioridad' })).toHaveValue('critical')
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))

    // 3 · Implicados: los que había, con su recuento, y se puede añadir.
    expect(screen.getByRole('tab', { name: /Terceros implicados/ })).toHaveTextContent('1')
    expect(screen.getByText('Lucía Ramos')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))

    // 4 · Atestado, y editando también el estado y el coste; sin la casilla
    // del estado del coche, que no se toca desde aquí.
    expect(screen.getByLabelText(/Referencia del atestado/)).toHaveValue('ATG-2026-77')
    expect(screen.getByRole('combobox', { name: 'Estado de la petición' })).toHaveValue('on_going')
    expect(screen.queryByRole('checkbox', { name: /Accidentado/ })).toBeNull()
    await user.clear(screen.getByLabelText('Coste (€)'))
    await user.type(screen.getByLabelText('Coste (€)'), '320')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(mocks.updateIncident).toHaveBeenCalledTimes(1))
    const [id, body] = mocks.updateIncident.mock.calls[0]
    expect(id).toBe(7)
    expect(body).toMatchObject({
      type: 'accident',
      priority: 'critical',
      status: 'on_going',
      cost: '320',
      mileage: 82000,
      workshop_postal_code: '28045',
      details: {
        report_version: 1,
        street: 'Gran Vía',
        occurred_at: '2026-08-20T14:35',
        police_report_reference: 'ATG-2026-77',
        third_parties: [{ full_name: 'Lucía Ramos', plate: '9999ZZZ', insurer: 'Aseguradora Ejemplo' }],
        injured_people: [{ full_name: 'Marta Gil', seat: 'passenger' }],
      },
    })
    expect(mocks.createIncident).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('Accidente modificado.')
  })
})
