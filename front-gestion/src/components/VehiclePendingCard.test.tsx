import { useRef } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  VehicleAccidentsCard,
  VehiclePendingCard,
  type PendingCardHandle,
} from './VehiclePendingCard.tsx'
import type { PendingResumen } from './usePending.tsx'
import { useAccordion } from './CollapsibleCard.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listAlerts: vi.fn(),
  listIncidents: vi.fn(),
  listKmReadingsAll: vi.fn(),
  listOpenIncidents: vi.fn(),
  listWorkshops: vi.fn(),
  noticePreviewVehicle: vi.fn(),
  resolveIncident: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listAlerts: mocks.listAlerts,
  listIncidents: mocks.listIncidents,
  listKmReadingsAll: mocks.listKmReadingsAll,
  listOpenIncidents: mocks.listOpenIncidents,
  listWorkshops: mocks.listWorkshops,
  noticePreviewVehicle: mocks.noticePreviewVehicle,
  resolveIncident: mocks.resolveIncident,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

const VEHICLE = {
  id: 21,
  plate: '1234KLM',
  brand: 'Seat',
  model: 'Leon',
  state: 'broken',
  state_display: 'Averiado',
  driver_name: 'Carlos Ruiz',
  supervisor_name: 'Sara Jefa',
  next_itv_date: '2026-09-01',
  insurance_expiry_date: '2026-09-20',
} as unknown as Vehicle

const ALERTS = [
  {
    id: 1,
    type: 'km_reading_pending',
    type_display: 'Lectura de km pendiente',
    level: 'info',
    level_display: 'Informativa',
    status: 'open',
    vehicle: 21,
    vehicle_plate: '1234KLM',
    message: 'Falta la lectura de agosto',
    due_date: null,
  },
  {
    id: 2,
    type: 'itv_due',
    type_display: 'ITV programada',
    level: 'critical',
    level_display: 'Crítica',
    status: 'open',
    vehicle: 21,
    vehicle_plate: '1234KLM',
    message: 'ITV vencida',
    due_date: '2026-09-01',
  },
]

const INCIDENTS = [
  {
    id: 4,
    vehicle: 21,
    type: 'breakdown',
    type_display: 'Avería',
    date: '2026-08-20',
    description: 'No arranca en frío',
    details: {},
    status: 'on_going',
    status_display: 'En curso',
    cost: null,
  },
]

/** Un accidente abierto, para la tarjeta que solo mira ese tipo. */
const ACCIDENT = {
  ...INCIDENTS[0],
  id: 8,
  type: 'accident',
  type_display: 'Accidente',
  date: '2026-08-28',
  description: 'Golpe en el parking',
}

/** Segunda petición sin cerrar del mismo coche (para el correo «todas»). */
const SECOND_INCIDENT = {
  ...INCIDENTS[0],
  id: 6,
  type: 'maintenance',
  type_display: 'Mantenimiento puntual',
  date: '2026-09-01',
  description: 'Revisión de frenos',
  status: 'open',
  status_display: 'Abierta',
}

// Histórico: una incidencia cerrada y una alerta resuelta.
const CLOSED_INCIDENT = {
  ...INCIDENTS[0],
  id: 9,
  date: '2026-05-02',
  resolution_date: '2026-05-10',
  description: 'Retrovisor reparado',
  status: 'closed',
  status_display: 'Cerrada',
}

const RESOLVED_ALERT = {
  ...ALERTS[1],
  id: 7,
  status: 'resolved',
  status_display: 'Resuelta',
  message: 'ITV superada',
  resolved_at: '2026-06-15T10:00:00Z',
  resolved_by_name: 'Ana Gestora',
}

/** La tarjeta de accidentes de la ficha (misma lista, acotada a ese tipo). */
function AccidentesHarness() {
  const accordion = useAccordion(['accidents'])
  return (
    <MemoryRouter>
      <LanguageProvider>
        <VehicleAccidentsCard
          vehicle={VEHICLE}
          accordion={accordion}
          links={[]}
          onChanged={vi.fn()}
        />
      </LanguageProvider>
    </MemoryRouter>
  )
}

