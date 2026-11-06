/**
 * Sesión (docs/E2E_PLAYWRIGHT.md §6.1): lo que pasa antes y después de
 * entrar. Sin sesión todo es 403, el login con una clave mala no entra, el
 * logout corta, `/me` dice los roles de verdad y UNA persona tiene UNA sesión.
 */
import { anonymous, expect, loginRequest, postJson, sessionFor, test } from '../../fixtures'

type Me = { username: string; roles: string[]; is_superuser?: boolean }

test('sin sesión: /me y la flota contestan 403', async ({ playwright, baseURL }) => {
  const anon = await anonymous(playwright, baseURL!)
  expect((await anon.get('/api/v1/auth/me/')).status()).toBe(403)
  expect((await anon.get('/api/v1/vehicles/')).status()).toBe(403)
  await anon.dispose()
})

test('la configuración pública dice que el dev-login está encendido', async ({
  playwright,
  baseURL,
}) => {
  const anon = await anonymous(playwright, baseURL!)
  const config = await (await anon.get('/api/v1/auth/config/')).json()
  expect(config.dev_login_enabled).toBe(true)
  // Y el selector lista a la gente del seed (sin contraseñas, claro).
  const users = (await (await anon.get('/api/v1/auth/dev-login/')).json()) as Array<{
    username: string
  }>
  expect(users.map((u) => u.username)).toEqual(expect.arrayContaining(['admin', 'carlos', 'hse']))
  await anon.dispose()
})

test('una contraseña incorrecta no abre sesión', async ({ playwright, baseURL }) => {
  const anon = await anonymous(playwright, baseURL!)
  await anon.get('/api/v1/auth/csrf/')
  const res = await postJson(anon, '/api/v1/auth/login/', {
    username: 'carlos',
    password: 'esta-no-es',
  })
  expect(res.ok()).toBeFalsy()
  expect((await anon.get('/api/v1/auth/me/')).status()).toBe(403)
  await anon.dispose()
})

test('/me cuenta los roles de cada perfil', async ({ playwright, baseURL }) => {
  const esperado: Record<string, string[]> = {
    admin: ['admin', 'supervisor', 'driver', 'hse'],
    sara: ['supervisor', 'driver'],
    carlos: ['driver'],
    hse: ['hse'],
    nuevo: [],
  }
  for (const [who, roles] of Object.entries(esperado)) {
    const ctx = await sessionFor(playwright, baseURL!, who as 'admin')
    const me = (await (await ctx.get('/api/v1/auth/me/')).json()) as Me
    expect.soft(me.username, who).toBe(who)
    expect.soft([...me.roles].sort(), `roles de ${who}`).toEqual([...roles].sort())
    await ctx.dispose()
  }
})

test('el logout cierra la sesión', async ({ playwright, baseURL }) => {
  const ctx = await sessionFor(playwright, baseURL!, 'carlos')
  const res = await postJson(ctx, '/api/v1/auth/logout/', {})
  expect([200, 204]).toContain(res.status())
  expect((await ctx.get('/api/v1/auth/me/')).status()).toBe(403)
  await ctx.dispose()
})

test('una sesión por persona: entrar en otro sitio cierra la anterior', async ({
  playwright,
  baseURL,
}) => {
  const primera = await sessionFor(playwright, baseURL!, 'lucia')
  expect((await primera.get('/api/v1/auth/me/')).ok()).toBeTruthy()
  const segunda = await playwright.request.newContext({ baseURL: baseURL! })
  await loginRequest(segunda, 'lucia')
  expect((await segunda.get('/api/v1/auth/me/')).ok()).toBeTruthy()
  // La primera recibe el 403 de siempre en su siguiente petición.
  expect((await primera.get('/api/v1/auth/me/')).status()).toBe(403)
  await primera.dispose()
  await segunda.dispose()
})
