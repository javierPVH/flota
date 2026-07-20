import { createAuth } from '@/auth'

export interface DemoUser {
  name: string
}

export const { AuthProvider, useAuth } = createAuth<DemoUser>()

/** Bootstrap de DEMO: simula validar sesión y devuelve un usuario tras un tick. */
export function demoBootstrap(): Promise<DemoUser | null> {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ name: 'Ada Lovelace' }), 500)
  })
}
