import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AccidentModal } from './AccidentModal.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  createIncident: vi.fn(),
  updateVehicleFields: vi.fn(),
  uploadDocument: vi.fn(),
  listAlerts: vi.fn(),
  listIncidents: vi.fn(),
  listOpenIncidents: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  createIncident: mocks.createIncident,
  updateVehicleFields: mocks.updateVehicleFields,
  uploadDocument: mocks.uploadDocument,
  listAlerts: mocks.listAlerts,
  listIncidents: mocks.listIncidents,
  listOpenIncidents: mocks.listOpenIncidents,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

const VEHICLE = {
  id: 21,
  plate: '1234KLM',
  brand: 'Mercedes',
  model: 'Sprinter',
  state: 'active',
  state_display: 'Activo',
  is_substitute: false,
  updated_at: '2026-08-01T00:00:00Z',
} as unknown as Vehicle

// Lo abierto del coche: un accidente y una avería (que NO es de esta pestaña).
const ACCIDENTE = {
  id: 4,
  vehicle: 21,
  type: 'accident',
  type_display: 'Accidente',
  status: 'open',
  status_display: 'Abierta',
  date: '2026-08-10',
  description: 'Golpe en el parking',
  resolution_date: null,
}
const AVERIA = {
  ...ACCIDENTE,
  id: 5,
  type: 'breakdown',
  type_display: 'Avería',
  description: 'Ruido en el motor',
}
const ACCIDENTE_CERRADO = {
  ...ACCIDENTE,
  id: 6,
  status: 'closed',
  status_display: 'Cerrada',
  description: 'Golpe lateral reparado',
  resolution_date: '2026-07-30',
}

function renderModal() {
  return render(
    <LanguageProvider>
      <AccidentModal vehicle={VEHICLE} onClose={vi.fn()} onDone={vi.fn()} />
    </LanguageProvider>,
  )
}

const escribir = (name: string, value: string) =>
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } })
const siguiente = () => userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))

/** Los tres primeros pasos con lo mínimo para poder enviar. */
async function rellenarParte(danos: string) {
  escribir('Calle', 'Calle de Ejemplo')
  escribir('Código postal', '28001')
  escribir('Localidad', 'Madrid')
  escribir('Provincia', 'Madrid')
  fireEvent.change(screen.getByLabelText('Fecha y hora'), {
    target: { value: '2026-08-20T09:30' },
  })
  escribir('Teléfono', '910 000 001')
  await siguiente()
  // Es obligatoria, y se ve que lo es (el textarea no lleva la marca del DS).
  expect(document.querySelector('[data-section="damage"] .ops-label-row')).toHaveTextContent(
    'Obligatorio',
  )
  fireEvent.change(screen.getByLabelText('Descripción de los daños'), { target: { value: danos } })
  await siguiente()
}

