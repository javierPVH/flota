import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AccidentsPage, IncidentsPage } from './IncidentsPage.tsx'
import { ConfirmProvider } from '../components/ConfirmDialog.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  listIncidents: vi.fn(),
  listVehicles: vi.fn(),
  resolveIncident: vi.fn(),
  purgeAccidentThirdParties: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listIncidents: mocks.listIncidents,
  listVehicles: mocks.listVehicles,
  resolveIncident: mocks.resolveIncident,
  purgeAccidentThirdParties: mocks.purgeAccidentThirdParties,
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

/** Accidente CON parte guiado: es lo que el back materializa y manda. */
/** Creado hace tres meses justos (a medianoche local, sin fracción de día). */
function haceMeses(n: number): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setMonth(d.getMonth() - n)
  return d.toISOString()
}

const ACCIDENT = {
  ...OPEN,
  id: 7,
  type: 'accident',
  type_display: 'Accidente',
  created_at: haceMeses(3),
  description: 'Alcance por detrás',
  mileage: 82000,
  workshop_postal_code: '28045',
  accident_report: {
    street: 'Calle Mayor',
    street_number: '12',
    postal_code: '28013',
    locality: 'Madrid',
    province: 'Madrid',
    occurred_at: '2026-08-20T14:35:00Z',
    phone: '600111222',
    police_report_ref: 'ATG-2026-77',
    third_parties: [
      {
        id: 1,
        name: 'Lucía Ramos',
        plate: '9999ZZZ',
        brand: 'Renault',
        model: 'Clio',
        phone: '600333444',
        insurance_company: 'Aseguradora Ejemplo',
        policy_number: 'POL-123',
        damage_description: 'Paragolpes delantero',
      },
    ],
    injured: [
      {
        id: 1,
        name: 'Marta Gil',
        phone: '600555666',
        email: 'marta@flota.dev',
        plate: '1234KLM',
        seat: 'passenger',
        seat_display: 'Ocupante',
      },
    ],
  },
}

/** Neumáticos con el parte guiado: la medida es el dato de la fila. */
const TIRES = {
  ...OPEN,
  id: 8,
  type: 'tires',
  type_display: 'Avería de neumáticos',
  description: 'Necesito cambiar las ruedas',
  mileage: 82000,
  workshop_postal_code: '28045',
  details: {
    report_version: 1,
    change_reason: 'wear',
    wheel_scope: 'front',
    front_measure: '205/55 R16',
  },
}

/** Ya cerrada, con su parte y su solución: es la ficha completa. */
const RESOLVED = {
  ...TIRES,
  id: 10,
  priority: 'moderate',
  priority_display: 'Moderada',
  status: 'closed',
  status_display: 'Cerrada',
  resolution_date: '2026-08-25',
  resolved_at: '2026-08-25T10:00:00Z',
  resolved_by_name: 'Sara Ruiz',
  workshop_name: 'Talleres Ejemplo',
  resolution_km: 82100,
  cost: '210.00',
  details: {
    ...TIRES.details,
    resolution: {
      resolution_date: '2026-08-25',
      downtime_days: 5,
      observations: 'Montadas las dos delanteras.',
      tires: {
        size: '205/55 R16',
        brand: 'Marca Ejemplo',
        quantity: 2,
        positions: ['front_left', 'front_right'],
      },
    },
  },
}

