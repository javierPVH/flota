import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FieldDeadlines } from './FieldDeadlines.tsx'
import { LanguageProvider } from '../i18n.tsx'
import { todayIso } from '../format.ts'
import type { KmWindow } from '../api.ts'
import type { Vehicle, VehicleSummary } from '../types.ts'

// Los avisos abren sus formularios, y esos van dentro de «SupervisorModal»,
// que pregunta quién eres para decidir si avisa de que actúas en nombre de
// otro. Sin sesión no se puede ni montar.
vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'x', roles: ['driver'] } }),
}))

/** Fecha a N días de hoy, en LOCAL (igual que `daysUntil`): con UTC el test
 * saldría desplazado un día según la hora a la que se ejecute. */
function isoIn(days: number): string {
  const date = new Date(`${todayIso()}T00:00:00`)
  date.setDate(date.getDate() + days)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function vehicle(id: number, plate: string, itv: string | null = null): Vehicle {
  return { id, plate, brand: 'Mercedes', model: 'Sprinter', next_itv_date: itv } as Vehicle
}

function summary(id: number, over: Partial<VehicleSummary> = {}): VehicleSummary {
  return {
    vehicle: id,
    km_current: 31000,
    // Lectura de un mes viejo → cuenta como pendiente (HU-3.2).
    km_reading_date: '2020-01-02',
    next_itv_date: null,
    next_maintenance_date: null,
    // GAP-2: anotado HOY salvo que el caso diga otra cosa — sin fecha, el
    // combustible avisa en rojo («sin ninguna anotación») y ensuciaría todos
    // los demás casos.
    fuel_avg_date: todayIso(),
    unlimited_km: false,
    blocked_by_link: null,
    ...over,
  } as VehicleSummary
}

/** Al día de km: no dispara el aviso de lectura. */
const upToDate = { km_reading_date: todayIso() }

/** Ventana ABIERTA a `left` días de que cierre (el back manda su propio "today"). */
function windowOpen(left: number): KmWindow {
  const day = 20
  return {
    open: true,
    enabled: true,
    start_day: 20,
    last_day: day + left,
    today: `2026-08-${String(day).padStart(2, '0')}`,
    admin_exempt: false,
  }
}

/** Ventana CERRADA, a `toOpen` días de abrirse. */
function windowClosed(toOpen: number): KmWindow {
  return {
    open: false,
    enabled: true,
    start_day: 20,
    last_day: 31,
    today: `2026-08-${String(20 - toOpen).padStart(2, '0')}`,
    admin_exempt: false,
  }
}

function renderDeadlines(
  vehicles: Vehicle[],
  summaries: Record<number, VehicleSummary>,
  kmWindow: KmWindow | null,
) {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <FieldDeadlines vehicles={vehicles} summaries={summaries} window={kmWindow} />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('FieldDeadlines — acordeón de avisos (C2)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
  })

  it('sin nada urgente no pinta nada', () => {
    const { container } = renderDeadlines(
      [vehicle(1, '1234KLM', isoIn(90))],
      { 1: summary(1, upToDate) },
      windowOpen(11),
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('resume cuántos avisos hay en la cabecera', () => {
    renderDeadlines(
      [vehicle(1, '1234KLM', isoIn(12)), vehicle(2, '5678BCD', isoIn(20))],
      { 1: summary(1, upToDate), 2: summary(2, upToDate) },
      null,
    )
    expect(screen.getByText('Te queda poco')).toBeInTheDocument()
    expect(screen.getByText('2 avisos')).toBeInTheDocument()
  })

  it('arranca PLEGADO si no hay nada crítico, y se despliega al pulsar', async () => {
    renderDeadlines([vehicle(1, '1234KLM', isoIn(20))], { 1: summary(1, upToDate) }, null)
    const head = screen.getByRole('button')
    expect(head).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(head)
    expect(head).toHaveAttribute('aria-expanded', 'true')
  })

  it('arranca ABIERTO si hay algo crítico (no se esconde tras un toque)', () => {
    renderDeadlines([vehicle(1, '1234KLM', isoIn(-3))], { 1: summary(1, upToDate) }, null)
    expect(screen.getByRole('button', { name: /Te queda poco/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  // --- Km ---------------------------------------------------------------
  it('ventana abierta y lectura pendiente: cuenta los días que quedan', async () => {
    // Con la lectura pendiente desde 2020 el aviso nace ROJO y, por tanto,
    // desplegado: el plazo se comprueba con una lectura reciente del mes
    // anterior… que no se puede fabricar sin saber qué día es hoy. Así que se
    // mira el detalle entero, que es una línea con dos trozos.
    const { container } = renderDeadlines([vehicle(1, '1234KLM')], { 1: summary(1) }, windowOpen(3))
    expect(screen.getByText('Kilómetros de 1234KLM')).toBeInTheDocument()
    expect(screen.getByText('quedan 3 días')).toBeInTheDocument()
    expect(container.querySelector('.deadline-detail')?.textContent).toContain('hasta el día 23')

    const cabecera = screen.getByRole('button', { name: /Te queda poco/ })
    await userEvent.click(cabecera) // plegar
    expect(screen.queryByRole('button', { name: /Kilómetros de 1234KLM/ })).not.toBeInTheDocument()
    await userEvent.click(cabecera) // y desplegar

    // Pulsar el aviso abre el formulario de SIEMPRE, y aquí mismo: antes
    // era un enlace que sacaba de la pantalla y volver era cosa de uno.
    await userEvent.click(screen.getByRole('button', { name: /Kilómetros de 1234KLM/ }))
    expect(await screen.findByRole('dialog', { name: /1234KLM/ })).toBeInTheDocument()
  })

  it('el último día avisa en rojo', () => {
    const { container } = renderDeadlines([vehicle(1, '1234KLM')], { 1: summary(1) }, windowOpen(0))
    expect(screen.getByText('hoy es el último día')).toBeInTheDocument()
    expect(container.querySelector('.deadline-danger')).not.toBeNull()
  })

  it('antes de la ventana lo dice como CONSEJO, no como puerta cerrada', () => {
    // Es lo que se lee a principios de mes: la lectura todavía no toca, así que
    // el aviso recomienda cuándo darla en vez de contar para cuándo «se abre».
    const { container } = renderDeadlines([vehicle(1, '1234KLM')], { 1: summary(1) }, windowClosed(2))
    expect(screen.getByText('recomendable del 20 a fin de mes')).toBeInTheDocument()
    expect(container.querySelector('.deadline-detail')?.textContent).toContain(
      'el mes acaba en 13 días', // día 18 de un mes de 31
    )
  })

  it('con la ventana lejos el aviso SALE igual: la lectura sigue faltando', () => {
    // Antes callaba hasta 3 días antes de abrir, así que del 1 al 17 no había
    // aviso aunque el odómetro llevara meses sin leerse.
    renderDeadlines([vehicle(1, '1234KLM')], { 1: summary(1) }, windowClosed(9))
    expect(screen.getByText('Kilómetros de 1234KLM')).toBeInTheDocument()
    expect(screen.getByText('recomendable del 20 a fin de mes')).toBeInTheDocument()
  })

  it('la lectura vieja manda sobre el plazo: en rojo aunque la ventana no haya abierto', () => {
    const { container } = renderDeadlines(
      [vehicle(1, '1234KLM')],
      { 1: summary(1, { km_reading_date: isoIn(-40) }) },
      windowClosed(9),
    )
    expect(screen.getByText('última hace 40 días')).toHaveClass('itv-overdue')
    expect(container.querySelector('.deadline-danger')).not.toBeNull()
  })

  it('sin ninguna lectura, también en rojo', () => {
    renderDeadlines(
      [vehicle(1, '1234KLM')],
      { 1: summary(1, { km_reading_date: null }) },
      windowClosed(9),
    )
    expect(screen.getByText('sin ninguna lectura')).toHaveClass('itv-overdue')
  })

  it('sin ventana (N8a apagada) dice el mes que falta, sin plazo', () => {
    renderDeadlines([vehicle(1, '1234KLM')], { 1: summary(1) }, null)
    expect(screen.getByText(/falta la lectura de/)).toBeInTheDocument()
  })

  it('km ILIMITADOS: nunca se le piden lecturas (X2)', () => {
    const { container } = renderDeadlines(
      [vehicle(1, '1234KLM')],
      { 1: summary(1, { unlimited_km: true }) },
      windowOpen(1),
    )
    expect(screen.queryByText('Kilómetros de 1234KLM')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('el principal bloqueado por sustitución no reclama km (N9)', () => {
    renderDeadlines(
      [vehicle(1, '1234KLM')],
      {
        1: summary(1, {
          blocked_by_link: { substitute_id: 2, plate: '9999ZZZ', reason: 'taller', since: '2026-08-01' },
        }),
      },
      windowOpen(2),
    )
    expect(screen.queryByText('Kilómetros de 1234KLM')).not.toBeInTheDocument()
  })

  // --- Combustible (GAP-2) ----------------------------------------------
  it('el combustible avisa por ANTIGÜEDAD: ámbar a los 15 días, rojo pasados 30', () => {
    const ambar = renderDeadlines(
      [vehicle(1, '1234KLM')],
      { 1: summary(1, { ...upToDate, fuel_avg_date: isoIn(-20) }) },
      null,
    )
    expect(screen.getByText('sin anotar desde hace 20 días')).toBeInTheDocument()
    expect(ambar.container.querySelector('.deadline-warning')).not.toBeNull()
    ambar.unmount()

    const rojo = renderDeadlines(
      [vehicle(1, '1234KLM')],
      { 1: summary(1, { ...upToDate, fuel_avg_date: isoIn(-40) }) },
      null,
    )
    expect(rojo.container.querySelector('.deadline-danger')).not.toBeNull()
  })

  it('anotado hace poco: del combustible no se dice nada', () => {
    const { container } = renderDeadlines(
      [vehicle(1, '1234KLM')],
      { 1: summary(1, { ...upToDate, fuel_avg_date: isoIn(-3) }) },
      null,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('sin ninguna anotación es rojo, y el aviso dice que se anota por viaje', async () => {
    renderDeadlines(
      [vehicle(1, '1234KLM')],
      { 1: summary(1, { ...upToDate, fuel_avg_date: null }) },
      null,
    )
    expect(screen.getByText('sin ninguna anotación')).toBeInTheDocument()
    expect(screen.getByText(/se anota en cada viaje/)).toBeInTheDocument()
    // Rojo → el acordeón nace abierto, así que el aviso se puede pulsar ya.
    // Su formulario no tenía página propia y por eso antes había que ir a la
    // ficha con un query; ahora se abre donde se lee el aviso.
    await userEvent.click(screen.getByRole('button', { name: /Combustible de 1234KLM/ }))
    expect(await screen.findByRole('dialog', { name: /1234KLM/ })).toBeInTheDocument()
  })

  // --- Mantenimiento programado (GAP-8) ----------------------------------
  it('el mantenimiento sale a ≤30 días y no antes', () => {
    const lejos = renderDeadlines(
      [vehicle(1, '1234KLM')],
      { 1: summary(1, { ...upToDate, next_maintenance_date: isoIn(40) }) },
      null,
    )
    expect(screen.queryByText(/Mantenimiento de/)).not.toBeInTheDocument()
    lejos.unmount()

    renderDeadlines(
      [vehicle(1, '1234KLM')],
      { 1: summary(1, { ...upToDate, next_maintenance_date: isoIn(10) }) },
      null,
    )
    expect(screen.getByText('Mantenimiento de 1234KLM')).toBeInTheDocument()
    expect(screen.getByText('en 10 días')).toBeInTheDocument()
  })

  it('el mantenimiento vencido se cuenta hacia atrás y en rojo', () => {
    const { container } = renderDeadlines(
      [vehicle(1, '1234KLM')],
      { 1: summary(1, { ...upToDate, next_maintenance_date: isoIn(-15) }) },
      null,
    )
    expect(screen.getByText('venció hace 15 días')).toBeInTheDocument()
    expect(container.querySelector('.deadline-danger')).not.toBeNull()
  })

  // --- ITV --------------------------------------------------------------
  it('la ITV sale a ≤30 días y no antes', () => {
    renderDeadlines([vehicle(1, '1234KLM', isoIn(40))], { 1: summary(1, upToDate) }, null)
    expect(screen.queryByText(/ITV de/)).not.toBeInTheDocument()

    renderDeadlines([vehicle(2, '5678BCD', isoIn(12))], { 2: summary(2, upToDate) }, null)
    expect(screen.getByText('ITV de 5678BCD')).toBeInTheDocument()
    expect(screen.getByText('en 12 días')).toBeInTheDocument()
  })

  it('la ITV vencida se cuenta hacia atrás y en rojo', () => {
    const { container } = renderDeadlines(
      [vehicle(1, '1234KLM', isoIn(-3))],
      { 1: summary(1, upToDate) },
      null,
    )
    expect(screen.getByText('venció hace 3 días')).toBeInTheDocument()
    expect(container.querySelector('.deadline-danger')).not.toBeNull()
  })

  // --- Seguro -----------------------------------------------------------
  it('del SEGURO no dice nada, aunque el back mande la fecha (X1)', () => {
    // El endpoint lo comparte gestión, así que el campo puede seguir llegando:
    // la app de campo debe ignorarlo pase lo que pase.
    const withInsurance = {
      ...summary(1, upToDate),
      insurance_expiry_date: isoIn(3),
    } as unknown as VehicleSummary
    const { container } = renderDeadlines([vehicle(1, '1234KLM')], { 1: withInsurance }, null)
    expect(screen.queryByText(/[Ss]eguro/)).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('ordena de lo más urgente a lo menos', () => {
    const { container } = renderDeadlines(
      [vehicle(1, '1234KLM', isoIn(20)), vehicle(2, '5678BCD', isoIn(2))],
      { 1: summary(1, upToDate), 2: summary(2, upToDate) },
      null,
    )
    const labels = [...container.querySelectorAll('.deadline-label')].map((el) => el.textContent)
    expect(labels).toEqual(['ITV de 5678BCD', 'ITV de 1234KLM'])
  })

  it('manda la GRAVEDAD: lo rojo va arriba aunque no tenga plazo', () => {
    // El combustible no cuenta días hasta nada, así que ordenar solo por plazo
    // lo dejaba debajo de una ITV a 20 días que corre menos prisa.
    const { container } = renderDeadlines(
      [vehicle(1, '1234KLM', isoIn(20))],
      { 1: summary(1, { ...upToDate, fuel_avg_date: isoIn(-40) }) },
      null,
    )
    const labels = [...container.querySelectorAll('.deadline-label')].map((el) => el.textContent)
    expect(labels).toEqual(['Combustible de 1234KLM', 'ITV de 1234KLM'])
  })
})
