import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { FieldDeadlines } from './FieldDeadlines.tsx'
import { LanguageProvider } from '../i18n.tsx'
import { todayIso } from '../format.ts'
import type { KmWindow } from '../api.ts'
import type { Vehicle, VehicleSummary } from '../types.ts'

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
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  })

  // --- Km ---------------------------------------------------------------
  it('ventana abierta y lectura pendiente: cuenta los días que quedan', async () => {
    renderDeadlines([vehicle(1, '1234KLM')], { 1: summary(1) }, windowOpen(3))
    expect(screen.getByText('Registrar kilómetros')).toBeInTheDocument()
    expect(screen.getByText('quedan 3 días')).toBeInTheDocument()
    expect(screen.getByText('hasta el día 23')).toBeInTheDocument()

    // Plegado, el panel está `hidden`: el enlace NO cuenta como accesible
    // (es justo lo que queremos — no se navega a lo que no se ve).
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('link', { name: /Registrar kilómetros/ })).toHaveAttribute(
      'href',
      '/registrar',
    )
  })

  it('el último día avisa en rojo', () => {
    const { container } = renderDeadlines([vehicle(1, '1234KLM')], { 1: summary(1) }, windowOpen(0))
    expect(screen.getByText('hoy es el último día')).toBeInTheDocument()
    expect(container.querySelector('.deadline-danger')).not.toBeNull()
  })

  it('ventana cerrada pero a punto de abrir: avisa de cuándo se abre', () => {
    const { container } = renderDeadlines(
      [vehicle(1, '1234KLM')],
      { 1: summary(1) },
      windowClosed(2),
    )
    expect(screen.getByText('se abre en 2 días (día 20)')).toBeInTheDocument()
    expect(container.querySelector('.deadline-info')).not.toBeNull()
  })

  it('ventana cerrada y aún lejos: ningún aviso de km', () => {
    renderDeadlines([vehicle(1, '1234KLM')], { 1: summary(1) }, windowClosed(9))
    expect(screen.queryByText('Registrar kilómetros')).not.toBeInTheDocument()
  })

  it('km ILIMITADOS: nunca se le piden lecturas (X2)', () => {
    const { container } = renderDeadlines(
      [vehicle(1, '1234KLM')],
      { 1: summary(1, { unlimited_km: true }) },
      windowOpen(1),
    )
    expect(screen.queryByText('Registrar kilómetros')).not.toBeInTheDocument()
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
    expect(screen.queryByText('Registrar kilómetros')).not.toBeInTheDocument()
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
})
