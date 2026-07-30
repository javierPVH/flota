/**
 * Barrera de errores global (mejora 🟡): si algo revienta al renderizar, en vez
 * de la pantalla en blanco se muestra la escena del login con un aviso y
 * salidas. Textos sin i18n a propósito: el error puede venir del propio
 * proveedor de idioma.
 *
 * Recuperación (E4 de OPTIMIZACION_Y_ERRORES.md): además de "Recargar",
 * retroceder con el navegador (`popstate`) reintenta el render — la ruta
 * anterior probablemente funciona — e "Ir al inicio" recarga en la raíz
 * (la barrera vive FUERA del Router, no puede navegar por él).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Sin telemetría todavía (ver MEJORAS_FRONTS.md); al menos queda en consola.
    console.error('ErrorBoundary:', error, info.componentStack)
  }

  private onPopState = () => {
    // Volver atrás = reintentar: la ruta anterior probablemente renderiza bien.
    if (this.state.hasError) this.setState({ hasError: false })
  }

  componentDidMount() {
    window.addEventListener('popstate', this.onPopState)
  }

  componentWillUnmount() {
    window.removeEventListener('popstate', this.onPopState)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="login-scene">
        <div className="login-card" role="alert">
          <h1>Algo ha fallado</h1>
          <p className="sub">
            La aplicación ha encontrado un error inesperado. Recarga la página o
            vuelve al inicio; si el problema persiste, avisa a administración.
          </p>
          <button
            type="button"
            className="login-submit"
            onClick={() => window.location.reload()}
          >
            Recargar
          </button>
          <button
            type="button"
            className="login-submit boundary-home"
            onClick={() => window.location.assign('/')}
          >
            Ir al inicio
          </button>
        </div>
      </div>
    )
  }
}
