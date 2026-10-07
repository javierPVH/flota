import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HsePage } from './HsePage.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  listVehicles: vi.fn(),
  listKmReadingsAll: vi.fn(),
  listFuelConsumptions: vi.fn(),
  fetchReportPreview: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  listKmReadingsAll: mocks.listKmReadingsAll,
  listFuelConsumptions: mocks.listFuelConsumptions,
  fetchReportPreview: mocks.fetchReportPreview,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

/** El mes que la pantalla refleja de salida (el actual). */
const MES = new Date().toISOString().slice(0, 7)

const ACTIVO = {
  id: 21,
  plate: '1234KLM',
  brand: 'Seat',
  model: 'Leon',
  state: 'active',
  state_display: 'Activo',
  is_substitute: false,
  contract_start_date: '2026-01-15',
  contract_end_date: '2029-01-14',
  km_current: 53730,
  km_reading_date: `${MES}-20`,
  fuel_avg_consumption: '6.80',
  fuel_avg_date: `${MES}-18`,
  fuel: 'Diésel',
}
/** Parado: no sale en «Vehículos» (solo los que ruedan), sí en «Lecturas». */
const PARADO = {
  ...ACTIVO,
  id: 22,
  plate: '5678BCD',
  brand: 'Renault',
  model: 'Master',
  state: 'broken',
  state_display: 'No activo - Averiado',
  contract_start_date: null,
  contract_end_date: null,
  km_current: 12000,
  km_reading_date: '2026-01-02',
  fuel_avg_consumption: null,
  fuel_avg_date: null,
}

/** Activo pero sin reportar NADA: es el que llena las tres listas de «falta». */
const CALLADO = {
  ...ACTIVO,
  id: 23,
  plate: '9999QQQ',
  brand: 'Peugeot',
  model: 'Partner',
  km_current: null,
  km_reading_date: null,
  fuel_avg_consumption: null,
  fuel_avg_date: null,
}

/** El histórico de 1234KLM: dos lecturas y un consumo, uno de ellos el MISMO
 *  día que una lectura (tiene que salir en una sola fila, no en dos). */
const HISTORIAL_KM = [
  { id: 1, vehicle: 21, reading_date: `${MES}-20`, km_reading: 53730, estimated: false },
  { id: 2, vehicle: 21, reading_date: '2026-08-31', km_reading: 48400, estimated: true },
]
const HISTORIAL_FUEL = [
  { id: 9, vehicle: 21, reading_date: `${MES}-20`, avg_consumption: '6.80' },
]

