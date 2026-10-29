import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import { SharesPage } from './SharesPage.tsx'

const mocks = vi.hoisted(() => ({
  listMyShares: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listMyShares: mocks.listMyShares,
}))

function pintar() {
  render(
    <LanguageProvider>
      <MemoryRouter>
        <SharesPage />
      </MemoryRouter>
    </LanguageProvider>,
  )
}

describe('SharesPage: los coches de reparto, cuándo y con quién', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
  })

  it('cada coche con la tarjeta de la flota: días, franja, parte, periodo y con quién', async () => {
    mocks.listMyShares.mockResolvedValue([
      {
        id: 1,
        vehicle: { id: 1, plate: '1234KLM', brand: 'Seat', model: 'Leon', state: 'active', state_display: 'Activo' },
        usage_percent: 60,
        start_date: '2026-03-01',
        end_date: null,
        weekdays: [1, 2, 3, 4, 5],
        time_from: '08:00',
        time_to: '15:00',
        is_driver: true,
        shared_with: [
          {
            id: 5,
            name: 'Lucía Pérez',
            usage_percent: 40,
            weekdays: [6, 7],
            time_from: null,
            time_to: null,
          },
        ],
      },
      {
        id: 2,
        vehicle: { id: 2, plate: '5678BCD', brand: 'Nissan', model: 'Leaf', state: 'maintenance', state_display: 'No activo - Mantenimiento' },
        usage_percent: 30,
        start_date: '2026-09-01',
        end_date: '2026-12-31',
        weekdays: [],
        time_from: null,
        time_to: null,
        is_driver: false,
        shared_with: [],
      },
    ])
    pintar()
    expect(await screen.findByText('1234KLM')).toBeInTheDocument()
    const tarjetas = Array.from(document.querySelectorAll<HTMLElement>('.share-card'))
    expect(tarjetas).toHaveLength(2)

    // La misma tarjeta que la flota, y el propio marcado igual que allí.
    expect(tarjetas[0].querySelector('.vehicle-card .vehicle-meta')).not.toBeNull()
    // Y la tarjeta ENTERA lleva a la ficha, también como en «Flota»: un
    // reparto vigente mete ese coche en el ámbito de quien lo tiene.
    expect(tarjetas[0].closest('a')).toHaveAttribute('href', '/vehiculos/1')
    expect(tarjetas[1].closest('a')).toHaveAttribute('href', '/vehiculos/2')
    expect(tarjetas[0]).toHaveClass('card-own')
    expect(tarjetas[0]).toHaveTextContent('Tu coche')
    // Cuándo le toca: los días contraídos y la franja.
    expect(tarjetas[0]).toHaveTextContent('DíasL–V')
    expect(tarjetas[0]).toHaveTextContent('Horario08:00–15:00')
    expect(tarjetas[0]).toHaveTextContent('Tu parte60 %')
    expect(tarjetas[0]).toHaveTextContent('desde 1/3/2026')
    // Con quién, y cuándo lo usa esa persona: es lo que dice cuándo está libre.
    expect(tarjetas[0]).toHaveTextContent('Lucía Pérez')
    expect(tarjetas[0]).toHaveTextContent('40 % · S, D · A cualquier hora')

    // Sin días ni franja se dice que es siempre; sin nadie más, también.
    expect(tarjetas[1]).not.toHaveClass('card-own')
    expect(tarjetas[1]).toHaveTextContent('DíasTodos los días')
    expect(tarjetas[1]).toHaveTextContent('HorarioA cualquier hora')
    expect(tarjetas[1]).toHaveTextContent('Nadie más: lo usas tú entero')
    expect(tarjetas[1]).toHaveTextContent('hasta 31/12/2026')
    expect(tarjetas[1]).toHaveTextContent('Mantenimiento')
  })

  it('sin repartos, lo dice', async () => {
    mocks.listMyShares.mockResolvedValue([])
    pintar()
    expect(await screen.findByText(/No tienes ningún coche en reparto/)).toBeInTheDocument()
  })

  it('si no carga, lo dice', async () => {
    mocks.listMyShares.mockRejectedValue(new Error('red'))
    pintar()
    expect(await screen.findByRole('alert')).toHaveTextContent('red')
  })
})
