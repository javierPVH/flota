import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import {
  IDLE_MS,
  absoluteRemainingMs,
  clearLoginMark,
  markLogin,
} from './sessionTimeout.ts'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export interface AuthContextValue<U> {
  user: U | null
  status: AuthStatus
  /** Fija el usuario tras un login manual (p. ej. callback SAML). */
  setUser: (user: U | null) => void
  logout: () => void
}

export interface AuthProviderProps<U> {
  /**
   * Carga inicial de sesión: la app decide CÓMO (cookie+/me, token, dev-login…)
   * y devuelve el usuario o `null` si es anónimo. Cualquier error se trata como
   * anónimo.
   */
  bootstrap: () => Promise<U | null>
  /** Efecto de cierre de sesión en el backend/cliente (borrar token, /logout…). */
  onLogout?: () => void | Promise<void>
  /** Qué hacer al caducar la sesión (idle o tope absoluto). Por defecto redirige. */
  onExpire?: () => void
  children: ReactNode
}

function defaultExpire(): void {
  if (typeof window !== 'undefined') window.location.assign('/login?expired=1')
}

/**
 * Fábrica de autenticación desacoplada del backend. Aporta la maquinaria
 * reutilizable (bootstrap de sesión, caducidad idle + tope absoluto en cliente,
 * guard de rutas) e inyecta por props el "cómo" específico de cada app.
 *
 * Uso en la app:
 *   export const { AuthProvider, useAuth, RequireAuth } = createAuth<User>()
 */
export function createAuth<U>() {
  const AuthContext = createContext<AuthContextValue<U> | null>(null)

  function AuthProvider({ bootstrap, onLogout, onExpire, children }: AuthProviderProps<U>) {
    const [user, setUserState] = useState<U | null>(null)
    const [status, setStatus] = useState<AuthStatus>('loading')

    useEffect(() => {
      let mounted = true
      async function run() {
        try {
          const loaded = await bootstrap()
          if (!mounted) return
          if (loaded) {
            markLogin()
            setUserState(loaded)
            setStatus('authenticated')
          } else {
            setStatus('anonymous')
          }
        } catch {
          if (mounted) setStatus('anonymous')
        }
      }
      void run()
      return () => {
        mounted = false
      }
    }, [bootstrap])

    const logout = useCallback(() => {
      void onLogout?.()
      clearLoginMark()
      setUserState(null)
      setStatus('anonymous')
    }, [onLogout])

    const setUser = useCallback((next: U | null) => {
      if (next) markLogin()
      setUserState(next)
      setStatus(next ? 'authenticated' : 'anonymous')
    }, [])

    // Caducidad en cliente: cierra sesión tras IDLE_MS de inactividad o al
    // alcanzar el tope absoluto (el backend lo impone de verdad; esto es UX).
    useEffect(() => {
      if (status !== 'authenticated' || typeof window === 'undefined') return
      const expire = () => {
        void onLogout?.()
        clearLoginMark()
        setUserState(null)
        setStatus('anonymous')
        ;(onExpire ?? defaultExpire)()
      }
      let idleTimer = 0
      const resetIdle = () => {
        window.clearTimeout(idleTimer)
        idleTimer = window.setTimeout(expire, IDLE_MS)
      }
      const remaining = absoluteRemainingMs()
      if (remaining <= 0) {
        expire()
        return
      }
      const absTimer = window.setTimeout(expire, remaining)
      const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'scroll']
      events.forEach((e) => window.addEventListener(e, resetIdle, { passive: true }))
      resetIdle()
      return () => {
        window.clearTimeout(idleTimer)
        window.clearTimeout(absTimer)
        events.forEach((e) => window.removeEventListener(e, resetIdle))
      }
    }, [status, onLogout, onExpire])

    const value = useMemo<AuthContextValue<U>>(
      () => ({ user, status, setUser, logout }),
      [user, status, setUser, logout],
    )

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  }

  function useAuth(): AuthContextValue<U> {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
    return ctx
  }

  /** Gate que solo renderiza children para un usuario autenticado. */
  function RequireAuth({
    children,
    loginPath = '/login',
    loadingFallback,
  }: {
    children: ReactNode
    loginPath?: string
    loadingFallback?: ReactNode
  }) {
    const { status } = useAuth()
    const location = useLocation()

    if (status === 'loading') {
      return (
        <>
          {loadingFallback ?? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#5f748c' }}>Cargando...</div>
          )}
        </>
      )
    }

    if (status === 'anonymous') {
      return <Navigate to={loginPath} replace state={{ from: location }} />
    }

    return <>{children}</>
  }

  return { AuthProvider, useAuth, RequireAuth }
}
