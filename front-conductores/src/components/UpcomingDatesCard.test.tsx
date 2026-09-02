import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { SOON_DAYS, todayIso } from '../format.ts'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'
import { UpcomingDatesCard } from './UpcomingDatesCard.tsx'

const VEHICLE = { id: 3, plate: '7890NPQ', next_itv_date: null } as Vehicle

/** Fecha ISO a N días de hoy, con partes LOCALES (doctrina E2/E6). */
function inDays(days: number): string {
  const date = new Date(`${todayIso()}T00:00:00`)
  date.setDate(date.getDate() + days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function renderCard(summary: Partial<VehicleSummary>) {
  render(
    <LanguageProvider>
      <UpcomingDatesCard
        vehicle={VEHICLE}
        summary={{ vehicle: 3, ...summary } as VehicleSummary}
        window={null}
      />
    </LanguageProvider>,
  )
}

describe('UpcomingDatesCard: solo las citas PRÓXIMAS de verdad', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
  })

  it('dentro del horizonte, cada cita con su fecha y los días que faltan', () => {
    renderCard({ next_itv_date: inDays(12), next_maintenance_date: inDays(14) })

    expect(screen.getByText('Próx. ITV')).toBeInTheDocument()
    expect(screen.getByText(/· en 12 días/)).toBeInTheDocument()
    expect(screen.getByText('Próx. mantenimiento')).toBeInTheDocument()
    expect(screen.getByText(/· en 14 días/)).toBeInTheDocument()
  })

  it('recién registradas (ciclo reanclado a un año) la tarjeta no las anuncia', () => {
    renderCard({ next_itv_date: inDays(365), next_maintenance_date: inDays(365) })

    // Nada que hacer aún: sin citas no se pinta ni la tarjeta.
    expect(screen.queryByText('Próximas citas')).not.toBeInTheDocument()
    expect(screen.queryByText('Próx. ITV')).not.toBeInTheDocument()
    expect(screen.queryByText('Próx. mantenimiento')).not.toBeInTheDocument()
  })

  it('el borde del horizonte entra; un día más, fuera', () => {
    renderCard({ next_itv_date: inDays(SOON_DAYS) })
    expect(screen.getByText('Próx. ITV')).toBeInTheDocument()

    document.body.innerHTML = ''
    renderCard({ next_itv_date: inDays(SOON_DAYS + 1) })
    expect(screen.queryByText('Próx. ITV')).not.toBeInTheDocument()
  })

  it('lo vencido NO se esconde nunca', () => {
    renderCard({ next_maintenance_date: inDays(-3) })

    expect(screen.getByText('Próx. mantenimiento')).toBeInTheDocument()
    expect(screen.getByText(/venció hace 3 días/)).toBeInTheDocument()
  })
})
