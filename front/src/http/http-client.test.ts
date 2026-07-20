import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getJson,
  postJson,
  toUrl,
  resolveBaseUrl,
  asErrorMessage,
  ReauthRequiredError,
  setReauthHandler,
} from './http-client.ts'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('resolveBaseUrl / toUrl', () => {
  it('sin baseUrl devuelve el path tal cual', () => {
    expect(resolveBaseUrl()).toBe('')
    expect(toUrl('/api/x')).toBe('/api/x')
  })

  it('con baseUrl explícita la normaliza y concatena', () => {
    expect(toUrl('/api/x', 'http://h:8000/')).toBe('http://h:8000/api/x')
    expect(toUrl('api/x', 'http://h:8000')).toBe('http://h:8000/api/x')
  })
})

describe('asErrorMessage', () => {
  it('usa detail de DRF', () => {
    expect(asErrorMessage({ detail: 'No autorizado' }, 'fb')).toBe('No autorizado')
  })
  it('aplana errores de campo DRF', () => {
    expect(asErrorMessage({ email: ['Ya existe'] }, 'fb')).toBe('email: Ya existe')
  })
  it('cae al fallback', () => {
    expect(asErrorMessage(null, 'fb')).toBe('fb')
  })
})

describe('peticiones JSON', () => {
  beforeEach(() => {
    setReauthHandler(null)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    setReauthHandler(null)
  })

  it('getJson devuelve el payload parseado en 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: 1 })))
    await expect(getJson('/api/x')).resolves.toEqual({ ok: 1 })
  })

  it('lanza Error con el mensaje del backend ante respuesta no-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'Falló' }, { status: 400 })))
    await expect(getJson('/api/x')).rejects.toThrow('Falló')
  })

  it('POST en modo cookie añade cabecera X-CSRFToken', async () => {
    document.cookie = 'csrftoken=abc123'
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(jsonResponse({ done: true })),
    )
    vi.stubGlobal('fetch', fetchMock)

    await postJson('/api/x', { a: 1 })

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers
    expect(headers.get('X-CSRFToken')).toBe('abc123')
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('reauth: 403 reauth_required abre el handler y reintenta una vez', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'reauth_required' }, { status: 403 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const handler = vi.fn(async () => true)
    setReauthHandler(handler)

    await expect(postJson('/api/sensible', {})).resolves.toEqual({ ok: true })
    expect(handler).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reauth: sin handler lanza ReauthRequiredError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ code: 'reauth_required' }, { status: 403 })))
    await expect(postJson('/api/sensible', {})).rejects.toBeInstanceOf(ReauthRequiredError)
  })
})
