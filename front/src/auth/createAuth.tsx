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
import { setAuthExpirationHandler } from '../http/http-client.ts'
import { useUiCopy } from '../ui/copy.ts'
import {
  IDLE_MS,
  absoluteRemainingMs,
  clearLoginMark,
  markLogin,
} from './sessionTimeout.ts'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

/** Por qué se cierra la sesión: la persona lo pide, o caduca (idle/tope/403). */
export type LogoutReason = 'manual' | 'expired'

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
  /** Efecto de cierre de sesión en el backend/cliente (borrar token, /logout…).
   * Recibe el motivo (R5-55): una PWA puede conservar su caché de arranque
   * offline cuando la sesión solo ha CADUCADO. */
  onLogout?: (reason: LogoutReason) => void | Promise<void>
  /** Qué hacer al caducar la sesión (idle, tope absoluto o 403 del transporte).
   * Por defecto, nada más: `RequireAuth` lleva al login por el router con
   * `?expired=1`, sin recargar la página (R5-25). */
  onExpire?: () => void
  /** Inactividad tras la que caduca la sesión en cliente (por defecto `IDLE_MS`). */
  idleMs?: number
  children: ReactNode
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
  // Fuera del contexto de valor para no re-renderizar a todos los consumidores
  // por un flag que solo lee `RequireAuth`.
  const ExpiredContext = createContext(false)

  function AuthProvider({
    bootstrap,
    onLogout,
    onExpire,
    idleMs = IDLE_MS,
    children,
  }: AuthProviderProps<U>) {
    const [user, setUserState] = useState<U | null>(null)
    const [status, setStatus] = useState<AuthStatus>('loading')
    const [expired, setExpired] = useState(false)

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
      void onLogout?.('manual')
      clearLoginMark()
      setExpired(false)
      setUserState(null)
      setStatus('anonymous')
    }, [onLogout])

    const setUser = useCallback((next: U | null) => {
      if (next) markLogin()
      setExpired(false)
      setUserState(next)
      setStatus(next ? 'authenticated' : 'anonymous')
    }, [])

    // Caducidad en cliente: cierra sesión tras `idleMs` de inactividad, al
    // alcanzar el tope absoluto (el backend lo impone de verdad; esto es UX) o
    // cuando el transporte recibe un «no autenticado» (R5-25: antes eso era una
    // navegación DURA a /login que perdía lo escrito en el formulario).
    useEffect(() => {
      if (status !== 'authenticated' || typeof window === 'undefined') return
      const expire = () => {
        void onLogout?.('expired')
        clearLoginMark()
        setExpired(true)
        setUserState(null)
        setStatus('anonymous')
        onExpire?.()
      }
      let idleTimer = 0
      const resetIdle = () => {
        window.clearTimeout(idleTimer)
        idleTimer = window.setTimeout(expire, idleMs)
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
      setAuthExpirationHandler(expire)
      return () => {
        window.clearTimeout(idleTimer)
        window.clearTimeout(absTimer)
        events.forEach((e) => window.removeEventListener(e, resetIdle))
        setAuthExpirationHandler(null)
      }
    }, [status, onLogout, onExpire, idleMs])

    const value = useMemo<AuthContextValue<U>>(
      () => ({ user, status, setUser, logout }),
      [user, status, setUser, logout],
    )

    return (
      <AuthContext.Provider value={value}>
        <ExpiredContext.Provider value={expired}>{children}</ExpiredContext.Provider>
      </AuthContext.Provider>
    )
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
    const expired = useContext(ExpiredContext)
    const location = useLocation()
    const copy = useUiCopy()

    if (status === 'loading') {
      return (
        <>
          {loadingFallback ?? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#5f748c' }}>
              {copy.auth.loading}
            </div>
          )}
        </>
      )
    }

    if (status === 'anonymous') {
      // `?expired=1`: el login explica que la sesión caducó (no un logout).
      const to = expired ? `${loginPath}?expired=1` : loginPath
      return <Navigate to={to} replace state={{ from: location }} />
    }

    return <>{children}</>
  }

  return { AuthProvider, useAuth, RequireAuth }
}
