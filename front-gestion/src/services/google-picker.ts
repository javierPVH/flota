/**
 * Carga perezosa de Google Picker y apertura del selector de Drive (Fase A3,
 * patrón de list).
 *
 * El Picker es JS de Google que se carga desde apis.google.com. Necesita un
 * access_token de Drive del usuario (lo da el backend en /picker-config/) y la
 * API key del proyecto. Modos: elegir archivo o subir archivo (la subida va
 * navegador → Drive con el token del usuario; el back no toca los bytes).
 */

export type PickerFileKind = 'image' | 'pdf' | 'all'
export type PickerMode = 'file' | 'upload'

/** Referencia que devuelve el Picker: lo único que guarda la app. */
export interface PickedFile {
  id: string
  name: string
  url?: string
  mime?: string
  iconUrl?: string
}

interface OpenPickerOptions {
  accessToken: string
  apiKey: string
  appId?: string
  mode: PickerMode
  kind?: PickerFileKind
}

// Tipado estructural mínimo del SDK del Picker: Google no publica tipos, así
// que tipamos SOLO lo que usamos (sin `any`; lo no modelado queda `unknown`).
interface PickerView {
  setIncludeFolders(v: boolean): PickerView
  setMimeTypes(m: string): PickerView
  setOwnedByMe(v: boolean): PickerView
  setEnableDrives(v: boolean): PickerView
}
type PickerDocument = Record<string, string | undefined>
type PickerResponse = Record<string, unknown>
interface PickerBuilder {
  setOAuthToken(t: string): PickerBuilder
  setDeveloperKey(k: string): PickerBuilder
  setAppId(id: string): PickerBuilder
  addView(v: PickerView): PickerBuilder
  setCallback(cb: (data: PickerResponse) => void): PickerBuilder
  build(): { setVisible(v: boolean): void }
}
interface PickerNamespace {
  PickerBuilder: new () => PickerBuilder
  DocsView: new (viewId?: unknown) => PickerView
  DocsUploadView: new () => PickerView
  ViewId: Record<string, unknown>
  Response: Record<string, string>
  Action: Record<string, string>
  Document: Record<string, string>
}

declare global {
  interface Window {
    gapi?: { load(name: string, opts: { callback: () => void; onerror: () => void }): void }
    google?: { picker?: PickerNamespace }
  }
}

const GAPI_SRC = 'https://apis.google.com/js/api.js'

const MIME_BY_KIND: Record<PickerFileKind, string | null> = {
  image: 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/heic',
  pdf: 'application/pdf',
  all: null,
}

let scriptPromise: Promise<void> | null = null
let zIndexFixInjected = false

/**
 * El Picker inyecta su diálogo (`.picker-dialog`) y su fondo en `document.body`
 * con un z-index ~1000, por debajo de los modales del DS: se sube una vez.
 */
function ensurePickerZIndexFix(): void {
  if (zIndexFixInjected) return
  zIndexFixInjected = true
  const style = document.createElement('style')
  style.textContent =
    '.picker-dialog-bg{z-index:3000 !important}.picker-dialog{z-index:3001 !important}'
  document.head.appendChild(style)
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('No se pudo cargar Google API.')))
      if (window.gapi) resolve()
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('No se pudo cargar Google API.'))
    document.head.appendChild(script)
  })
}

/** Carga gapi + el módulo picker una sola vez. */
async function ensurePickerLoaded(): Promise<void> {
  if (window.google?.picker) return
  if (!scriptPromise) scriptPromise = loadScript(GAPI_SRC)
  await scriptPromise
  await new Promise<void>((resolve, reject) => {
    if (!window.gapi) {
      reject(new Error('Google API no disponible.'))
      return
    }
    window.gapi.load('picker', {
      callback: () => resolve(),
      onerror: () => reject(new Error('No se pudo cargar Google Picker.')),
    })
  })
}

/**
 * Abre el Picker y resuelve con la referencia elegida (o null si se cancela).
 * `mode: 'upload'` sube desde el navegador a Drive; `'file'` elige uno existente.
 */
export async function openDrivePicker(options: OpenPickerOptions): Promise<PickedFile | null> {
  await ensurePickerLoaded()
  const picker = window.google?.picker
  const { accessToken, apiKey, appId, mode, kind = 'all' } = options

  return new Promise<PickedFile | null>((resolve, reject) => {
    try {
      if (!picker) {
        reject(new Error('Google Picker no disponible.'))
        return
      }
      const builder = new picker.PickerBuilder().setOAuthToken(accessToken).setDeveloperKey(apiKey)
      if (appId) builder.setAppId(appId)

      if (mode === 'upload') {
        // Subida con elección de carpeta destino (incluidas unidades compartidas).
        builder.addView(new picker.DocsUploadView().setIncludeFolders(true))
      } else {
        // Dos vistas (pestañas): Mi unidad y unidades compartidas.
        const mimeTypes = MIME_BY_KIND[kind]
        const makeFileView = () => {
          const v = new picker.DocsView().setIncludeFolders(true)
          if (mimeTypes) v.setMimeTypes(mimeTypes)
          return v
        }
        builder.addView(makeFileView().setOwnedByMe(true))
        builder.addView(makeFileView().setEnableDrives(true))
      }

      builder.setCallback((data: PickerResponse) => {
        const action = data[picker.Response.ACTION]
        if (action === picker.Action.PICKED) {
          const docs = data[picker.Response.DOCUMENTS] as PickerDocument[] | undefined
          const doc = docs?.[0]
          if (!doc) {
            resolve(null)
            return
          }
          resolve({
            id: doc[picker.Document.ID] ?? '',
            name: doc[picker.Document.NAME] || '',
            url: doc[picker.Document.URL] || undefined,
            mime: doc[picker.Document.MIME_TYPE] || undefined,
            iconUrl: doc[picker.Document.ICON_URL] || undefined,
          })
        } else if (action === picker.Action.CANCEL) {
          resolve(null)
        }
      })

      ensurePickerZIndexFix()
      builder.build().setVisible(true)
    } catch (err) {
      reject(err instanceof Error ? err : new Error('No se pudo abrir Google Picker.'))
    }
  })
}
