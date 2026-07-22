import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// RTL solo auto-limpia con `globals: true`; aquí se hace explícito.
afterEach(cleanup)