function renderPage(scope: 'incidents' | 'accidents' = 'incidents') {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <ConfirmProvider>
          {scope === 'accidents' ? <AccidentsPage /> : <IncidentsPage />}
        </ConfirmProvider>
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('IncidentsPage (bandeja de incidencias)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listIncidents.mockResolvedValue(page([OPEN, ON_GOING, CLOSED]))
    mocks.listVehicles.mockResolvedValue(page([VEHICLE]))
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
    // Y las otras dos bandejas, a un clic desde la cabecera.
    expect(screen.getByRole('button', { name: /Ver alertas/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ver accidentes/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Cerradas' }))
    expect(await screen.findByTitle('Rueda cambiada')).toBeInTheDocument()
    expect(screen.queryByTitle('No arranca en frío')).toBeNull()
  })

  // El parte guiado recoge dónde, cuándo, atestado, terceros y lesionados, y
  // hasta ahora eso solo se leía en el admin de Django: en la bandeja no había
  // ni rastro.
  // Los accidentes tienen su propia bandeja: aquí ni se listan ni se ofrecen.
  it('los accidentes no salen en incidencias, ni en la tabla ni en el filtro de tipo', async () => {
    mocks.listIncidents.mockResolvedValue(page([ACCIDENT, OPEN]))
    renderPage()
    await screen.findByTitle('No arranca en frío')
    expect(screen.queryByTitle('Alcance por detrás')).toBeNull()
    expect(screen.queryByRole('columnheader', { name: /Meses desde la creación/ })).toBeNull()
    const typeFilter = screen.getByRole('combobox', { name: 'Tipo' })
    expect(within(typeFilter).queryByRole('option', { name: 'Accidente' })).toBeNull()
  })

  it('un accidente despliega su parte en la bandeja de accidentes', async () => {
    mocks.listIncidents.mockResolvedValue(page([ACCIDENT, OPEN]))
    renderPage('accidents')
    await screen.findByTitle('Alcance por detrás')

    // Se pide al back ya acotado al tipo, y lo que no es accidente no se pinta.
    expect(mocks.listIncidents).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'accident' }),
      expect.anything(),
    )
    expect(screen.queryByTitle('No arranca en frío')).toBeNull()

    const flechas = screen.getAllByRole('button', { name: 'Desplegar fila' })
    expect(flechas).toHaveLength(1)

    await userEvent.click(flechas[0])
    // Dónde y cuándo, con la hora (el atestado la usa).
    expect(await screen.findByText(/Calle Mayor 12 · 28013 · Madrid/)).toBeInTheDocument()
    // La hora, en la del navegador (el dato viaja en UTC).
    expect(screen.getByText(/ago 2026, \d{2}:\d{2}/)).toBeInTheDocument()
    expect(screen.getByText('ATG-2026-77')).toBeInTheDocument()
    expect(screen.getByText('600111222')).toBeInTheDocument()
    // Terceros y lesionados, con su recuento.
    expect(screen.getByText('Terceros implicados (1)')).toBeInTheDocument()
    expect(screen.getByText('9999ZZZ')).toBeInTheDocument()
    expect(screen.getByText('Aseguradora Ejemplo')).toBeInTheDocument()
    expect(screen.getByText('Lesionados (1)')).toBeInTheDocument()
    expect(screen.getByText('Marta Gil')).toBeInTheDocument()
    // La plaza la nombra el diccionario por CÓDIGO, como el propio parte
    // («Pasajero»): el `seat_display` del back solo es la reserva.
    expect(screen.getByText('Pasajero')).toBeInTheDocument()
  })

  // El parte de neumáticos deja la descripción como COMENTARIO opcional: sin
  // esta segunda línea, la fila no decía ni qué ruedas ni de qué medida.
  it('«Tipo» va en dos líneas: debajo, lo que recogió el parte', async () => {
    mocks.listIncidents.mockResolvedValue(page([TIRES, ON_GOING]))
    renderPage()
    const fila = (await screen.findByText('Necesito cambiar las ruedas')).closest('tr') as HTMLElement

    expect(within(fila).getByText('Avería de neumáticos')).toBeInTheDocument()
    expect(
      within(fila).getByText(/^Desgaste · Delanteras · 205\/55 R16 · .* km · CP 28045$/),
    ).toBeInTheDocument()

    // Lo que no trae parte se queda en una línea: nada que añadir.
    const otra = (await screen.findByText('En el taller')).closest('tr') as HTMLElement
    expect(within(otra).getByText('Mantenimiento puntual')).toBeInTheDocument()
    expect(within(otra).queryByText(/·/)).toBeNull()
  })

  // La bandeja enseña lo que se filtra y se ordena; el resto del parte y del
  // cierre vivía en el JSON de `details` y en el admin de Django.
  it('el ojo abre la incidencia entera: la petición, el parte y la solución', async () => {
    mocks.listIncidents.mockResolvedValue(page([RESOLVED]))
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: 'Cerradas' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ver la incidencia' }))

    const modal = await screen.findByRole('dialog')
    expect(within(modal).getByText('Incidencia · 1234KLM')).toBeInTheDocument()

    // La petición, con lo que no es columna.
    expect(within(modal).getByText('Necesito cambiar las ruedas')).toBeInTheDocument()
    expect(within(modal).getByText('28045')).toBeInTheDocument()
    // El parte guiado.
    expect(within(modal).getByText('Desgaste · Delanteras · 205/55 R16')).toBeInTheDocument()
    // Y la solución: quién la cerró, cuánto estuvo parado y qué se montó.
    expect(within(modal).getByText('Sara Ruiz')).toBeInTheDocument()
    expect(within(modal).getByText('5 días')).toBeInTheDocument()
    expect(within(modal).getByText('Marca Ejemplo')).toBeInTheDocument()
    expect(
      within(modal).getByText('Delantera izquierda · Delantera derecha'),
    ).toBeInTheDocument()
    expect(within(modal).getByText('Montadas las dos delanteras.')).toBeInTheDocument()
  })

  // Mientras está abierta no hay nada que contar del cierre, y se dice.
  it('en una abierta, la solución dice que aún no la tiene', async () => {
    mocks.listIncidents.mockResolvedValue(page([TIRES]))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Ver la incidencia' }))
    const modal = await screen.findByRole('dialog')
    expect(
      within(modal).getByText('Sigue abierta: todavía no tiene solución registrada.'),
    ).toBeInTheDocument()
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

  it('con cambios propuestos sin decidir, «Resolver» va apagado y dice por qué', async () => {
    mocks.listIncidents.mockResolvedValue(page([{ ...OPEN, id: 31, change_pending: true }]))
    renderPage()
    const boton = await screen.findByRole('button', { name: 'Resolver' })
    expect(boton).toBeDisabled()
    expect(boton).toHaveAttribute('title', expect.stringContaining('acepten o rechacen'))
    expect(screen.getByText('Cambios propuestos desde el campo')).toBeInTheDocument()
  })

  it('el select de estado no ofrece «Cerrada» para una abierta (cerrar es Resolver)', async () => {
    renderPage()
    await screen.findByTitle('No arranca en frío')
    await userEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0])
    const statusSelect = await screen.findByDisplayValue('Abierta')
    expect(within(statusSelect).queryByRole('option', { name: 'Cerrada' })).toBeNull()
    expect(within(statusSelect).getByRole('option', { name: 'En curso' })).toBeInTheDocument()
  })

  // La bandeja de accidentes es la misma página: lo que cambia es lo que
  // enseña y cómo se da de alta —con el parte guiado, no con el formulario—.
  it('la bandeja de accidentes: sin filtro de tipo, y el alta es el parte guiado', async () => {
    mocks.listIncidents.mockResolvedValue(page([ACCIDENT]))
    renderPage('accidents')
    await screen.findByTitle('Alcance por detrás')

    expect(screen.getByRole('heading', { level: 1, name: 'Accidentes' })).toBeInTheDocument()
    // Cuánto lleva abierto el expediente, en meses desde que se creó; en la
    // de incidencias esa columna no existe.
    expect(screen.getByRole('columnheader', { name: /Meses desde la creación/ })).toBeInTheDocument()
    expect(screen.getByText(/^3 meses/)).toHaveAttribute('title', expect.stringMatching(/^Creado el /))
    // Un solo tipo: no hay filtro de tipo; el de vehículo y prioridad siguen.
    expect(screen.queryByRole('combobox', { name: 'Tipo' })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Vehículo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ver incidencias/ })).toBeInTheDocument()

    // Comunicar: primero el coche y después su parte, el mismo de la ficha.
    await userEvent.click(screen.getByRole('button', { name: 'Comunicar accidente' }))
    const modal = await screen.findByRole('dialog', { name: 'Comunicar accidente' })
    const continuar = within(modal).getByRole('button', { name: 'Continuar al parte' })
    expect(continuar).toBeDisabled()
    await userEvent.selectOptions(within(modal).getByRole('combobox'), '21')
    await userEvent.click(continuar)
    expect(
      await screen.findByRole('dialog', { name: 'Comunicar accidente · 1234KLM' }),
    ).toBeInTheDocument()
  })

  // RGPD: pasado el año la fila avisa, a los 18 meses toca borrar los datos
  // de terceros —fila en rojo, nota debajo de los meses y el botón vivo— y,
  // borrados, la fila vuelve a su color y lo dice.
  it('retención de terceros: ámbar al año, rojo y botón vivo a los 18 meses', async () => {
    const reciente = { ...ACCIDENT, id: 7 }
    const anual = { ...ACCIDENT, id: 8, description: 'De hace un año', created_at: haceMeses(13) }
    const viejo = {
      ...ACCIDENT,
      id: 9,
      description: 'De hace año y medio',
      created_at: haceMeses(20),
      third_parties_purge_due: true,
    }
    const borrado = {
      ...viejo,
      id: 10,
      description: 'Ya borrado',
      third_parties_purge_due: false,
      details: { third_parties_purged_at: '2026-10-01T10:00:00Z' },
    }
    mocks.listIncidents.mockResolvedValue(page([reciente, anual, viejo, borrado]))
    mocks.purgeAccidentThirdParties.mockResolvedValue({ ...viejo, third_parties_purge_due: false })
    renderPage('accidents')
    const filaDe = async (texto: string) =>
      (await screen.findByTitle(texto)).closest('tr') as HTMLElement

    expect(await filaDe('Alcance por detrás')).not.toHaveClass('row-age-warn')
    expect(await filaDe('De hace un año')).toHaveClass('row-age-warn')
    const roja = await filaDe('De hace año y medio')
    expect(roja).toHaveClass('row-age-purge')
    expect(within(roja).getByText('Hay que borrar los datos de los terceros implicados.')).toBeInTheDocument()
    expect(await filaDe('Ya borrado')).not.toHaveClass('row-age-purge')
    expect(screen.getByText(/Datos de terceros borrados el/)).toBeInTheDocument()

    // El botón está en todas las filas, pero solo vive en la que toca.
    const botones = screen.getAllByRole('button', { name: 'Borrar datos de terceros' })
    expect(botones).toHaveLength(4)
    expect(within(await filaDe('Alcance por detrás')).getByRole('button', { name: 'Borrar datos de terceros' })).toBeDisabled()
    expect(within(await filaDe('Ya borrado')).getByRole('button', { name: 'Borrar datos de terceros' })).toBeDisabled()
    const vivo = within(roja).getByRole('button', { name: 'Borrar datos de terceros' })
    expect(vivo).toBeEnabled()

    // Confirmación en rojo, y al aceptar se llama al back y se recarga.
    await userEvent.click(vivo)
    const dialogo = await screen.findByRole('dialog', { name: 'Borrar datos de terceros · 1234KLM' })
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Borrar datos de terceros' }))
    await waitFor(() => expect(mocks.purgeAccidentThirdParties).toHaveBeenCalledWith(9))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Datos de terceros del accidente de 1234KLM borrados.',
    )
  })

  // Un accidente se modifica ENTERO: el lápiz abre el mismo parte que lo
  // comunicó, cargado con lo que tiene (aquí desde las tablas materializadas,
  // que es lo que trae un accidente sin `details`).
  it('en accidentes, «Editar» abre el parte entero cargado con el accidente', async () => {
    mocks.listIncidents.mockResolvedValue(page([ACCIDENT]))
    renderPage('accidents')
    await screen.findByTitle('Alcance por detrás')
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }))
    const modal = await screen.findByRole('dialog', { name: 'Modificar accidente · 1234KLM' })
    expect(within(modal).getByLabelText('Calle')).toHaveValue('Calle Mayor')
    expect(within(modal).getByLabelText('Localidad')).toHaveValue('Madrid')
    // «Teléfono» se repite en las fichas de implicados (montadas, ocultas):
    // el primero es el del paso «Dónde y cuándo».
    expect(within(modal).getAllByLabelText('Teléfono')[0]).toHaveValue('600111222')
    // El formulario corto no se abre: no hay desplegable de tipo.
    expect(within(modal).queryByLabelText('Tipo')).toBeNull()
  })

  it('el filtro de tipo incluye «Petición general»', async () => {
    renderPage()
    await screen.findByTitle('No arranca en frío')
    const typeFilter = screen.getByRole('combobox', { name: 'Tipo' })
    expect(within(typeFilter).getByRole('option', { name: 'Petición general' })).toBeInTheDocument()
  })
})
