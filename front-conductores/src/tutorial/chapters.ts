/**
 * Estructura de la Ayuda de la app de campo: QUÉ capítulos hay, en qué grupo,
 * para quién son y qué pantallas explican. Sin texto: la prosa vive en
 * `translations/tutorial.ts` (es/en), así un idioma no puede tener un paso más
 * que el otro sin que lo detecte `chapters.test.ts`.
 *
 * Los ids son los del tutorial HTML (`tutoriales/conductores/tutoriales.html#km`
 * → `/ayuda/km`), salvo `intro` → `video` y `faq` → `preguntas`.
 *
 * Plan: docs/PLAN_TUTORIAL_APP_CONDUCTORES.md
 */
import type { LucideIcon } from 'lucide-react'
import {
  BellRing,
  CalendarClock,
  CircleHelp,
  CirclePlay,
  CloudOff,
  Cog,
  Fuel,
  FolderOpen,
  Gauge,
  LayoutDashboard,
  LogIn,
  Siren,
  Split,
  User,
  Users,
  Wrench,
} from 'lucide-react'

export const CHAPTER_IDS = [
  'video',
  'entrar',
  'pantalla',
  'km',
  'combustible',
  'itv',
  'mantenimiento',
  'reparto',
  'incidencia',
  'accidente',
  'documentos',
  'avisos',
  'perfil',
  'flota',
  'offline',
  'preguntas',
] as const
export type ChapterId = (typeof CHAPTER_IDS)[number]

export const GROUP_IDS = ['start', 'car', 'events', 'papers', 'supervisor', 'other'] as const
export type GroupId = (typeof GROUP_IDS)[number]

/** Para quién es el capítulo (el `data-for` del HTML). */
export type Audience = 'all' | 'driver' | 'supervisor'

export interface Chapter {
  id: ChapterId
  group: GroupId
  icon: LucideIcon
  audience: Audience
  /** Nº de pestañas del recorrido; la copia trae una por pestaña. */
  walk?: number
  /** Lleva el vídeo de presentación. */
  video?: boolean
}

/** En el orden del índice (el de `CHAPTER_IDS`). */
export const CHAPTERS: Chapter[] = [
  { id: 'video', group: 'start', icon: CirclePlay, audience: 'all', video: true },
  { id: 'entrar', group: 'start', icon: LogIn, audience: 'all' },
  { id: 'pantalla', group: 'start', icon: LayoutDashboard, audience: 'all' },
  { id: 'km', group: 'car', icon: Gauge, audience: 'driver' },
  { id: 'combustible', group: 'car', icon: Fuel, audience: 'driver' },
  { id: 'itv', group: 'car', icon: CalendarClock, audience: 'driver' },
  { id: 'mantenimiento', group: 'car', icon: Cog, audience: 'driver' },
  { id: 'reparto', group: 'car', icon: Split, audience: 'driver' },
  { id: 'incidencia', group: 'events', icon: Wrench, audience: 'driver', walk: 6 },
  { id: 'accidente', group: 'events', icon: Siren, audience: 'driver', walk: 5 },
  { id: 'documentos', group: 'papers', icon: FolderOpen, audience: 'all', walk: 10 },
  { id: 'avisos', group: 'papers', icon: BellRing, audience: 'all' },
  { id: 'perfil', group: 'papers', icon: User, audience: 'all' },
  { id: 'flota', group: 'supervisor', icon: Users, audience: 'supervisor', walk: 7 },
  { id: 'offline', group: 'other', icon: CloudOff, audience: 'all' },
  { id: 'preguntas', group: 'other', icon: CircleHelp, audience: 'all' },
]

export function isChapterId(value: string | undefined | null): value is ChapterId {
  return (CHAPTER_IDS as readonly string[]).includes(value ?? '')
}

export function chapterById(id: ChapterId): Chapter {
  return CHAPTERS.find((c) => c.id === id)!
}

/**
 * Capítulo de una pantalla de la app (el «?» de la cabecera). `fleet` es el
 * modo del supervisor: en «Flota», el inicio y las fichas son de su capítulo.
 */
export function chapterForPath(path: string, fleet = false): ChapterId | undefined {
  if (path === '/login' || path === '/solicitar' || path === '/sin-flota') return 'entrar'
  if (path === '/') return fleet ? 'flota' : 'pantalla'
  if (/^\/vehiculos\/\d+$/.test(path)) return fleet ? 'flota' : 'pantalla'
  if (path.startsWith('/grupo')) return 'flota'
  if (path === '/reparto') return 'reparto'
  if (path === '/registrar') return 'km'
  if (path === '/alertas') return fleet ? 'flota' : 'avisos'
  if (path === '/documentos/nuevo') return 'documentos'
  if (path === '/incidencias/nueva') return 'incidencia'
  if (path === '/perfil') return 'perfil'
  return undefined
}

/** Roles de quien mira: deciden qué capítulos salen sin pedirlo. */
export interface Viewer {
  driver: boolean
  supervisor: boolean
}

/**
 * ¿Sale el capítulo? Lo de supervisores, SOLO a quien supervisa (sin sesión no
 * se sabe, así que tampoco); lo de conductores sale a todos (el supervisor
 * también apunta km o comunica incidencias desde la ficha).
 */
export function isForViewer(chapter: Chapter, viewer: Viewer | null): boolean {
  return chapter.audience !== 'supervisor' || !!viewer?.supervisor
}

/** Anterior y siguiente en el orden del índice, dentro de lo que se ve. */
export function neighbours(id: ChapterId, visible: ChapterId[] = [...CHAPTER_IDS]) {
  const list = visible.includes(id) ? visible : [...CHAPTER_IDS]
  const i = list.indexOf(id)
  return { prev: list[i - 1], next: list[i + 1] }
}
