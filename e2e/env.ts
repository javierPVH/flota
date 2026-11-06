/**
 * Entorno del back de pruebas e2e (ver docs/E2E_PLAYWRIGHT.md §3).
 *
 * Una sola copia: la leen el arranque de los servidores (playwright.config.ts)
 * y la resiembra (fixtures.ts). Todo apunta a un back PROPIO en :8001 con una
 * SQLite aparte, así que no toca la BD de desarrollo ni los servidores de
 * :8000 / :5173 / :5175.
 */
import path from 'node:path'

export const ROOT = path.resolve(__dirname, '..')
export const BACK = path.join(ROOT, 'back')
export const PYTHON =
  process.platform === 'win32'
    ? path.join(BACK, '.venv', 'Scripts', 'python.exe')
    : path.join(BACK, '.venv', 'bin', 'python')

export const BACK_PORT = 8001
export const GESTION_PORT = 5183
export const CONDUCTORES_PORT = 5185

export const BACK_URL = `http://127.0.0.1:${BACK_PORT}`
export const GESTION_URL = `http://localhost:${GESTION_PORT}`
export const CONDUCTORES_URL = `http://localhost:${CONDUCTORES_PORT}`

/**
 * Entorno del back de pruebas. Pisa al `.env` del back (load_dotenv no
 * sobrescribe lo que ya está en el entorno), así que aquí se fija TODO lo que
 * condiciona las pruebas y no se depende de lo que cada equipo tenga en su
 * `.env`.
 */
export const backEnv: Record<string, string> = {
  ...(process.env as Record<string, string>),
  DEBUG: 'True',
  // dev-login (entrada sin contraseña) exige DEBUG + FLEET_SEED_DATA.
  FLEET_SEED_DATA: 'True',
  DB_ENGINE: 'sqlite',
  DJANGO_SQLITE_PATH: path.join(BACK, 'e2e.sqlite3'),
  FLEET_ARCHIVE_BACKEND: 'local',
  FLEET_ARCHIVE_LOCAL_DIR: path.join(BACK, 'e2e_archive'),
  FLEET_DEMO: 'False',
  DJANGO_ADMIN_ENABLED: 'False',
  // Sin correo real: sin host SMTP el envío se deshabilita limpio.
  EMAIL_HOST: '',
  FLEET_EMAIL_FORCE_ENABLED: 'False',
  // Ventana de registro de km abierta todo el mes (N8a): las pruebas registran
  // lecturas cualquier día.
  FLEET_KM_WINDOW_START: '0',
  // Los throttles de DRF: el dev-login es anónimo y cada prueba entra de
  // nuevo, así que con el 100/hora de fábrica la suite se queda sin login
  // (429) a mitad de camino.
  THROTTLE_ANON_RATE: '100000/hour',
  THROTTLE_USER_RATE: '100000/hour',
  THROTTLE_PUBLIC_WRITE_RATE: '100000/min',
  // El seed escribe acentos por stdout; en una consola Windows con cp1252
  // eso reventaba el comando.
  PYTHONIOENCODING: 'utf-8',
  PYTHONUTF8: '1',
}
