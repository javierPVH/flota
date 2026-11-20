/**
 * Capturas de la Ayuda: `src/assets/tutorial/<lang>/<nombre>.webp`.
 *
 * `eager` + `?url` mete en el chunk solo las URLs; cada imagen se pide cuando
 * se pinta su `<img loading="lazy">` (y el service worker la guarda como
 * cualquier asset con hash: lo ya visto se ve sin cobertura). Si falta la
 * inglesa se usa la castellana, y si no hay ninguna, `Shot` enseña «Captura
 * pendiente».
 *
 * Se rehacen con `docs/tutoriales-capturas/capture.mjs`.
 */
const files = import.meta.glob<string>('../assets/tutorial/*/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
})

export type ShotLang = 'es' | 'en'

export function shotUrl(lang: ShotLang, name: string): string | undefined {
  return files[`../assets/tutorial/${lang}/${name}.webp`] ?? files[`../assets/tutorial/es/${name}.webp`]
}

/** Capturas que existen, como `es:nombre` / `en:nombre` (prueba de integridad). */
export const SHOT_KEYS: ReadonlySet<string> = new Set(
  Object.keys(files).map((k) => k.replace(/^.*\/(es|en)\/(.+)\.webp$/, '$1:$2')),
)