const INFORME = {
  tables: [
    {
      title: 'Resumen',
      headers: ['Indicador', 'Valor', 'Detalle'],
      rows: [
        ['Coches activos', 1, 'Los que ruedan hoy.'],
        ['Generado el', '2026-10-07', ''],
      ],
    },
    {
      title: 'Vehículos',
      headers: ['Matrícula', 'Marca', 'Modelo', 'Estado', 'Fecha de inicio', 'Última lectura (km)'],
      rows: [['1234KLM', 'Seat', 'Leon', 'Activo', '2026-01-15', 31000]],
    },
    {
      title: 'Kilometraje',
      headers: ['Vehículo', 'Fecha', 'Kilómetros', 'Estimada'],
      rows: [['1234KLM', `${MES}-20`, 53730, 'No']],
    },
  ],
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <HsePage />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

/** Lo que esta vista NO enseña: ni personas, ni costes, ni lo que le pasa al coche. */
const EXCLUIDO = /conductor|supervisor|coste|incidencia|accidente|mantenimiento|itv|seguro/i

describe('HsePage (cómo se usa la flota, de solo lectura)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    // El caso en inglés lo guarda: sin esto, se lo llevaría el siguiente.
    localStorage.removeItem('gs_base_lang')
    vi.clearAllMocks()
    mocks.listVehicles.mockResolvedValue(page([ACTIVO, PARADO]))
    mocks.listKmReadingsAll.mockResolvedValue(page(HISTORIAL_KM))
    mocks.listFuelConsumptions.mockResolvedValue(page(HISTORIAL_FUEL))
    mocks.fetchReportPreview.mockResolvedValue(INFORME)
  })

  it('dos pestañas, las cifras de cabecera y solo los coches activos', async () => {
    const { container } = renderPage()
    await screen.findByText('1234KLM')

    // Las lecturas ya no son una pestaña: viven dentro de la fila de su coche.
    const tabs = screen.getAllByRole('tab').map((b) => b.textContent ?? '')
    expect(tabs).toHaveLength(2)
    expect(tabs.join(' ')).toContain('Vehículos')
    expect(tabs.join(' ')).toContain('Informe')
    expect(tabs.join(' ')).not.toContain('Lecturas')

    // Las cuatro cifras: dos coches en la flota, uno activo, y ese con lectura
    // y consumo de este mes.
    const cifras = container.querySelectorAll('.stat-grid > *')
    expect(cifras).toHaveLength(4)
    expect(cifras[0].textContent).toContain('1')
    expect(cifras[0].textContent).toContain('2 en la flota')
    expect(cifras[1].textContent).toContain('1 / 1')

    // La tabla trae el activo y NO el parado.
    expect(screen.queryByText('5678BCD')).not.toBeInTheDocument()
    const fila = screen.getByText('1234KLM').closest('tr') as HTMLElement
    expect(within(fila).getByText('15 ene 2026')).toBeInTheDocument()
    expect(within(fila).getByText('14 ene 2029')).toBeInTheDocument()
    expect(within(fila).getByText('6,80')).toBeInTheDocument()
  })

  it('las columnas no hablan ni de personas ni de costes ni de lo que le pasa al coche', async () => {
    renderPage()
    await screen.findByText('1234KLM')

    const cabeceras = screen.getAllByRole('columnheader').map((th) => th.textContent ?? '')
    expect(cabeceras.join(' ')).not.toMatch(EXCLUIDO)
    // Y sí las diez que pide HSE.
    for (const columna of ['Matrícula', 'Marca', 'Modelo', 'Estado', 'Fecha de inicio']) {
      expect(cabeceras.join(' ')).toContain(columna)
    }
  })

  it('encima de las columnas, una cabecera que dice de qué va cada tramo', async () => {
    renderPage()
    await screen.findByText('1234KLM')

    const grupos = within(screen.getAllByRole('row')[0]).getAllByRole('columnheader')
    expect(grupos.map((th) => th.textContent)).toEqual([
      'Vehículo',
      'Contrato',
      'Kilometraje',
      'Combustible',
    ])
    // Las dos parejas de la derecha son una fecha y una cifra cada una: sin
    // esta fila, «Última lectura» y «Último consumo» se leen igual.
    expect(grupos[2]).toHaveAttribute('colspan', '2')
    expect(grupos[3]).toHaveAttribute('colspan', '2')
  })

  describe('cada coche despliega su histórico', () => {
    const abrirFila = async (user: ReturnType<typeof userEvent.setup>, plate: string) => {
      const fila = screen.getByText(plate).closest('tr') as HTMLElement
      await user.click(within(fila).getByRole('button'))
    }

    it('no se pide nada hasta desplegar, y entonces se piden las dos cosas', async () => {
      const user = userEvent.setup()
      renderPage()
      await screen.findByText('1234KLM')
      // Al cargar la pantalla no se trae ningún histórico: antes se traía una
      // ventana de dos meses de TODA la flota para pintar una columna.
      expect(mocks.listKmReadingsAll).not.toHaveBeenCalled()
      expect(mocks.listFuelConsumptions).not.toHaveBeenCalled()

      await abrirFila(user, '1234KLM')
      await waitFor(() => expect(mocks.listKmReadingsAll).toHaveBeenCalled())
      expect(mocks.listKmReadingsAll.mock.calls[0][0]).toEqual({ vehicle: 21 })
      expect(mocks.listFuelConsumptions.mock.calls[0][0]).toEqual({ vehicle: 21 })
    })

    it('enseña lecturas y consumo juntos, una fila por fecha', async () => {
      const user = userEvent.setup()
      renderPage()
      await screen.findByText('1234KLM')
      await abrirFila(user, '1234KLM')

      const historico = (await screen.findByText('Lectura')).closest('table') as HTMLElement
      const filas = within(historico).getAllByRole('row').slice(1) // sin cabecera
      // Dos fechas, no tres: la lectura y el consumo del mismo día van juntos.
      expect(filas).toHaveLength(2)
      expect(within(filas[0]).getByText('53.730')).toBeInTheDocument()
      expect(within(filas[0]).getByText('6,80')).toBeInTheDocument()
      // La estimada se dice: no la dio nadie, la calculó el sistema.
      expect(within(filas[1]).getByText('48.400')).toBeInTheDocument()
      expect(within(filas[1]).getByText('Estimada')).toBeInTheDocument()
    })

    it('encabeza el histórico con la evolución de km y la de consumo', async () => {
      const user = userEvent.setup()
      renderPage()
      await screen.findByText('1234KLM')
      await abrirFila(user, '1234KLM')

      // Dos lecturas → se dibuja la curva de km, con su escala y su resumen.
      const km = await screen.findByRole('img', { name: 'Evolución de los kilómetros' })
      expect(km.querySelectorAll('.trend-dot')).toHaveLength(2)
      // Lo último anotado y cuánto ha cambiado desde la primera anotación:
      // 53.730 ahora, 5.330 más que los 48.400 de agosto.
      const resumen = km.closest('figure')?.querySelector('.trend-now')
      expect(resumen?.textContent).toContain('53.730')
      expect(resumen?.textContent).toContain('km')
      expect(resumen?.querySelector('.trend-delta')?.textContent).toContain('5.330')
      // En los kilómetros, subir no es ni bueno ni malo: siempre suben.
      expect(resumen?.querySelector('.trend-delta')?.className).not.toMatch(/is-(good|bad)/)
      // La escala se dice SIEMPRE: el eje no arranca en cero y sin ella engaña.
      expect(km.querySelectorAll('.trend-grid')).toHaveLength(3)
      // La estimada se pinta hueca: no la dio nadie.
      expect(km.querySelectorAll('.trend-dot.is-soft')).toHaveLength(1)

      // Un solo consumo no es una evolución: se dice, y no se dibuja nada.
      expect(
        screen.queryByRole('img', { name: 'Evolución del consumo medio' }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByText('Hacen falta dos anotaciones para dibujar una evolución.'),
      ).toBeInTheDocument()
    })

    it('la fila y el punto de su fecha se señalan a la vez', async () => {
      const user = userEvent.setup()
      renderPage()
      await screen.findByText('1234KLM')
      await abrirFila(user, '1234KLM')

      const historico = (await screen.findByText('Lectura')).closest('table') as HTMLElement
      const filas = within(historico).getAllByRole('row').slice(1)
      const grafica = screen.getByRole('img', { name: 'Evolución de los kilómetros' })
      expect(grafica.querySelector('.trend-hover')).toBeNull()

      // Pasar por la fila del 20 (lectura y consumo del mismo día) marca la
      // fila y el punto de esa fecha en la gráfica.
      await user.hover(filas[0])
      expect(filas[0].className).toContain('is-marked')
      expect(grafica.querySelector('.trend-tip text')?.textContent).toContain('53.730')

      // La del 31 de agosto es solo lectura: la gráfica de km la tiene y la de
      // consumo no, y ahí no se marca nada (es la misma anotación, no la hay).
      await user.hover(filas[1])
      expect(filas[0].className).not.toContain('is-marked')
      expect(grafica.querySelector('.trend-tip text')?.textContent).toContain('48.400')

      await user.unhover(filas[1])
      expect(grafica.querySelector('.trend-hover')).toBeNull()
    })

    it('el rango de fechas vuelve a pedir el histórico de ESE coche', async () => {
      const user = userEvent.setup()
      renderPage()
      await screen.findByText('1234KLM')
      await abrirFila(user, '1234KLM')
      await waitFor(() => expect(mocks.listKmReadingsAll).toHaveBeenCalled())
      // Se entra viendo TODO: los dos campos nacen vacíos y no acotan nada.
      expect(mocks.listKmReadingsAll.mock.calls[0][0]).toEqual({
        vehicle: 21,
        from: undefined,
        to: undefined,
      })

      mocks.listKmReadingsAll.mockClear()
      mocks.listFuelConsumptions.mockClear()
      await user.type(screen.getByLabelText('Desde'), '2026-08-01')
      await waitFor(() => expect(mocks.listKmReadingsAll).toHaveBeenCalled())
      // Las DOS series se acotan igual: media respuesta no es una respuesta.
      expect(mocks.listKmReadingsAll.mock.calls.at(-1)?.[0]).toEqual({
        vehicle: 21,
        from: '2026-08-01',
        to: undefined,
      })
      expect(mocks.listFuelConsumptions.mock.calls.at(-1)?.[0]).toEqual({
        vehicle: 21,
        from: '2026-08-01',
        to: undefined,
      })

      // Y se puede volver a «todo»: vaciar dos fechas a mano es incómodo.
      mocks.listKmReadingsAll.mockClear()
      await user.click(screen.getByRole('button', { name: 'Todo el histórico' }))
      await waitFor(() =>
        expect(mocks.listKmReadingsAll.mock.calls.at(-1)?.[0]).toEqual({
          vehicle: 21,
          from: undefined,
          to: undefined,
        }),
      )
    })

    it('con un rango que no deja nada, las fechas siguen ahí para deshacerlo', async () => {
      const user = userEvent.setup()
      renderPage()
      await screen.findByText('1234KLM')
      await abrirFila(user, '1234KLM')
      await screen.findByText('Anotaciones, una línea por día')

      mocks.listKmReadingsAll.mockResolvedValue(page([]))
      mocks.listFuelConsumptions.mockResolvedValue(page([]))
      await user.type(screen.getByLabelText('Hasta'), '2020-01-01')

      expect(
        await screen.findByText('Este coche no tiene anotaciones en estas fechas.'),
      ).toBeInTheDocument()
      // Si las fechas desaparecieran con la tabla, no habría forma de deshacer
      // el filtro que acaba de vaciarla.
      expect(screen.getByLabelText('Hasta')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Todo el histórico' })).toBeInTheDocument()
    })

    it('un coche sin ninguna anotación no ofrece flecha', async () => {
      mocks.listVehicles.mockResolvedValue(page([ACTIVO, CALLADO]))
      renderPage()
      await screen.findByText('9999QQQ')
      const fila = screen.getByText('9999QQQ').closest('tr') as HTMLElement
      expect(within(fila).queryByRole('button')).not.toBeInTheDocument()
      // Y el que sí tiene, sí.
      const conDatos = screen.getByText('1234KLM').closest('tr') as HTMLElement
      expect(within(conDatos).getByRole('button')).toBeInTheDocument()
    })

    it('la casilla trae los coches parados, que también tienen histórico', async () => {
      const user = userEvent.setup()
      renderPage()
      await screen.findByText('1234KLM')
      expect(screen.queryByText('5678BCD')).not.toBeInTheDocument()

      await user.click(screen.getByLabelText('Incluir los coches parados'))
      expect(await screen.findByText('5678BCD')).toBeInTheDocument()
      // Las cifras de arriba no se mueven: hablan de la flota en servicio.
      const cifras = document.querySelectorAll('.stat-grid > *')
      expect(cifras[0].textContent).toContain('2 en la flota')
    })
  })

  it('el informe enseña sus hojas, pintadas como el Excel, y es lo que se descarga', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('1234KLM')
    await user.click(screen.getByRole('tab', { name: 'Informe' }))

    await waitFor(() => expect(mocks.fetchReportPreview).toHaveBeenCalledWith('hse', {}, expect.anything()))
    // Un chip por hoja; la primera, la portada con las cifras de la pantalla.
    expect(await screen.findByRole('button', { name: /Resumen/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Vehículos/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Kilometraje/ })).toBeInTheDocument()
    expect(screen.getByText('Los que ruedan hoy.')).toBeInTheDocument()
    // Una columna de fechas se pinta a la española, aunque viaje en ISO.
    expect(screen.getByText('7 oct 2026')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Vehículos/ }))
    expect(await screen.findByText('Fecha de inicio')).toBeInTheDocument()
    expect(screen.getByText('15 ene 2026')).toBeInTheDocument()
    // Las cifras, con separador de miles, como en el Excel.
    expect(screen.getByText('31.000')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Kilometraje/ }))
    expect(await screen.findByText('Estimada')).toBeInTheDocument()
    expect(screen.getByText('53.730')).toBeInTheDocument()
  })

  describe('la pestaña del informe se lee sin esfuerzo', () => {
    const abrirInforme = async (user: ReturnType<typeof userEvent.setup>) => {
      renderPage()
      await screen.findByText('1234KLM')
      await user.click(screen.getByRole('tab', { name: 'Informe' }))
      return screen.findByRole('button', { name: /Resumen/ })
    }

    it('la portada NO es una tabla: sin cabeceras ni paginador, con sus cifras y su pie', async () => {
      const user = userEvent.setup()
      await abrirInforme(user)

      // Lo que sobraba de pintarla con la tabla del DS.
      expect(screen.queryByRole('columnheader', { name: 'Indicador' })).not.toBeInTheDocument()
      expect(screen.queryByText('Filas por página')).not.toBeInTheDocument()

      // La cifra, con su indicador y su detalle.
      const portada = document.querySelector('.hse-cover') as HTMLElement
      expect(portada).toBeInTheDocument()
      expect(within(portada).getByText('Coches activos')).toBeInTheDocument()
      expect(within(portada).getByText('Los que ruedan hoy.')).toBeInTheDocument()
      // Y lo que no es cifra se va al pie, no a la rejilla.
      expect(within(portada).queryByText('Generado el')).not.toBeInTheDocument()
      const pie = document.querySelector('.hse-cover-foot') as HTMLElement
      expect(within(pie).getByText('7 oct 2026')).toBeInTheDocument()
    })

    it('la portada no lleva recuento en su chip; las hojas de datos sí', async () => {
      const user = userEvent.setup()
      const resumen = await abrirInforme(user)
      // «7 indicadores» no es un recuento de registros: no se enseña.
      expect(resumen.textContent).toBe('Resumen')
      expect(screen.getByRole('button', { name: /Kilometraje/ }).textContent).toContain('1')
    })

    it('cada hoja dice qué contiene, y la línea cambia al cambiar de hoja', async () => {
      const user = userEvent.setup()
      await abrirInforme(user)
      expect(screen.getByText(/La portada: las cifras de esta pantalla/)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /Kilometraje/ }))
      expect(await screen.findByText(/El histórico de lecturas de km/)).toBeInTheDocument()
      expect(screen.queryByText(/La portada: las cifras/)).not.toBeInTheDocument()
    })

    it('el aviso de que el CSV trae una sola hoja va junto a su botón', async () => {
      const user = userEvent.setup()
      await abrirInforme(user)
      const csv = screen.getByText(/Un CSV es una tabla plana/)
      expect(csv.textContent).toContain('«Vehículos»')
      expect(csv.textContent).toContain('1 filas')
      // Y en su fila está el botón que lo baja.
      const fila = csv.closest('.hse-download') as HTMLElement
      expect(within(fila).getByRole('button', { name: /Descargar/ })).toBeInTheDocument()
    })

    it('con la app en inglés, los chips se leen en inglés', async () => {
      // El idioma lo fija `LanguageProvider` al montar desde lo guardado, así
      // que tocar `document.lang` a secas no basta: lo pisa.
      localStorage.setItem('gs_base_lang', 'en')
      const user = userEvent.setup()
      renderPage()
      await screen.findByText('1234KLM')
      await user.click(screen.getByRole('tab', { name: 'Report' }))

      // El back titula las hojas en castellano: el rótulo sale de la copia.
      expect(await screen.findByRole('button', { name: /Summary/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Mileage/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Kilometraje/ })).not.toBeInTheDocument()
    })
  })

  it('no ofrece ninguna acción sobre las filas', async () => {
    renderPage()
    await screen.findByText('1234KLM')
    const acciones = /^(Resolver|Editar|Documentos|Acciones|Nueva incidencia|Nuevo vehículo|Mandar correo|Registrar ITV|Cambiar conductor)$/
    expect(screen.queryByRole('button', { name: acciones })).not.toBeInTheDocument()
    // Ni enlaces a la ficha del coche: la ficha tiene acciones.
    expect(screen.queryByRole('link', { name: '1234KLM' })).not.toBeInTheDocument()
  })

  describe('cada cifra abre su lista', () => {
    /** Con el callado dentro: 2 activos, 1 con lectura, 1 sin nada. */
    const renderConCallado = async () => {
      mocks.listVehicles.mockResolvedValue(page([ACTIVO, PARADO, CALLADO]))
      const vista = renderPage()
      await screen.findByText('1234KLM')
      return vista
    }

    const tarjeta = (container: HTMLElement, i: number) =>
      container.querySelectorAll('.stat-grid > *')[i] as HTMLElement

    it('«Coches activos» enseña los activos, y no el parado', async () => {
      const user = userEvent.setup()
      const { container } = await renderConCallado()
      await user.click(tarjeta(container, 0))

      const modal = await screen.findByRole('dialog')
      expect(within(modal).getByText(/Coches activos \(2\)/)).toBeInTheDocument()
      expect(within(modal).getByText('1234KLM')).toBeInTheDocument()
      expect(within(modal).getByText('9999QQQ')).toBeInTheDocument()
      expect(within(modal).queryByText('5678BCD')).not.toBeInTheDocument()
    })

    it('«Con lectura este mes» enseña los que FALTAN, no los que ya la dieron', async () => {
      const user = userEvent.setup()
      const { container } = await renderConCallado()
      await user.click(tarjeta(container, 1))

      const modal = await screen.findByRole('dialog')
      expect(within(modal).getByText(/Sin lectura de este mes \(1\)/)).toBeInTheDocument()
      expect(within(modal).getByText('9999QQQ')).toBeInTheDocument()
      expect(within(modal).queryByText('1234KLM')).not.toBeInTheDocument()
    })

    it('«Con consumo este mes» y «Sin leer hace +30 días» enseñan lo suyo', async () => {
      const user = userEvent.setup()
      const { container } = await renderConCallado()

      await user.click(tarjeta(container, 2))
      let modal = await screen.findByRole('dialog')
      expect(within(modal).getByText(/Sin consumo anotado este mes \(1\)/)).toBeInTheDocument()
      expect(within(modal).getByText('9999QQQ')).toBeInTheDocument()

      await user.click(within(modal).getByRole('button', { name: /cerrar/i }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      // Sin ninguna lectura cuenta como vencido: el callado entra aquí también.
      await user.click(tarjeta(container, 3))
      modal = await screen.findByRole('dialog')
      expect(within(modal).getByText('Sin anotar hace más de 30 días')).toBeInTheDocument()
      // La misma pregunta vale para las dos anotaciones: una pestaña cada una,
      // con su recuento. La de km va primera (es la que cuadra con la cifra).
      const pestañas = within(modal).getAllByRole('tab')
      expect(pestañas.map((b) => b.textContent)).toEqual(['Kilómetros (1)', 'Consumo (1)'])
      expect(pestañas[0]).toHaveAttribute('aria-selected', 'true')
      expect(within(modal).getByText('9999QQQ')).toBeInTheDocument()

      // Y la de consumo trae SU lista y sus columnas.
      await user.click(pestañas[1])
      const cabeceras = within(modal)
        .getAllByRole('columnheader')
        .map((th) => th.textContent ?? '')
      expect(cabeceras.join(' ')).toContain('Último consumo')
      expect(cabeceras.join(' ')).not.toContain('Kilómetros')
    })

    it('el modal responde a UNA pregunta: solo las columnas que la contestan', async () => {
      const user = userEvent.setup()
      const { container } = await renderConCallado()

      await user.click(tarjeta(container, 1))
      const modal = await screen.findByRole('dialog')
      const cabeceras = within(modal)
        .getAllByRole('columnheader')
        .map((th) => th.textContent ?? '')
      // Lo que contesta «¿quién no ha dado la lectura?»: el coche y sus km.
      expect(cabeceras.join(' ')).toContain('Última lectura')
      // Ni el estado (todos son activos: es el corte de la pantalla), ni las
      // fechas del contrato, ni el consumo, que es la otra pregunta.
      expect(cabeceras.join(' ')).not.toContain('Estado')
      expect(cabeceras.join(' ')).not.toContain('Fecha de inicio')
      expect(cabeceras.join(' ')).not.toContain('Fin previsto')
      expect(cabeceras.join(' ')).not.toContain('Consumo medio')
      // Y su cabecera de grupos se queda sin «Contrato», que ya no tiene nada.
      const grupos = within(modal).getAllByRole('row')[0]
      expect(within(grupos).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
        'Vehículo',
        'Kilometraje',
      ])
    })

    it('la búsqueda del modal es suya y no toca la de la pestaña', async () => {
      const user = userEvent.setup()
      const { container } = await renderConCallado()

      await user.type(screen.getByLabelText('Buscar'), 'peugeot')
      await waitFor(() => expect(screen.queryByText('1234KLM')).not.toBeInTheDocument())

      await user.click(tarjeta(container, 0))
      const modal = await screen.findByRole('dialog')
      // Entra en limpio: los dos activos, aunque la pestaña esté filtrada.
      expect(within(modal).getByText('1234KLM')).toBeInTheDocument()
      expect(within(modal).getByText('9999QQQ')).toBeInTheDocument()

      await user.click(within(modal).getByRole('button', { name: /cerrar/i }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      // Y al cerrarlo se vuelve a lo que se estaba mirando.
      expect(screen.getByLabelText('Buscar')).toHaveValue('peugeot')
    })

    it('no ofrece la lista mientras los vehículos están cargando', async () => {
      mocks.listVehicles.mockReturnValue(new Promise(() => {}))
      const { container } = renderPage()
      expect(tarjeta(container, 0).tagName).toBe('DIV')
    })
  })

  it('la búsqueda es de la pestaña: al cambiar se empieza en limpio', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('1234KLM')

    await user.type(screen.getByLabelText('Buscar'), 'renault')
    await waitFor(() => expect(screen.queryByText('1234KLM')).not.toBeInTheDocument())

    await user.click(screen.getByRole('tab', { name: 'Informe' }))
    await user.click(screen.getByRole('tab', { name: /Vehículos/ }))
    expect(screen.getByLabelText('Buscar')).toHaveValue('')
    expect(await screen.findByText('1234KLM')).toBeInTheDocument()
  })
})
