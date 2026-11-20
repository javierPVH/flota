/**
 * Integridad del contenido de la Ayuda (plan §9.1): la estructura de
 * `chapters.ts`, la copia es/en, las capturas y el vídeo cuentan lo mismo.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import { useTutorialCopy, type Block, type TutorialCopy } from '../translations/tutorial.ts'
import { CHAPTER_IDS, CHAPTERS, chapterForPath, isChapterId, isForViewer } from './chapters.ts'
import { LINK_MARK } from './RichText.tsx'
import { SHOT_KEYS } from './shots.ts'
import data from './video-scenes.json'

const wrapper = ({ children }: { children: ReactNode }) => createElement(LanguageProvider, null, children)

function copyIn(lang: 'es' | 'en'): TutorialCopy {
  localStorage.setItem('gs_base_lang', lang)
  return renderHook(() => useTutorialCopy(), { wrapper }).result.current
}

/** Todos los bloques de un capítulo (avisos previos, recorrido y secciones). */
function blocksOf(copy: TutorialCopy, id: (typeof CHAPTER_IDS)[number]): Block[] {
  const c = copy.chapters[id]
  return [...(c.intro ?? []), ...(c.walk ?? []), ...(c.sections ?? [])]
}

beforeEach(() => {
  localStorage.clear()
})

describe('estructura', () => {
  it('cada capítulo está una vez y en el orden del índice', () => {
    expect(CHAPTERS.map((c) => c.id)).toEqual([...CHAPTER_IDS])
  })

  it('la ayuda en contexto encuentra el capítulo de cada pantalla', () => {
    expect(chapterForPath('/login')).toBe('entrar')
    expect(chapterForPath('/')).toBe('pantalla')
    expect(chapterForPath('/', true)).toBe('flota')
    expect(chapterForPath('/vehiculos/12')).toBe('pantalla')
    expect(chapterForPath('/vehiculos/12', true)).toBe('flota')
    expect(chapterForPath('/registrar')).toBe('km')
    expect(chapterForPath('/alertas')).toBe('avisos')
    expect(chapterForPath('/alertas', true)).toBe('flota')
    expect(chapterForPath('/documentos/nuevo')).toBe('documentos')
    expect(chapterForPath('/incidencias/nueva')).toBe('incidencia')
    expect(chapterForPath('/grupo')).toBe('flota')
    expect(chapterForPath('/perfil')).toBe('perfil')
    expect(chapterForPath('/reparto')).toBe('reparto')
  })

  it('cada ruta de la app lleva a un capítulo (o se sabe que va a la portada)', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    const paths = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1].replace(':id', '1'))
    // La Ayuda (con su capítulo anidado, `:capitulo`) no se explica a sí misma.
    const toCover = new Set(['*', '/ayuda', '/ayuda/:capitulo', ':capitulo'])
    for (const path of paths) {
      if (toCover.has(path)) continue
      expect(chapterForPath(path), path).toBeTruthy()
    }
  })

  it('lo de supervisores solo sale a quien supervisa (sin sesión, tampoco)', () => {
    const flota = CHAPTERS.find((c) => c.id === 'flota')!
    const km = CHAPTERS.find((c) => c.id === 'km')!
    expect(isForViewer(flota, null)).toBe(false)
    expect(isForViewer(flota, { driver: true, supervisor: false })).toBe(false)
    expect(isForViewer(flota, { driver: false, supervisor: true })).toBe(true)
    expect(isForViewer(km, { driver: false, supervisor: true })).toBe(true)
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
    const shape = (b: Block) => [b.steps?.length, b.defs?.length, !!b.note, !!b.warn, b.shots, b.shotLabels?.length]
    for (const id of CHAPTER_IDS) {
      const a = es.chapters[id]
      const b = en.chapters[id]
      expect(b.intro?.map(shape), id).toEqual(a.intro?.map(shape))
      expect(b.walk?.map(shape), id).toEqual(a.walk?.map(shape))
      expect(b.sections?.map(shape), id).toEqual(a.sections?.map(shape))
      expect(b.quick?.map((q) => q.step), id).toEqual(a.quick?.map((q) => q.step))
      expect(Object.keys(b.shots ?? {}).sort(), id).toEqual(Object.keys(a.shots ?? {}).sort())
      expect(b.faq?.length, id).toEqual(a.faq?.length)
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

    it(`(${lang}) cada captura citada tiene texto alternativo, rótulo y fichero`, () => {
      const copy = copyIn(lang)
      for (const id of CHAPTER_IDS) {
        const text = copy.chapters[id]
        for (const block of blocksOf(copy, id)) {
          if (block.shotLabels) expect(block.shotLabels.length, `${id}: rótulos`).toBe(block.shots?.length)
          for (const name of block.shots ?? []) {
            expect(text.shots?.[name], `${id}: ${name}`).toBeTruthy()
            expect(SHOT_KEYS.has(`es:${name}`), `${id}: falta assets/tutorial/es/${name}.webp`).toBe(true)
          }
        }
      }
    })

    it(`(${lang}) cada enlace [[id#paso]] lleva a un capítulo y a un paso que existen`, () => {
      const json = JSON.stringify(copyIn(lang))
      for (const m of json.matchAll(LINK_MARK)) {
        expect(isChapterId(m[1]), m[0]).toBe(true)
        if (m[2]) {
          const walk = CHAPTERS.find((c) => c.id === m[1])?.walk ?? 0
          expect(Number(m[2]), m[0]).toBeLessThanOrEqual(walk)
        }
      }
    })

    it(`(${lang}) ninguna frase queda a medias`, () => {
      const json = JSON.stringify(copyIn(lang))
      expect(json).not.toMatch(/TODO|XXX|«»|“”|undefined/)
    })
  }
})

describe('vídeo', () => {
  it('escenas en orden, de capítulos que existen, y sus ficheros servidos', () => {
    let before = -1
    for (const scene of data.scenes) {
      expect(scene.at).toBeGreaterThan(before)
      before = scene.at
      if (scene.chapter) expect(isChapterId(scene.chapter), scene.chapter).toBe(true)
      expect(scene.es.title && scene.en.title).toBeTruthy()
    }
    for (const lang of data.videos) {
      for (const ext of ['webm', 'jpg']) {
        const file = `public/tutorial/video/promo-${lang}.${ext}`
        expect(existsSync(resolve(process.cwd(), file)), `falta ${file}`).toBe(true)
      }
    }
  })
})
