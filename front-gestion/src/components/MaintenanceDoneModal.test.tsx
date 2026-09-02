import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MaintenanceDoneModal } from './MaintenanceDoneModal.tsx'
import { todayIso } from '../format.ts'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  maintenancePlanDone: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  maintenancePlanDone: mocks.maintenancePlanDone,
}))

describe('MaintenanceDoneModal (registrar servicio desde el desglose)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.maintenancePlanDone.mockReset()
  })

  it('registra el servicio con fecha, km, coste y nota', async () => {
    mocks.maintenancePlanDone.mockResolvedValue({})
    const onSaved = vi.fn()
    render(
      <LanguageProvider>
        <MaintenanceDoneModal
          open
          plate="1234KLM"
          planId={4}
          planName="Revisión general"
          onClose={vi.fn()}
          onSaved={onSaved}
        />
      </LanguageProvider>,
    )

    // El plan que se reancla queda a la vista; la fecha llega puesta a hoy.
    expect(screen.getByText('Revisión general')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Kilometraje (opcional)' }), '45000')
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Coste (€, opcional)' }), '120.5')
    await userEvent.type(screen.getByRole('textbox', { name: 'Nota (opcional)' }), 'Aceite y filtros')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar servicio' }))

    expect(mocks.maintenancePlanDone).toHaveBeenCalledWith(4, {
      date: todayIso(),
      km: 45000,
      cost: '120.5',
      note: 'Aceite y filtros',
    })
    expect(onSaved).toHaveBeenCalled()
  })
})