function Harness({
  onChanged = vi.fn(),
  onResumen,
}: {
  onChanged?: () => void
  onResumen?: (resumen: PendingResumen | null) => void
}) {
  const accordion = useAccordion(['pending'])
  return (
    <MemoryRouter>
      <LanguageProvider>
        <VehiclePendingCard
          vehicle={VEHICLE}
          accordion={accordion}
          links={[]}
          onChanged={onChanged}
          onResumen={onResumen}
        />
      </LanguageProvider>
    </MemoryRouter>
  )
}

const tab = (name: string) => screen.getByRole('tab', { name })

describe('VehiclePendingCard (alertas e incidencias de la ficha)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listAlerts.mockResolvedValue(page(ALERTS))
    mocks.listIncidents.mockResolvedValue(page([CLOSED_INCIDENT]))
    mocks.listKmReadingsAll.mockResolvedValue(page([]))
    mocks.listOpenIncidents.mockResolvedValue(INCIDENTS)
    mocks.listWorkshops.mockResolvedValue([])
    mocks.noticePreviewVehicle.mockResolvedValue({
      subject: 'Aviso',
      body_html: '<p>Aviso</p>',
      has_template: true,
      has_en: true,
    })
    mocks.resolveIncident.mockReset()
  })

  it('abre en Incidencias · Abiertas y las alertas van en su pestaña', async () => {
    render(<Harness />)
    await screen.findByRole('button', { name: 'Resolver · Avería' })
    // Solo las del vehículo, abiertas / sin cerrar (el histórico no se pide aún).
    expect(mocks.listAlerts).toHaveBeenCalledWith({ status: 'open', vehicle: 21 })
    expect(mocks.listOpenIncidents).toHaveBeenCalledWith({ vehicle: 21 })
    expect(mocks.listIncidents).not.toHaveBeenCalled()

    // Pestaña de salida: incidencias abiertas (la alerta no está aquí).
    expect(tab('Incidencias 1')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Abiertas')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Resolver · Avería' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resolver · ITV programada' })).toBeNull()

    // Las alertas, en la suya y con las graves primero.
    await userEvent.click(tab('Alertas 2'))
    const resolveButtons = screen.getAllByRole('button', { name: /^Resolver · / })
    expect(resolveButtons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Resolver · ITV programada', // crítica antes que informativa
      'Resolver · Lectura de km pendiente',
    ])
    expect(screen.getByText(/Vencido hace|Vence/)).toBeInTheDocument()
  })

  /** El orden de lectura de la fila: fecha, título y luego la descripción. */
  it('cada fila va con la fecha delante, después el título y al final la descripción', async () => {
    render(<Harness />)
    const row = await screen.findByTitle('No arranca en frío')
    expect(row.textContent).toMatch(/20 ago 2026.*Avería.*No arranca en frío/)
    // La píldora de estado cierra la fila, detrás de la descripción.
    expect(within(row).getByText('En curso')).toBeInTheDocument()
  })

  it('«Cerradas» pide el histórico y lo enseña con la fecha de la solución', async () => {
    render(<Harness />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Cerradas' }))
    await waitFor(() =>
      expect(mocks.listIncidents).toHaveBeenCalledWith({ vehicle: 21, status: 'closed' }),
    )
    const row = await screen.findByTitle('Retrovisor reparado')
    // La fecha del histórico es la de la solución (10 may), no la de apertura.
    expect(row.textContent).toMatch(/10 may 2026.*Avería.*Retrovisor reparado/)
    // Ya cerrada: no hay ✓ que la resuelva.
    expect(screen.queryByRole('button', { name: /^Resolver · / })).toBeNull()

    // Y las alertas resueltas, en su pestaña.
    mocks.listAlerts.mockResolvedValue(page([RESOLVED_ALERT]))
    await userEvent.click(tab('Alertas 2'))
    await waitFor(() =>
      expect(mocks.listAlerts).toHaveBeenCalledWith({ status: 'resolved', vehicle: 21 }),
    )
    expect(await screen.findByText(/Resuelta por Ana Gestora/)).toBeInTheDocument()
  })

  it('el ✓ de una incidencia abre el cierre de su tipo y, al resolver, recarga y avisa a la ficha', async () => {
    mocks.resolveIncident.mockResolvedValue({ ...INCIDENTS[0], status: 'closed', vehicle_reactivated: true })
    const onChanged = vi.fn()
    render(<Harness onChanged={onChanged} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Resolver · Avería' }))
    const dialog = await screen.findByRole('dialog', { name: 'Resolver avería · 1234KLM' })
    // Coche averiado: la casilla de vuelta a Activo viene marcada.
    expect(within(dialog).getByRole('checkbox', { name: /Devolver el vehículo a Activo/ })).toBeChecked()
    mocks.listOpenIncidents.mockResolvedValue([])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Resolver y cerrar' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(mocks.resolveIncident).toHaveBeenCalledWith(4, expect.objectContaining({ return_to_active: true }))
    expect(await screen.findByRole('status')).toHaveTextContent(/vuelve a estar Activo/)
    // Y la lista se recarga: la incidencia que se acaba de cerrar ya no está.
    await waitFor(() => expect(screen.getByText('Sin incidencias abiertas.')).toBeInTheDocument())
  })

  /** Filtros y orden: en las alertas hay tipo y prioridad; el orden de salida
   * es la prioridad, y se puede cambiar a proximidad de la fecha. */
  it('las alertas se filtran por tipo y prioridad, y se pueden reordenar', async () => {
    render(<Harness />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Alertas 2' }))

    // De salida, por prioridad: la crítica primero.
    const titulos = () =>
      screen.getAllByRole('button', { name: /^Resolver · / }).map((b) => b.getAttribute('aria-label'))
    expect(titulos()).toEqual(['Resolver · ITV programada', 'Resolver · Lectura de km pendiente'])

    // Por proximidad de la fecha: la de km no tiene fecha y cae al final.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Ordenar' }), 'near')
    expect(titulos()).toEqual(['Resolver · ITV programada', 'Resolver · Lectura de km pendiente'])

    // Filtrar por prioridad deja solo la crítica…
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Prioridad' }), 'critical')
    expect(titulos()).toEqual(['Resolver · ITV programada'])
    // …y por tipo, solo la de lectura de km (la prioridad se vacía al volver).
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Prioridad' }), '')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Tipo' }),
      'km_reading_pending',
    )
    expect(titulos()).toEqual(['Resolver · Lectura de km pendiente'])

    // Cambiar de pestaña no arrastra el filtro a una lista que no lo entiende.
    await userEvent.click(screen.getByRole('tab', { name: 'Incidencias 1' }))
    expect(screen.getByRole('combobox', { name: 'Tipo' })).toHaveValue('')
    // Y en incidencias no hay prioridad: eso es de las alertas.
    expect(screen.queryByRole('combobox', { name: 'Prioridad' })).toBeNull()
  })

  /** El sobre solo donde es pertinente: algo abierto de lo que avisar. */
  it('cada fila abierta lleva el sobre a la derecha, y las cerradas no', async () => {
    render(<Harness />)
    expect(await screen.findByRole('button', { name: 'Avisar por correo · Avería' })).toBeInTheDocument()
    await userEvent.click(tab('Alertas 2'))
    expect(screen.getAllByRole('button', { name: /^Avisar por correo · / })).toHaveLength(2)

    // El histórico no se avisa: ya está resuelto.
    await userEvent.click(tab('Cerradas'))
    await waitFor(() =>
      expect(mocks.listAlerts).toHaveBeenCalledWith({ status: 'resolved', vehicle: 21 }),
    )
    // Las filas cerradas están (con su marca, no con el ✓) y ninguna lleva sobre.
    expect((await screen.findAllByRole('img', { name: 'Resuelta' })).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /^Avisar por correo · / })).toBeNull()
  })

  it('el sobre de la alerta de ITV abre el aviso de ITV con el conductor premarcado', async () => {
    render(<Harness />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Alertas 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Avisar por correo · ITV programada' }))

    const dialog = await screen.findByRole('dialog', { name: 'Enviar correo · 1234KLM' })
    // Plantilla de ITV: enseña el dato del que avisa, en el primer paso.
    expect(within(dialog).getByText('Próxima ITV')).toBeInTheDocument()
    // Los destinatarios son el tercer paso: se llega con «Siguiente».
    await userEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' }))
    // El responsable del coche viene marcado; el supervisor, solo si no hay conductor.
    expect(within(dialog).getByRole('checkbox', { name: 'Conductor' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Supervisor' })).not.toBeChecked()
    // Y el correo no se manda desde aquí: «Enviar» aparece en el último paso.
    expect(within(dialog).queryByRole('button', { name: 'Enviar correo' })).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' }))
    expect(within(dialog).getByRole('button', { name: 'Enviar correo' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Siguiente' })).toBeDisabled()
  })

  it('el sobre de una incidencia la deja elegida y describe en el mensaje', async () => {
    // El modal de correo pide las incidencias sin cerrar del coche.
    mocks.listIncidents.mockResolvedValue(page(INCIDENTS))
    render(<Harness />)
    await userEvent.click(await screen.findByRole('button', { name: 'Avisar por correo · Avería' }))

    const dialog = await screen.findByRole('dialog', { name: 'Enviar correo · 1234KLM' })
    // El texto de la incidencia vive en el paso 2, «Contenido».
    await userEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' }))
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/Mensaje adicional/)).toHaveValue(
        'Avería: No arranca en frío (20 ago 2026)',
      ),
    )
  })

  /** La incidencia es cosa del comunicado de estado: los demás correos hablan
   * de su vencimiento, no de lo que el coche tenga abierto. */
  it('la incidencia solo se elige en el comunicado de estado, y caben todas', async () => {
    mocks.listIncidents.mockResolvedValue(page([INCIDENTS[0], SECOND_INCIDENT]))
    render(<Harness />)
    await userEvent.click(await screen.findByRole('button', { name: 'Avisar por correo · Avería' }))

    const dialog = await screen.findByRole('dialog', { name: 'Enviar correo · 1234KLM' })
    const incidencia = await within(dialog).findByRole('combobox', { name: 'Incidencia sin cerrar' })

    // Con más de una sin cerrar, se pueden meter todas de golpe.
    await userEvent.selectOptions(incidencia, 'all')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' }))
    expect(within(dialog).getByLabelText(/Mensaje adicional/)).toHaveValue(
      'Avería: No arranca en frío (20 ago 2026)\nMantenimiento puntual: Revisión de frenos (1 sept 2026)',
    )

    // Y en cuanto el correo deja de ser el comunicado de estado, el selector
    // se va (con el texto que había puesto).
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anterior' }))
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Tipo de correo' }),
      'itv_due',
    )
    expect(within(dialog).queryByRole('combobox', { name: 'Incidencia sin cerrar' })).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' }))
    expect(within(dialog).getByLabelText(/Mensaje adicional/)).toHaveValue('')
  })

  it('el ✓ de la alerta de ITV abre Registrar ITV con el coche puesto', async () => {
    render(<Harness />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Alertas 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Resolver · ITV programada' }))
    await screen.findByRole('dialog', { name: 'Registrar ITV · 1234KLM' })
    expect(screen.getByRole('combobox', { name: 'Vehículo' })).toHaveValue('21')
  })

  /** El aviso de «Cambiar estado» de la ficha manda aquí: el asistente que
   * abre incidencias es UNO, y se llama por ref en vez de montar otra copia. */
  it('deja abrir una incidencia desde fuera de la tarjeta', async () => {
    function Fuera() {
      const accordion = useAccordion(['pending'])
      const ref = useRef<PendingCardHandle>(null)
      return (
        <MemoryRouter>
          <LanguageProvider>
            <button type="button" onClick={() => ref.current?.nuevaIncidencia()}>
              Abrir una incidencia
            </button>
            <VehiclePendingCard
              handleRef={ref}
              vehicle={VEHICLE}
              accordion={accordion}
              links={[]}
              onChanged={vi.fn()}
            />
          </LanguageProvider>
        </MemoryRouter>
      )
    }
    render(<Fuera />)
    await screen.findByRole('button', { name: 'Resolver · Avería' })

    await userEvent.click(screen.getByRole('button', { name: 'Abrir una incidencia' }))
    // El mismo asistente que abre «Nueva incidencia» de la cabecera.
    expect(await screen.findByRole('dialog', { name: /1234KLM/ })).toBeInTheDocument()
  })

  it('sin nada abierto lo dice en cada pestaña, y ofrece abrir una incidencia', async () => {
    mocks.listAlerts.mockResolvedValue(page([]))
    mocks.listOpenIncidents.mockResolvedValue([])
    render(<Harness />)
    expect(await screen.findByText('Sin incidencias abiertas.')).toBeInTheDocument()
    await userEvent.click(tab('Alertas'))
    expect(screen.getByText('Sin alertas abiertas.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nueva incidencia' })).toBeInTheDocument()
    // El accidente se comunica en SU tarjeta, no en esta.
    expect(screen.queryByRole('button', { name: 'Comunicar accidente' })).toBeNull()
  })

  /** La tarjeta de accidentes: la misma lista acotada a ese tipo, y el único
   * sitio de la ficha desde el que se comunica uno. */
  it('la tarjeta de accidentes lista solo accidentes y comunica el parte', async () => {
    mocks.listOpenIncidents.mockResolvedValue([...INCIDENTS, ACCIDENT])
    // Los mocks son del módulo y acumulan llamadas entre casos.
    mocks.listAlerts.mockClear()
    render(<AccidentesHarness />)

    // La avería (la otra incidencia abierta del coche) no pinta nada aquí.
    expect(await screen.findByText(/Golpe en el parking/)).toBeInTheDocument()
    expect(screen.queryByText(/No arranca en frío/)).toBeNull()
    // Ni se piden las alertas: esta lista no las mira. Por eso tampoco salen
    // las pestañas «Incidencias / Alertas»: aquí solo hay una lista.
    expect(mocks.listAlerts).not.toHaveBeenCalled()
    expect(screen.queryByRole('tab', { name: /Alertas/ })).toBeNull()
    expect(screen.queryByRole('tab', { name: /Incidencias/ })).toBeNull()
    // Cuántos hay abiertos lo dice «Abiertas», que es lo único que queda arriba.
    expect(screen.getByRole('tab', { name: 'Abiertas 1' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Comunicar accidente' }))
    expect(await screen.findByRole('dialog', { name: 'Comunicar accidente · 1234KLM' })).toBeInTheDocument()
  })

  it('si fallan las dos cargas avisa del error en vez de fingir que no hay nada', async () => {
    mocks.listAlerts.mockRejectedValue(new Error('500'))
    mocks.listOpenIncidents.mockRejectedValue(new Error('500'))
    render(<Harness />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudieron cargar/)
  })
  /** La ficha resume arriba lo que hay abierto: el dato sale de aquí, que ya
   * lo pidió, en vez de volver a pedirlo. Cuenta por tipo y con su nombre. */
  it('pasa hacia fuera lo abierto agrupado por tipo', async () => {
    const onResumen = vi.fn()
    render(<Harness onResumen={onResumen} />)

    await waitFor(() => {
      const ultimo = onResumen.mock.calls.at(-1)?.[0] as PendingResumen | null
      expect(ultimo).not.toBeNull()
      expect(ultimo?.alerts).toEqual([
        { tipo: 'km_reading_pending', label: 'Lectura de km pendiente', total: 1 },
        { tipo: 'itv_due', label: 'ITV programada', total: 1 },
      ])
      expect(ultimo?.incidents).toEqual([{ tipo: 'breakdown', label: 'Avería', total: 1 }])
    })
  })
})
