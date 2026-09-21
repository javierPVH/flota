import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// RTL solo auto-limpia con `globals: true`; aquí se hace explícito.
afterEach(() => {
  cleanup()
  // Lo que se recuerda «por sesión» (el aviso de responsabilidad, por ejemplo)
  // no puede cruzar de un caso al siguiente: un test que lo cierra dejaría al
  // de abajo sin él.
  try {
    sessionStorage.clear()
  } catch {
    /* sin almacenamiento: nada que limpiar */
  }
})