describe('AccidentModal (accidente: parte y gestión)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.createIncident.mockReset()
    mocks.updateVehicleFields.mockReset()
    mocks.uploadDocument.mockReset()
    mocks.listAlerts.mockResolvedValue(page([]))
    mocks.listIncidents.mockResolvedValue(page([ACCIDENTE_CERRADO, { ...AVERIA, id: 7, status: 'closed', status_display: 'Cerrada' }]))
    mocks.listOpenIncidents.mockResolvedValue([ACCIDENTE, AVERIA])
  })

  it('el parte va por pasos y solo el último envía', async () => {
    mocks.createIncident.mockResolvedValue({ id: 9, vehicle: 21 })
    mocks.updateVehicleFields.mockResolvedValue({})
    renderModal()

    // 1 · Dónde y cuándo. Todavía no hay nada que enviar ni a dónde volver.
    expect(screen.queryByRole('button', { name: 'Enviar reporte' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    await rellenarParte('Golpe lateral en un cruce')

    // 3 · Un tercero implicado y un lesionado, cada uno en su sub-pestaña.
    await userEvent.click(screen.getByRole('button', { name: /Añadir/ }))
    escribir('Nombre y apellidos', 'Tercero de Ejemplo')
    escribir('Matrícula', '5678ZZZ')
    escribir('Nº de póliza', 'POL-0001')
    await userEvent.click(screen.getByRole('tab', { name: /Lesionados/ }))
    await userEvent.click(screen.getByRole('button', { name: /Añadir/ }))
    escribir('Nombre y apellidos', 'Lesionado de Ejemplo')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Posición' }), 'passenger')
    await siguiente()

    // 4 · Último paso: «Siguiente» se apaga y aparece el envío.
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }))

    expect(mocks.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicle: 21,
        type: 'accident',
        date: '2026-08-20',
        description: 'Golpe lateral en un cruce',
        details: expect.objectContaining({
          report_version: 1,
          street: 'Calle de Ejemplo',
          postal_code: '28001',
          locality: 'Madrid',
          province: 'Madrid',
          occurred_at: '2026-08-20T09:30',
          phone: '910 000 001',
          police_report_reference: '',
          third_parties: [
            expect.objectContaining({
              full_name: 'Tercero de Ejemplo',
              plate: '5678ZZZ',
              policy_number: 'POL-0001',
            }),
          ],
          injured_people: [
            expect.objectContaining({ full_name: 'Lesionado de Ejemplo', seat: 'passenger' }),
          ],
        }),
      }),
    )
    // La casilla (marcada por defecto) deja el coche «Accidentado».
    expect(mocks.updateVehicleFields).toHaveBeenCalledWith(
      21,
      expect.objectContaining({ state: 'accidente' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(/Accidente comunicado/)
  })

  it('un obligatorio vacío no deja pasar de paso', async () => {
    renderModal()
    // Sin calle ni fecha, «Siguiente» no mueve: se sigue en el primer paso.
    await siguiente()
    expect(screen.getByRole('textbox', { name: 'Calle' })).toBeVisible()
    expect(screen.queryByLabelText('Descripción de los daños')).not.toBeVisible()
    expect(mocks.createIncident).not.toHaveBeenCalled()
  })

  /** Las fichas de implicados: una lista por sub-pestaña, una sola ficha
   * abierta a la vez y sus obligatorios comprobados al salir del paso. */
  it('los implicados van en acordeón y no salen del paso incompletos', async () => {
    renderModal()
    await rellenarParte('Golpe lateral')

    // Al añadir la segunda ficha, la primera se encoge.
    await userEvent.click(screen.getByRole('button', { name: /Añadir/ }))
    escribir('Nombre y apellidos', 'Primero de Ejemplo')
    await userEvent.click(screen.getByRole('button', { name: /Añadir/ }))
    expect(screen.getByRole('button', { name: /Tercero 1/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByRole('button', { name: /Tercero 2/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    // «Siguiente» no pasa: al primero le falta la matrícula, y su ficha se abre.
    await siguiente()
    expect(screen.getByRole('alert')).toHaveTextContent('Faltan datos obligatorios en Tercero 1.')
    expect(screen.getByRole('button', { name: /Tercero 1/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    // Fuera el segundo (vacío) y completado el primero, ya se avanza.
    await userEvent.click(screen.getAllByRole('button', { name: 'Quitar tercero' })[1])
    escribir('Matrícula', '5678ZZZ')
    await siguiente()
    expect(screen.getByRole('button', { name: 'Enviar reporte' })).toBeInTheDocument()
  })

  it('sin la casilla no toca el estado del vehículo', async () => {
    mocks.createIncident.mockResolvedValue({ id: 10, vehicle: 21 })
    renderModal()
    await rellenarParte('Rozadura leve')
    await siguiente()

    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Marcar el vehículo como «Accidentado»' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }))

    expect(mocks.createIncident).toHaveBeenCalled()
    expect(mocks.updateVehicleFields).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent(/Accidente comunicado/)
  })

  /** La segunda pestaña es la MISMA lista de «Alertas e incidencias», acotada
   * a los accidentes: abiertos y cerrados, con ✓ y sobre. */
  it('«Gestionar accidentes» lista solo los accidentes, con resolver y correo', async () => {
    renderModal()
    await userEvent.click(screen.getByRole('tab', { name: /Gestionar accidentes/ }))

    expect(await screen.findByText('Golpe en el parking')).toBeInTheDocument()
    // La avería abierta del coche no es de esta pestaña.
    expect(screen.queryByText('Ruido en el motor')).toBeNull()
    expect(screen.getByRole('button', { name: 'Resolver · Accidente' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Avisar por correo · Accidente' })).toBeInTheDocument()
    // Sin pestaña de alertas, no se piden.
    expect(mocks.listAlerts).not.toHaveBeenCalled()

    // El histórico se pide al abrirlo, y también sale acotado.
    await userEvent.click(screen.getByRole('tab', { name: 'Cerradas' }))
    expect(await screen.findByText('Golpe lateral reparado')).toBeInTheDocument()
    expect(mocks.listIncidents).toHaveBeenCalledWith({ vehicle: 21, status: 'closed' })
    expect(screen.queryByText('Ruido en el motor')).toBeNull()
  })
})
