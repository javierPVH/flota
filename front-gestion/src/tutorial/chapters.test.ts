/**
 * Integridad del contenido de la Ayuda (plan §9.2): la estructura de
 * `chapters.ts` y la copia es/en cuentan lo mismo.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import { useTutorialCopy, type TutorialCopy } from '../translations/tutorial.ts'
import { CHAPTER_IDS, CHAPTERS, chapterForPath } from './chapters.ts'
import { SHOT_KEYS } from './shots.ts'
import scenes from './video-scenes.json'

const wrapper = ({ children }: { children: ReactNode }) => createElement(LanguageProvider, null, children)

function copyIn(lang: 'es' | 'en'): TutorialCopy {
  localStorage.setItem('gs_base_lang', lang)
  return renderHook(() => useTutorialCopy(), { wrapper }).result.current
}

beforeEach(() => {
  localStorage.clear()
})

describe('estructura', () => {
  it('cada capítulo está una vez y en el orden del índice', () => {
    expect(CHAPTERS.map((c) => c.id)).toEqual([...CHAPTER_IDS])
  })

  it('la ayuda en contexto encuentra el capítulo de cada pantalla', () => {
    expect(chapterForPath('/')).toBe('panel')
    expect(chapterForPath('/vehiculos')).toBe('vehiculos')
    expect(chapterForPath('/vehiculos/12')).toBe('ficha')
    expect(chapterForPath('/vehiculos/nuevo')).toBe('alta')
    expect(chapterForPath('/vehiculos/12/editar')).toBe('alta')
    expect(chapterForPath('/conductores/3')).toBe('usuarios')
    expect(chapterForPath('/ajustes/borrado')).toBe('ajustes')
  })
})

describe('copia es/en', () => {
  it('el idioma de la prueba cambia de verdad', () => {
    expect(copyIn('es').ui.title).toBe('Ayuda')
    expect(copyIn('en').ui.title).toBe('Help')
  })

  it('los dos idiomas tienen la misma forma en cada capítulo', () => {
    const es = copyIn('es')
    const en = copyIn('en')
    for (const id of CHAPTER_IDS) {
      const a = es.chapters[id]
      const b = en.chapters[id]
      expect(b.sections?.map((s) => s.steps.length), id).toEqual(a.sections?.map((s) => s.steps.length))
      expect(b.sections?.map((s) => s.shot), id).toEqual(a.sections?.map((s) => s.shot))
      expect(b.walk?.map((w) => w.steps.length), id).toEqual(a.walk?.map((w) => w.steps.length))
      expect(b.walk?.map((w) => w.shot), id).toEqual(a.walk?.map((w) => w.shot))
      expect(b.quick?.map((q) => q.step), id).toEqual(a.quick?.map((q) => q.step))
      expect(Object.keys(b.shots ?? {}).sort(), id).toEqual(Object.keys(a.shots ?? {}).sort())
      expect(b.faq?.length, id).toEqual(a.faq?.length)
      expect(b.downloads?.map((d) => d.file), id).toEqual(a.downloads?.map((d) => d.file))
    }
  })

  it('los ficheros de ejemplo que se descargan son los de ejemplos-importacion/', () => {
    // La copia servida (public/) no puede quedarse atrás del original.
    const files = CHAPTER_IDS.flatMap((id) => copyIn('es').chapters[id].downloads ?? []).map((d) => d.file)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const served = readFileSync(resolve(process.cwd(), 'public/tutorial/ejemplos', file), 'utf8')
      const original = readFileSync(resolve(process.cwd(), '../ejemplos-importacion', file), 'utf8')
      expect(served, `${file}: vuelve a copiarlo a public/tutorial/ejemplos/`).toBe(original)
    }
  })

  it('el vídeo de presentación: escenas de capítulos que existen, y sus ficheros', () => {
    // Las chapas del vídeo salen de `groups` del JSON: tienen que ser las del índice.
    for (const lang of ['es', 'en'] as const) {
      const groups = copyIn(lang).groups
      for (const [id, label] of Object.entries(scenes.groups)) {
        expect(label[lang], `grupo ${id} (${lang})`).toBe(groups[id as keyof typeof groups])
      }
    }
    for (const scene of scenes.scenes) {
      if (scene.chapter) expect(CHAPTER_IDS as readonly string[], scene.chapter).toContain(scene.chapter)
      expect(scene.es.title && scene.es.text && scene.en.title && scene.en.text).toBeTruthy()
    }
    for (const lang of ['es', 'en']) {
      for (const ext of ['webm', 'jpg']) {
        const file = `public/tutorial/video/presentacion-${lang}.${ext}`
        expect(existsSync(resolve(process.cwd(), file)), `falta ${file}`).toBe(true)
      }
    }
  })

  for (const lang of ['es', 'en'] as const) {
    it(`(${lang}) el recorrido tiene las pestañas que dice chapters.ts y la guía apunta dentro`, () => {
      const copy = copyIn(lang)
      for (const c of CHAPTERS) {
        const text = copy.chapters[c.id]
        expect(text.walk?.length ?? 0, c.id).toBe(c.walk ?? 0)
        for (const q of text.quick ?? []) {
          expect(q.step, `${c.id}: ${q.label}`).toBeGreaterThanOrEqual(1)
          expect(q.step, `${c.id}: ${q.label}`).toBeLessThanOrEqual(c.walk ?? 0)
        }
      }
    })

    it(`(${lang}) cada captura citada tiene su texto alternativo`, () => {
      const copy = copyIn(lang)
      for (const id of CHAPTER_IDS) {
        const text = copy.chapters[id]
        const cited = [...(text.sections ?? []), ...(text.walk ?? [])].flatMap((s) => (s.shot ? [s.shot] : []))
        for (const name of cited) expect(text.shots?.[name], `${id}: ${name}`).toBeTruthy()
      }
    })

    it(`(${lang}) cada captura citada existe (en castellano, que es la de reserva)`, () => {
      const copy = copyIn(lang)
      for (const id of CHAPTER_IDS) {
        for (const name of Object.keys(copy.chapters[id].shots ?? {})) {
          expect(SHOT_KEYS.has(`es:${name}`), `${id}: falta assets/tutorial/es/${name}.webp`).toBe(true)
        }
      }
    })

    it(`(${lang}) ninguna frase queda a medias`, () => {
      const json = JSON.stringify(copyIn(lang))
      expect(json).not.toMatch(/TODO|XXX|«»|“”|undefined/)
    })
  }
})
