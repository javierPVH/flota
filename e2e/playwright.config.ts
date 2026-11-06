/**
 * Configuración de Playwright (ver docs/E2E_PLAYWRIGHT.md §4).
 *
 * Levanta TRES servidores de pruebas —el back en :8001 sobre `e2e.sqlite3` y
 * las dos apps de Vite en :5183 / :5185 apuntando a él por su proxy— y define
 * tres proyectos: gestión (escritorio), conductores (móvil) y api (sin UI).
 *
 *   node node_modules/@playwright/test/cli.js test --config e2e/playwright.config.ts
 */
import { defineConfig, devices } from '@playwright/test'
import {
  BACK,
  BACK_PORT,
  BACK_URL,
  CONDUCTORES_PORT,
  CONDUCTORES_URL,
  GESTION_PORT,
  GESTION_URL,
  PYTHON,
  ROOT,
  backEnv,
} from './env'

const vite = `node "${ROOT}/node_modules/vite/bin/vite.js"`
const py = `"${PYTHON}" manage.py`

// Las apps hablan con el back por el proxy de Vite (cookies de sesión + CSRF
// exigen mismo origen), igual que en dev.
const viteEnv = { ...process.env, VITE_PROXY_TARGET: BACK_URL } as Record<string, string>

export default defineConfig({
  testDir: './tests',
  // Comparten UNA base de datos: de uno en uno hasta que haya BD por worker.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',

  use: {
    // Chrome del sistema: no hay que descargar navegadores. En CI (Linux)
    // se quita y se instala chromium (§1 de la guía).
    channel: 'chrome',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Sin vídeo: exige descargar ffmpeg (`playwright install ffmpeg`), y la
    // traza ya lleva capturas de cada paso con su red y su consola.
    video: 'off',
  },

  webServer: [
    {
      // migrate (la SQLite de pruebas puede no existir) → seed → runserver.
      // El seed va explícito porque `runserver --noreload` no pasa por el
      // proceso hijo del autoreloader (RUN_MAIN), que es donde siembra
      // `FleetConfig.ready()`; y sin autoreload el servidor es UN proceso,
      // que es lo que Playwright sabe parar al terminar.
      command: `${py} migrate --noinput && ${py} seed_dev_data --force && ${py} runserver 127.0.0.1:${BACK_PORT} --noreload`,
      cwd: BACK,
      env: backEnv,
      url: `${BACK_URL}/api/v1/auth/csrf/`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      // Django escribe cada petición por stderr: con E2E_BACK_LOG=1 se ve en
      // el reporter (para depurar el arranque); si no, silencio.
      stdout: 'ignore',
      stderr: process.env.E2E_BACK_LOG ? 'pipe' : 'ignore',
    },
    {
      command: `${vite} --port ${GESTION_PORT} --strictPort`,
      cwd: `${ROOT}/front-gestion`,
      env: viteEnv,
      url: GESTION_URL,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `${vite} --port ${CONDUCTORES_PORT} --strictPort`,
      cwd: `${ROOT}/front-conductores`,
      env: viteEnv,
      url: CONDUCTORES_URL,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],

  projects: [
    {
      name: 'gestion',
      testDir: './tests/gestion',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', baseURL: GESTION_URL },
    },
    {
      name: 'conductores',
      testDir: './tests/conductores',
      // La PWA se prueba en móvil, que es donde se usa.
      use: { ...devices['Pixel 7'], channel: 'chrome', baseURL: CONDUCTORES_URL },
    },
    {
      name: 'api',
      testDir: './tests/api',
      use: { baseURL: GESTION_URL },
    },
  ],
})
