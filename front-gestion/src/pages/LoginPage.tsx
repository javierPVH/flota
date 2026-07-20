import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@flota/ui/ui'
import { TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { ALLOWED_ROLES, useAuth } from '../auth.ts'
import { login, logout } from '../api.ts'

export function LoginPage() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const user = await login(username, password)
      if (!ALLOWED_ROLES.includes(user.role)) {
        // Un conductor no entra por el front de gestión: cerramos su sesión.
        await logout().catch(() => {})
        setError('Este acceso es solo para personal de gestión.')
        return
      }
      setUser(user)
      navigate('/', { replace: true })
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo iniciar sesión.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Flota · Gestión</h1>
        <p className="sub">Acceso restringido (VPN) — administradores y gestores de flota.</p>
        <TextInputField
          label="Usuario o email"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
        <TextInputField
          label="Contraseña"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && <div className="form-error">{error}</div>}
        <Button type="submit" variant="primary" fullWidth disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </div>
  )
}
