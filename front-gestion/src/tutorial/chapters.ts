/**
 * Estructura de la Ayuda (tutorial de administración): QUÉ capítulos hay, en
 * qué grupo, qué pantalla explican y qué capturas usan. Sin texto: la prosa
 * vive en `translations/tutorial.ts` (es/en), así un idioma no puede tener un
 * paso más que el otro sin que lo detecte `chapters.test.ts`.
 *
 * Plan completo: tutoriales/administradores/PLAN_VISTA_TUTORIAL.md
 */
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  Car,
  CircleHelp,
  FileText,
  FilePen,
  FolderOpen,
  Gauge,
  HardHat,
  Home,
  KeyRound,
  CirclePlay,
  LogIn,
  Mail,
  RefreshCw,
  Settings,
  Siren,
  Upload,
  Users,
  Wrench,
  CarFront,
} from 'lucide-react'

export const CHAPTER_IDS = [
  'video',
  'entrar',
  'panel',
  'vehiculos',
  'ficha',
  'alta',
  'importar',
  'estado',
  'itv-mantenimiento',
  'kilometraje',
  'incidencias',
  'resolver',
  'accidentes',
  'alertas',
  'solicitudes',
  'documentos',
  'usuarios',
  'correo',
  'informes',
  'ajustes',
  'hse',
  'preguntas',
] as const
export type ChapterId = (typeof CHAPTER_IDS)[number]

export const GROUP_IDS = ['intro', 'start', 'fleet', 'events', 'papers', 'admin', 'other'] as const
export type GroupId = (typeof GROUP_IDS)[number]

export interface Chapter {
  id: ChapterId
  group: GroupId
  icon: LucideIcon
  /** Pantalla que explica: «Abrir esta pantalla». */
  route?: string
  /** Rutas de la app que enlazan aquí desde «¿Cómo funciona?» (fase 5). */
  routes?: RegExp[]
  /** Nº de pestañas del recorrido; la copia trae una por pestaña. */
  walk?: number
  audience?: 'superuser' | 'hse'
  /** El capítulo es el vídeo de presentación (`IntroVideo`), no pasos. */
  video?: boolean
}

/** En el orden del índice (el de `CHAPTER_IDS`). */
export const CHAPTERS: Chapter[] = [
  { id: 'video', group: 'intro', icon: CirclePlay, video: true },
  { id: 'entrar', group: 'start', icon: LogIn, walk: 3 },
  { id: 'panel', group: 'start', icon: Home, route: '/', routes: [/^\/$/], walk: 4 },
  { id: 'vehiculos', group: 'fleet', icon: Car, route: '/vehiculos', routes: [/^\/vehiculos$/], walk: 6 },
  { id: 'ficha', group: 'fleet', icon: CarFront, route: '/vehiculos', routes: [/^\/vehiculos\/\d+$/], walk: 5 },
  {
    id: 'alta',
    group: 'fleet',
    icon: FilePen,
    route: '/vehiculos/nuevo',
    routes: [/^\/vehiculos\/nuevo$/, /^\/vehiculos\/\d+\/editar$/],
    walk: 6,
  },
  { id: 'importar', group: 'fleet', icon: Upload, walk: 4 },
  { id: 'estado', group: 'fleet', icon: RefreshCw, walk: 6 },
  { id: 'itv-mantenimiento', group: 'fleet', icon: CalendarClock, walk: 2 },
  { id: 'kilometraje', group: 'fleet', icon: Gauge, route: '/kilometraje', routes: [/^\/kilometraje$/], walk: 4 },
  {
    id: 'incidencias',
    group: 'events',
    icon: AlertTriangle,
    route: '/incidencias',
    routes: [/^\/incidencias$/],
    walk: 5,
  },
  { id: 'resolver', group: 'events', icon: Wrench, walk: 5 },
  { id: 'accidentes', group: 'events', icon: Siren, route: '/accidentes', routes: [/^\/accidentes$/], walk: 5 },
  { id: 'alertas', group: 'events', icon: BellRing, route: '/alertas', routes: [/^\/alertas$/] },
  { id: 'solicitudes', group: 'events', icon: KeyRound, route: '/solicitudes', routes: [/^\/solicitudes$/] },
  { id: 'documentos', group: 'papers', icon: FolderOpen, route: '/documentos', routes: [/^\/documentos$/], walk: 3 },
  { id: 'usuarios', group: 'papers', icon: Users, route: '/conductores', routes: [/^\/conductores(\/\d+)?$/] },
  { id: 'correo', group: 'papers', icon: Mail, walk: 4 },
  { id: 'informes', group: 'admin', icon: FileText, route: '/informes', routes: [/^\/informes$/], walk: 2 },
  {
    id: 'ajustes',
    group: 'admin',
    icon: Settings,
    route: '/ajustes/catalogos',
    routes: [/^\/ajustes(\/[a-z]+)?$/],
  },
  { id: 'hse', group: 'other', icon: HardHat, route: '/hse', routes: [/^\/hse$/], audience: 'hse' },
  { id: 'preguntas', group: 'other', icon: CircleHelp },
]

export function isChapterId(value: string | undefined): value is ChapterId {
  return (CHAPTER_IDS as readonly string[]).includes(value ?? '')
}

export function chapterById(id: ChapterId): Chapter {
  return CHAPTERS.find((c) => c.id === id)!
}

/** Capítulo de una ruta de la app (para la ayuda en contexto). */
export function chapterForPath(path: string): ChapterId | undefined {
  return CHAPTERS.find((c) => c.routes?.some((r) => r.test(path)))?.id
}

/** Anterior y siguiente en el orden del índice. */
export function neighbours(id: ChapterId): { prev?: ChapterId; next?: ChapterId } {
  const i = CHAPTERS.findIndex((c) => c.id === id)
  return { prev: CHAPTERS[i - 1]?.id, next: CHAPTERS[i + 1]?.id }
}
