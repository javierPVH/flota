import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { todayIso } from '../format.ts'
import { LanguageProvider } from '../i18n.tsx'
import type { Role, Vehicle } from '../types.ts'
import { RegisterItvModal } from './RegisterItvModal.tsx'

const mocks = vi.hoisted(() => ({
  registerItv: vi.fn(),
  roles: ['driver'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  registerItv: mocks.registerItv,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'carlos', roles: mocks.roles } }),
}))

const VEHICLE = {
  id: 3,
  plate: '7890NPQ',
  brand: 'Tesla',
  model: 'Model 3',
  state: 'active',
  state_display: 'Activo',
} as Vehicle

function renderModal(nextItvDate?: string | null) {
  const onSaved = vi.fn()
  render(
    <LanguageProvider>
      <RegisterItvModal
        vehicle={VEHICLE}
        nextItvDate={nextItvDate}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    </LanguageProvider>,
  )
  return onSaved
}

/** Fecha ISO a N días de hoy — para afirmar el «· en N días» del aviso.
 * Se compone con las partes LOCALES: `toISOString()` pasa a UTC y en España
 * devolvía el día anterior (misma doctrina E2/E6 que `todayIso`). */
function inDays(days: number): string {
  const date = new Date(`${todayIso()}T00:00:00`)
  date.setDate(date.getDate() + days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

describe('RegisterItvModal: la próxima ITV es opcional', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.registerItv.mockResolvedValue({ id: 1 })
  })

  it('dice de qué cita es el registro y que la fecha no ata', () => {
    renderModal(inDays(12))

    const notice = document.querySelector('.itv-notice') as HTMLElement
    expect(notice).toHaveTextContent(/Próx\. ITV .+ · en 12 días/)
    expect(notice).toHaveTextContent('Se puede registrar antes o después de esa fecha.')
    expect(notice).toHaveTextContent('los avisos de ITV del vehículo se cierran automáticamente')
  })

  it('con resultado desfavorable el aviso no promete el cierre', async () => {
    renderModal(inDays(12))

    await userEvent.selectOptions(screen.getByLabelText('Resultado'), 'not done')
    const notice = document.querySelector('.itv-notice') as HTMLElement
    expect(notice).toHaveTextContent('Una ITV desfavorable no cierra los avisos')
    expect(notice).not.toHaveTextContent('se cierran automáticamente')
  })

  it('con la cita vencida lo dice en pasado (y sin cita, no la inventa)', () => {
    const { unmount } = render(
      <LanguageProvider>
        <RegisterItvModal vehicle={VEHICLE} nextItvDate={inDays(-3)} onClose={vi.fn()} />
      </LanguageProvider>,
    )
    expect(document.querySelector('.itv-notice')).toHaveTextContent(/venció hace 3 días/)
    unmount()

    renderModal(null)
    const notice = document.querySelector('.itv-notice') as HTMLElement
    expect(notice).not.toHaveTextContent('Próx. ITV')
    expect(notice).not.toHaveTextContent('esa fecha')
  })

  it('favorable SIN próxima fecha se registra (la fecha del informe puede venir después)', async () => {
    const onSaved = renderModal()

    await userEvent.click(screen.getByRole('button', { name: 'Registrar ITV' }))

    await waitFor(() =>
      expect(mocks.registerItv).toHaveBeenCalledWith({
        vehicle: 3,
        event_date: todayIso(),
        itv: { result: 'done', next_due: null },
      }),
    )
    expect(onSaved).toHaveBeenCalled()
  })

  it('con próxima fecha, se envía tal cual', async () => {
    renderModal()

    fireEvent.change(screen.getByLabelText('Próxima ITV (opcional)'), {
      target: { value: '2027-09-01' },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Registrar ITV' }))

    await waitFor(() =>
      expect(mocks.registerItv).toHaveBeenCalledWith({
        vehicle: 3,
        event_date: todayIso(),
        itv: { result: 'done', next_due: '2027-09-01' },
      }),
    )
  })
})
