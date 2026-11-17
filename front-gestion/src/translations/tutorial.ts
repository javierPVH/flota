/**
 * Copia de la Ayuda (tutorial de administración), es/en.
 *
 * Regla: los rótulos que el usuario tiene que BUSCAR en pantalla (botones,
 * pestañas, títulos) no se escriben aquí: se toman de la copia de su pantalla
 * (`ui.vehicles.exportCsv`, `ui.app.home.title`…). Si un botón se renombra, el
 * tutorial cambia solo; si la clave desaparece, no compila.
 *
 * La estructura (qué capítulos hay, recorridos, rutas) está en
 * `tutorial/chapters.ts`; aquí, solo cómo se cuenta en cada idioma.
 */
import { useAppLang } from '@flota/ui/i18n'

import { useLang } from '../i18n.tsx'
import type { ChapterId, GroupId } from '../tutorial/chapters.ts'
import { useAjustesCopy } from './ajustes.ts'
import { useAlertsPageCopy } from './alertsPage.ts'
import { useBulkImportCopy } from './bulkImport.ts'
import { useDocumentsCopy } from './documents.ts'
import { useErratasCopy } from './erratas.ts'
import { useHseCopy } from './hse.ts'
import { useIncidentsCopy } from './incidents.ts'
import { useInvoicesCopy } from './invoices.ts'
import { useMileageCopy } from './mileage.ts'
import { useReportsCopy } from './reports.ts'
import { useRequestsCopy } from './requests.ts'
import { useScheduleCopy } from './schedule.ts'
import { useResolveCopy } from './resolve.ts'
import { useUsersCopy } from './users.ts'
import { useVehicleDetailCopy } from './vehicleDetail.ts'
import { useVehicleFormCopy } from './vehicleForm.ts'
import { useVehiclesCopy } from './vehicles.ts'

/** Copias de la app que cita el tutorial. */
interface Ui {
  app: ReturnType<typeof useLang>['t']
  vehicles: ReturnType<typeof useVehiclesCopy>
  bulk: ReturnType<typeof useBulkImportCopy>
  schedule: ReturnType<typeof useScheduleCopy>
  mileage: ReturnType<typeof useMileageCopy>
  alerts: ReturnType<typeof useAlertsPageCopy>
  requests: ReturnType<typeof useRequestsCopy>
  users: ReturnType<typeof useUsersCopy>
  reports: ReturnType<typeof useReportsCopy>
  invoices: ReturnType<typeof useInvoicesCopy>
  ajustes: ReturnType<typeof useAjustesCopy>
  erratas: ReturnType<typeof useErratasCopy>
  hse: ReturnType<typeof useHseCopy>
  documents: ReturnType<typeof useDocumentsCopy>
  vehicleDetail: ReturnType<typeof useVehicleDetailCopy>
  vehicleForm: ReturnType<typeof useVehicleFormCopy>
  resolve: ReturnType<typeof useResolveCopy>
  incidents: ReturnType<typeof useIncidentsCopy>
}

/** «Importar 9 registros» → «Importar N registros»: el rótulo con su forma. */
const withN = (fn: (n: number) => string) => fn(9).replace('9', 'N')

export interface TutorialSection {
  title: string
  steps: string[]
  note?: string
  /** Captura de la sección (nombre del fichero, sin `.webp`). */
  shot?: string
}

export interface TutorialWalkStep {
  /** Rótulo corto de la pestaña del recorrido. */
  tab: string
  title: string
  steps: string[]
  shot?: string
}

export interface ChapterCopy {
  title: string
  /** Una frase: para qué sirve la pantalla. */
  lead: string
  sections?: TutorialSection[]
  walk?: TutorialWalkStep[]
  /** «¿Qué quieres hacer?»: `step` es la pestaña del recorrido (desde 1). */
  quick?: Array<{ label: string; step: number }>
  /** Texto alternativo de cada captura del capítulo. */
  shots?: Record<string, string>
  faq?: Array<{ q: string; a: string }>
  /** Ficheros para descargar (en `public/tutorial/ejemplos/`). */
  downloads?: Array<{ label: string; file: string }>
}

export interface TutorialCopy {
  ui: {
    title: string
    subtitle: string
    indexLabel: string
    search: string
    searchPlaceholder: string
    results: (n: number) => string
    noResults: (q: string) => string
    coverTitle: string
    coverText: string
    chaptersCount: (n: number) => string
    openScreen: string
    quickTitle: string
    walkLabel: string
    stepOf: (i: number, n: number) => string
    back: string
    next: string
    prevChapter: string
    nextChapter: string
    faqTitle: string
    pending: string
    shotPending: string
    zoom: string
    backToScreen: string
    soon: string
    read: string
    tasksTitle: string
    start: string
    headerHint: string
    pagerLabel: string
    resume: string
    progress: (seen: number, n: number) => string
    moreFaq: string
    clearSearch: string
    downloadsTitle: string
    watchVideo: string
    videoFallback: string
    videoLangHint: string
    videoScenesTitle: string
    videoScenesHint: string
    videoSeek: (time: string) => string
  }
  groups: Record<GroupId, string>
  audience: { superuser: string; hse: string }
  chapters: Record<ChapterId, ChapterCopy>
}

const es = (ui: Ui): TutorialCopy => {
  const { app, vehicles: v, bulk: bk, schedule: s, mileage: m, alerts: a, requests: r } = ui
  const { users: u, reports: rp, invoices: inv, ajustes: aj, erratas: er, hse: h, documents: d } = ui
  const { vehicleDetail: vd, vehicleForm: vf, resolve: rs, incidents: inc } = ui
  const nav = app.shell.nav
  const home = app.home
  return {
    ui: {
      title: app.shell.nav.help,
      subtitle: 'Cómo se usa la app de gestión, pantalla a pantalla',
      indexLabel: 'Capítulos de la ayuda',
      search: 'Buscar en la ayuda',
      searchPlaceholder: 'Por ejemplo: exportar, sustitución, ITV…',
      results: (n) => (n === 1 ? '1 resultado' : `${n} resultados`),
      noResults: (q) => `Nada coincide con «${q}».`,
      coverTitle: 'Bienvenida a la ayuda',
      coverText:
        'Cada capítulo explica una pantalla o una tarea de la app de gestión. Elige uno en el índice o busca lo que necesitas.',
      chaptersCount: (n) => (n === 1 ? '1 capítulo' : `${n} capítulos`),
      openScreen: 'Abrir esta pantalla',
      quickTitle: '¿Qué quieres hacer?',
      walkLabel: 'Recorrido paso a paso',
      stepOf: (i, n) => `Paso ${i} de ${n}`,
      back: 'Atrás',
      next: 'Continuar',
      prevChapter: 'Anterior',
      nextChapter: 'Siguiente',
      faqTitle: 'Dudas frecuentes',
      pending: 'Este capítulo está en preparación: de momento, solo su resumen.',
      shotPending: 'Captura pendiente',
      zoom: 'Ampliar la captura',
      backToScreen: 'Volver a la pantalla',
      pagerLabel: 'Capítulo anterior y siguiente',
      soon: 'Pronto',
      read: 'Leído',
      tasksTitle: 'Tareas frecuentes',
      start: 'Empezar por el principio',
      resume: 'Seguir donde lo dejaste',
      progress: (seen, n) => `Has abierto ${seen} de ${n} capítulos`,
      moreFaq: 'Más dudas, por capítulo',
      downloadsTitle: 'Ficheros de ejemplo',
      watchVideo: 'Ver el vídeo de presentación',
      videoFallback: 'Tu navegador no puede reproducir este vídeo. Abajo tienes lo que dice, escena a escena.',
      videoLangHint: `¿Lo quieres en inglés? Cambia el idioma al final del menú («${app.shell.language}»): cambian la ayuda y el vídeo.`,
      videoScenesTitle: 'Qué sale en el vídeo',
      videoScenesHint: 'Pulsa el minuto para saltar a esa escena, o el nombre del capítulo para verlo paso a paso.',
      videoSeek: (time) => `Ir al ${time} del vídeo`,
      clearSearch: 'Borrar la búsqueda',
      headerHint: `Desde cualquier pantalla, el botón «?» de la cabecera («${app.shell.helpHere}») abre su capítulo.`,
    },
    groups: {
      intro: 'Presentación',
      start: 'Primeros pasos',
      fleet: 'La flota',
      events: 'Lo que pasa',
      papers: 'Papeles y personas',
      admin: 'Administración',
      other: 'Otros',
    },
    audience: { superuser: 'Solo superusuario', hse: 'Necesita el rol HSE' },
    chapters: {
      video: {
        title: 'Vídeo de presentación',
        lead: 'La app de gestión en un minuto y medio, pantalla a pantalla. Sin sonido: los textos van en el vídeo.',
      },
      entrar: {
        title: 'Entrar y moverse por la app',
        lead: 'Cómo entrar, qué hay en la cabecera y cómo llegar a cada pantalla sin perder tiempo.',
        quick: [
          { label: 'Entrar en la app', step: 1 },
          { label: 'Ver avisos y solicitudes', step: 2 },
          { label: 'Cambiar de idioma o salir', step: 3 },
        ],
        walk: [
          {
            tab: 'Entrar',
            title: 'Entrar',
            steps: [
              `Abre la app: lo primero que sale es «${app.login.heading}».`,
              `Escribe tu «${app.login.userLabel}» y tu «${app.login.passwordLabel}», y pulsa «${app.login.submit}».`,
              'Al entrar llegas a [[panel]]. Si no puedes entrar, pide a la administración que revise tu cuenta y tus roles.',
            ],
            shot: 'login',
          },
          {
            tab: 'Cabecera',
            title: 'La cabecera',
            steps: [
              'La cabecera está siempre arriba, en todas las pantallas.',
              `Pulsa la campana («${app.shell.notifications}») para ver las últimas alertas e incidencias, cada una en su pestaña: «${app.shell.bell.alerts}» y «${app.shell.bell.incidents}».`,
              'La llave con un número aparece cuando hay solicitudes sin decidir. Púlsala y te lleva a la primera bandeja que tiene algo pendiente ([[solicitudes]]).',
              `El botón «?» («${app.shell.helpHere}») abre el capítulo de esta ayuda que explica la pantalla en la que estás.`,
              `El botón «${app.shell.hse.button}» abre [[hse]]. Solo lo ves si tienes ese rol.`,
            ],
            shot: 'cabecera',
          },
          {
            tab: 'Menú',
            title: 'El menú',
            steps: [
              `Pulsa «${app.shell.menu}» en la cabecera para ver todas las pantallas de la app.`,
              `Están agrupadas en «${app.shell.navGroups.general}», «${app.shell.navGroups.fleet}», «${app.shell.navGroups.tracking}» y «${app.shell.navGroups.admin}». Pulsa una pantalla para ir a ella.`,
              `Al final del menú puedes cambiar de idioma («${app.shell.language}»): cambia toda la app, y también esta ayuda.`,
              `Para salir, pulsa «${app.shell.logout}», también al final del menú.`,
            ],
            shot: 'menu',
          },
        ],
        shots: {
          login: 'La pantalla de inicio de sesión',
          cabecera: 'La cabecera con la campana, la llave de solicitudes y el menú',
          menu: 'El menú abierto con sus grupos',
        },
      },
      panel: {
        title: home.title,
        lead: 'El resumen de la flota: las cifras, lo que vence pronto y lo que está pendiente.',
        quick: [
          { label: 'Ver las cifras de la flota', step: 1 },
          { label: 'Atender lo pendiente', step: 2 },
          { label: 'Buscar un coche o una persona', step: 3 },
          { label: 'Dar de alta un vehículo o un usuario', step: 4 },
        ],
        walk: [
          {
            tab: 'Cifras',
            title: 'Las cifras',
            steps: [
              `Arriba hay tres contadores: «${home.statVehicles}», «${home.statAlerts}» e «${home.statIncidents}».`,
              `Debajo, seis indicadores: «${home.kpiVehicles}», «${home.kpiUse}», «${home.kpiCost}», «${home.kpiItv}», «${home.kpiInsurance}» y «${home.kpiMaintenance}».`,
              'Pulsa cualquier indicador para abrir su ventana: ahí ves el detalle coche a coche y puedes actuar sobre cada uno.',
            ],
            shot: 'panel-indicadores',
          },
          {
            tab: 'Pendiente',
            title: 'Lo pendiente',
            steps: [
              `«${home.alertsTitle}» e «${home.incidentsTitle}» son dos tiras que reúnen lo que hay que atender.`,
              'Pulsa una de las chapas de la tira para ver solo lo de ese tipo.',
              'Pulsa la tira para abrir la lista completa. Desde ahí se resuelve cada cosa: [[resolver]].',
            ],
            shot: 'panel-pendientes',
          },
          {
            tab: 'Buscar',
            title: 'Buscar en la flota',
            steps: [
              `La tabla de abajo cambia según la pestaña que elijas: «${home.tabs.fleet}», «${home.tabs.substitute}», «${home.tabs.supervisors}» o «${home.tabs.drivers}».`,
              `Abre «${home.toolsToggle}» para buscar y filtrar.`,
              `En ese mismo panel, «${home.exportCsv}» descarga la tabla.`,
              'Pulsa la matrícula de un coche para abrir [[ficha]].',
            ],
            shot: 'panel',
          },
          {
            tab: 'Altas',
            title: 'Altas rápidas',
            steps: [
              `Para dar de alta desde aquí, usa «${home.addVehicle}» o «${home.addDriver}», en la cabecera de la pantalla.`,
              `Antes de llevarte a su pantalla, la app avisa («${home.addConfirmTitle}»): pulsa «${home.addConfirmGo}» para seguir.`,
              'El alta se explica paso a paso en [[alta]] (vehículos) y en [[usuarios]] (personas).',
            ],
            shot: 'panel-altas',
          },
        ],
        shots: {
          'panel-indicadores': 'Los seis indicadores de la vista general',
          'panel-pendientes': 'Las tiras de alertas e incidencias pendientes',
          panel: 'La tabla de la vista general con sus pestañas',
          'panel-altas': 'La cabecera de la vista general con sus botones de alta',
        },
      },
      vehiculos: {
        title: v.title,
        lead: 'El inventario de la flota: encontrar un coche, sacar listados y actuar sobre él sin abrir su ficha.',
        quick: [
          { label: 'Encontrar un coche', step: 1 },
          { label: 'Elegir las columnas', step: 2 },
          { label: 'Ver lo que está a punto de vencer', step: 3 },
          { label: 'Sacar un listado', step: 4 },
          { label: 'Ver los coches de sustitución', step: 5 },
          { label: 'Hacer algo con un coche', step: 6 },
        ],
        walk: [
          {
            tab: 'Buscar',
            title: 'Encontrar un coche',
            steps: [
              `Elige «${v.tabFleet}» o «${v.tabSubstitute}». El número de cada pestaña es cuántos hay.`,
              `Abre «${v.toolsToggle}» y escribe en «${v.lblSearch}» la matrícula, la marca o el modelo.`,
              `Para afinar, usa «${v.lblState}», «${v.lblSupervisor}», «${v.lblDriver}» o «${v.lblCreated}».`,
              `Con «${v.stateHasSubstitute}» ves los coches que ahora mismo tienen uno de sustitución.`,
            ],
            shot: 'vehiculos-filtros',
          },
          {
            tab: 'Tabla',
            title: 'Leer la tabla',
            steps: [
              'Cada fila es un coche. Pulsa su matrícula para abrir [[ficha]].',
              `La celda de kilómetros dice cuánto lleva sin lectura («${v.kmNoReading}», «${withN(v.kmStale)}»), con un color de semáforo.`,
              'Las fechas en ámbar o en rojo vencen pronto o ya han vencido.',
              `En «${v.toolsToggle}», «${v.lblColumns}» elige qué columnas se ven y en qué orden («${v.colMoveUp}», «${v.colMoveDown}»).`,
            ],
            shot: 'vehiculos-columnas',
          },
          {
            tab: 'Vencimientos',
            title: 'Ver lo que está a punto de vencer',
            steps: [
              `Marca uno o varios cortes: «${v.dueItv}», «${v.dueInsurance}», «${v.dueMaint}» o «${v.kmOver}».`,
              'Si marcas varios, salen los coches que cumplen cualquiera de ellos.',
              `«${v.clearFilters}» lo deja todo como al entrar.`,
            ],
            shot: 'vehiculos-cortes',
          },
          {
            tab: 'Listados',
            title: 'Sacar un listado',
            steps: [
              'Deja en la tabla solo lo que quieras sacar: aplica los filtros, los cortes y las columnas de los pasos anteriores.',
              `Pulsa «${v.exportCsv}». Se abre «${v.exportTitle}»: ${v.exportIntro}`,
              `Pulsa «${v.exportRun}» para descargar el fichero.`,
            ],
            shot: 'vehiculos-exportar',
          },
          {
            tab: 'Sustitución',
            title: 'Los coches de sustitución',
            steps: [
              `«${v.tabSubstitute}» lista los coches de recambio y dice si cada uno está «${v.free}» u «${v.busy}».`,
              `En «${v.tabFleet}», la flecha de una fila despliega el coche que la cubre: «${v.subRow}», ${v.subRowSince('…').toLowerCase()}`,
              `Un sustituto libre puede pasar a la flota con «${vf.convertBtn}». La app avisa antes de hacerlo.`,
              'Para darle un coche de sustitución a otro, sigue [[estado]].',
            ],
            shot: 'vehiculos-sustitucion',
          },
          {
            tab: 'Acciones',
            title: 'Hacer algo con un coche',
            steps: [
              'Pulsa los tres puntos ⋮ al final de la fila del coche: se abre su menú de acciones.',
              `Para avisar o citar: «${v.email.btn}» ([[correo]]) y «${v.schedule.btn}» ([[itv-mantenimiento]]).`,
              `Si le ha pasado algo: «${v.accident.btn}» ([[accidentes]]) y «${rs.pending.title}» ([[estado]] y [[resolver]]).`,
              `Para sus datos: «${v.kmFuel.btn}» ([[kilometraje]]), «${v.invoices.btn}» ([[informes#2]]) y «${v.edit}» ([[alta#6]]).`,
              `«${v.deactivate}» no borra el coche: conserva su histórico, sus facturas y sus documentos, y se puede reactivar en [[ajustes]].`,
            ],
            shot: 'vehiculos-menu',
          },
        ],
        shots: {
          vehiculos: 'La lista de vehículos con sus dos pestañas',
          'vehiculos-filtros': 'El panel de búsqueda y filtros abierto',
          'vehiculos-columnas': 'El desplegable para elegir las columnas',
          'vehiculos-cortes': 'Los cortes de vencimientos marcados',
          'vehiculos-exportar': 'La ventana para exportar a CSV',
          'vehiculos-sustitucion': 'La pestaña de vehículos de sustitución',
          'vehiculos-menu': 'El menú de acciones de un coche',
        },
        faq: [
          {
            q: '¿Por qué no encuentro un coche que he dado de baja?',
            a: `Las bajas no salen por defecto: marca «${v.showBajas}».`,
          },
          {
            q: '¿Dónde están los coches de sustitución?',
            a: `En su pestaña, «${v.tabSubstitute}».`,
          },
        ],
      },
      ficha: {
        title: 'La ficha del vehículo',
        lead: 'Todo sobre un coche en una página: indicadores, contrato, facturas, documentos y su histórico de cambios.',
        quick: [
          { label: 'Ver todo de un coche', step: 1 },
          { label: 'Saber cuándo vence algo', step: 2 },
          { label: 'Ver quién cambió qué', step: 4 },
          { label: 'Deshacer un cambio', step: 5 },
        ],
        walk: [
          {
            tab: 'Cabecera',
            title: 'Lo primero que ves',
            steps: [
              'Para abrir la ficha de un coche, pulsa su matrícula en [[vehiculos]] o en [[panel]].',
              `Arriba ves la matrícula y sus chapas: estado, conductor y supervisor. «${vd.backToVehicles}» te devuelve a la lista.`,
              `«${vd.monthlyCost}» y «${vd.contractEnd}» se pueden pulsar: cada uno abre su detalle.`,
              `Debajo tienes las acciones: «${v.email.btn}», «${vd.editSheet}» y el «${vd.statusLabel}» del coche.`,
            ],
            shot: 'ficha',
          },
          {
            tab: 'Indicadores',
            title: 'Los indicadores',
            steps: [
              `Los indicadores resumen las fechas del coche: «${vd.insuranceExpiry}», «${vd.nextItv}» y «${vd.nextMaintenance}». Los dos últimos llevan a [[itv-mantenimiento]].`,
              `«${vd.pendingKpi}» reúne lo que el coche tiene abierto: púlsalo para verlo y resolverlo ([[estado]], [[resolver]]).`,
              `«${vd.mileage}» y «${vd.fuelAvgTitle}» abren los kilómetros y el combustible del coche ([[kilometraje]]).`,
            ],
            shot: 'ficha-indicadores',
          },
          {
            tab: 'Tarjetas',
            title: 'Las tarjetas',
            steps: [
              `Cada tarjeta guarda un bloque de datos. «${vd.techTitle}» y «${vd.contractTitle}»: los datos del coche y los de su contrato.`,
              `«${vd.contractedKmTitle}» dice cómo va de kilómetros; puedes verlo en vista «${vd.annualView}» o «${vd.contractView}».`,
              'Las demás tarjetas: facturas, alertas e incidencias, accidentes, conductor y reparto, y documentos.',
              'Arriba puedes desplegarlas o plegarlas todas de golpe.',
            ],
            shot: 'ficha-tarjetas',
          },
          {
            tab: 'Histórico',
            title: vd.historyTitle,
            steps: [
              `«${vd.historyTitle}» guarda cada cambio del coche y quién lo hizo («${vd.doneByLabel}»).`,
              `«${vd.historyFilterLabel}» filtra según de dónde viene el cambio; «${withN(vd.showFullHistory)}» los enseña todos.`,
              'La gráfica por días solo la ve la administración: pulsa un día para ver sus cambios.',
            ],
            shot: 'ficha-historico',
          },
          {
            tab: 'Deshacer',
            title: 'Deshacer un cambio',
            steps: [
              `Algunos cambios del histórico llevan «${vd.revertBtn}»: solo los que se pueden deshacer.`,
              `Pide confirmación: «${vd.revertTitle}» → «${vd.revertConfirm}».`,
              vd.revertDone,
            ],
          },
        ],
        shots: {
          ficha: 'La cabecera de la ficha de un vehículo',
          'ficha-indicadores': 'Los indicadores de la ficha',
          'ficha-tarjetas': 'Las tarjetas de datos de la ficha',
          'ficha-historico': 'El histórico de cambios del vehículo',
        },
      },
      alta: {
        title: 'Alta y edición de un vehículo',
        lead: 'Dar de alta un coche de flota o de sustitución, y cambiar sus datos con el candado de los datos sensibles.',
        quick: [
          { label: 'Dar de alta un coche', step: 1 },
          { label: 'Poner el conductor y el supervisor', step: 4 },
          { label: 'Cambiar un dato', step: 6 },
          { label: 'Cambiar la matrícula o el bastidor', step: 6 },
        ],
        walk: [
          {
            tab: 'Empezar',
            title: 'Qué coche es',
            steps: [
              `Pulsa «${v.newVehicle}» en [[vehiculos]], o «${home.addVehicle}» en [[panel]].`,
              `En «${vf.typeSectionTitle}» elige «${vf.fleetOption}» o «${vf.substituteOption}». El tipo queda fijado al crear el coche.`,
              `Rellena «${vf.fixedTitle}», que va siempre arriba: «${vf.plate}», «${vf.vin}» y «${vf.registrationDate}».`,
              'Si tienes que dar de alta muchos coches de golpe, es más rápido [[importar]].',
            ],
            shot: 'alta-tipo',
          },
          {
            tab: vf.identificationTitle,
            title: vf.identificationTitle,
            steps: [
              `Elige la «${vf.brand}» y luego el «${vf.model}».`,
              `Si el modelo no está, «${vf.newModelButton}» lo añade a esa marca.`,
              `Pulsa «${vf.nextTab}».`,
            ],
            shot: 'alta-1',
          },
          {
            tab: vf.technicalTitle,
            title: vf.technicalTitle,
            steps: [
              `Rellena los datos técnicos del coche: «${vf.fuel}», «${vf.segment}», «${vf.consumption}»…`,
              `«${vf.kmStart}»: ${vf.kmStartNote}`,
              `Pulsa «${vf.nextTab}» para seguir.`,
            ],
            shot: 'alta-2',
          },
          {
            tab: vf.usageTitle,
            title: vf.usageTitle,
            steps: [
              `Elige el «${vf.businessUse}» y, si el coche es de un proyecto, el «${vf.project}».`,
              `Asigna el «${vf.driver}» y el «${vf.supervisor}», e indica el «${vf.costCenter}».`,
              `Marca «${vf.multiuser}» si lo comparten varias personas.`,
              'Un coche de sustitución no tiene esta pestaña.',
            ],
            shot: 'alta-3',
          },
          {
            tab: vf.propertyTitle,
            title: vf.propertyTitle,
            steps: [
              `Indica «${vf.property}», «${vf.company}» y «${vf.insuranceExpiry}».`,
              `Si es de renting, rellena también «${vf.rentingCompany}», «${vf.monthFee}», «${vf.contractStart}»… ${vf.contractCreateNote}`,
              `Marca «${vf.unlimitedKm}» si el contrato no tiene límite de kilómetros.`,
              `El pie de la pantalla avisa mientras haya «${vf.unsavedChanges}». Para terminar, pulsa «${vf.createVehicle}»: solo aparece en esta última pestaña.`,
            ],
            shot: 'alta-4',
          },
          {
            tab: 'Editar',
            title: 'Editar un coche que ya existe',
            steps: [
              `Abre la edición desde ⋮ → «${v.edit}» en [[vehiculos]], o con «${vd.editSheet}» en [[ficha]].`,
              `Los datos que identifican el coche están «${vf.lockClosed}». Para cambiarlos, pulsa el candado: la app avisa («${vf.unlockTitle}») y hay que confirmar con «${vf.unlockConfirm}».`,
              `Antes de guardar, «${vf.reviewChanges}» enseña el antes y el después de cada dato.`,
              `Si está bien, pulsa «${vf.saveChanges}»; si no, «${vf.keepEditing}».`,
            ],
            shot: 'editar-candado',
          },
        ],
        shots: {
          'alta-tipo': 'El alta de un vehículo: tipo y datos fijos',
          'alta-1': 'La pestaña de identificación del vehículo',
          'alta-2': 'La pestaña de características técnicas',
          'alta-3': 'La pestaña de uso y asignación',
          'alta-4': 'La pestaña de propiedad y contrato',
          'editar-candado': 'La edición de un vehículo con el candado de los datos sensibles',
        },
      },
      importar: {
        title: 'Importar en bloque',
        lead: 'Dar de alta o actualizar muchos vehículos o personas de una vez, desde un Excel o un CSV.',
        quick: [
          { label: 'Dar de alta muchos coches o personas', step: 1 },
          { label: 'Cambiar un dato de muchos coches', step: 2 },
          { label: 'Ver qué filas fallan y por qué', step: 3 },
        ],
        walk: [
          {
            tab: 'Fichero',
            title: 'Elegir el fichero',
            steps: [
              `En «${nav.vehicles}» o en «${nav.drivers}», pulsa «${v.importBtn}».`,
              `«${bk.dropTitle}». Vale un Excel (.xlsx) o un CSV, con la primera fila de cabecera.`,
              'La app cuenta las filas que ha leído y avisa de las vacías que se salta.',
              `Pulsa «${bk.next}».`,
            ],
            shot: 'importar-1',
          },
          {
            tab: 'Columnas',
            title: 'Decir qué es cada columna',
            steps: [
              'Cada campo de la app se empareja con una columna de tu fichero. Si las cabeceras son las habituales, se emparejan solas.',
              `Lo que dejes en «${bk.unassigned}» no se toca.`,
              'Si una matrícula ya existe, se actualizan sus datos con los del fichero (solo los que cambian). Para cambiar un dato de muchos coches, empareja solo la matrícula y ese campo.',
              `Pulsa «${bk.validate}».`,
            ],
            shot: 'importar-2',
          },
          {
            tab: 'Revisar',
            title: 'Revisar antes de importar',
            steps: [
              `La vista previa separa «${bk.tabNew}» y «${bk.tabErrors}», y dice cuántos se crearán y cuántos se actualizarán.`,
              `En «${bk.tabErrors}» ves la fila, el campo y el motivo. «${bk.downloadErrors}» te los baja para corregirlos en tu fichero.`,
              `Cuando esté bien, pulsa «${withN(bk.importN)}».`,
            ],
            shot: 'importar-3',
          },
          {
            tab: 'Importar',
            title: 'Mientras se importa',
            steps: [
              'Una barra cuenta las filas procesadas: creadas, actualizadas, sin cambios y con error.',
              `«${bk.stop}» para a mitad. Lo que ya se ha creado se queda.`,
              `Al acabar, «${bk.downloadResults}» te baja qué se hizo con cada fila.`,
            ],
          },
        ],
        shots: {
          'importar-1': 'El primer paso de la importación: elegir el fichero',
          'importar-2': 'Las columnas del fichero emparejadas con los campos de la app',
          'importar-3': 'La vista previa con los registros nuevos y los errores',
        },
        sections: [
          {
            title: 'Cómo tiene que ser el fichero',
            steps: [
              'La primera fila es la cabecera. Las filas vacías se saltan.',
              'En un CSV, el separador puede ser punto y coma, coma o tabulador: se detecta solo. La codificación, UTF-8.',
              'Las fechas, como 2027-01-31 o como 31/01/2027.',
              'Para sí o no, escribe «sí» o «no».',
              'Lo que en la app es un desplegable se escribe por su nombre: «Diésel», «Renting».',
              'En las personas, los roles van separados por comas: conductor, supervisor.',
            ],
            note: 'Los ficheros de ejemplo de aquí abajo ya tienen este formato: descarga uno y cámbiale los datos.',
          },
        ],
        downloads: [
          { label: 'Alta de vehículos', file: 'vehiculos.csv' },
          { label: 'Actualizar unos pocos datos de vehículos que ya existen', file: 'vehiculos-actualizacion.csv' },
          { label: 'Alta de personas', file: 'conductores.csv' },
        ],
        faq: [
          {
            q: '¿Por qué sale en errores una fila que parece correcta?',
            a: 'La sociedad, el proyecto, el CECO, el supervisor y el conductor se buscan por su nombre en la app: tienen que existir ya.',
          },
          {
            q: 'Si importo el mismo fichero dos veces, ¿se duplica algo?',
            a: 'No. Lo que ya existe se actualiza o se queda sin cambios.',
          },
        ],
      },
      estado: {
        title: 'Cambiar el estado y el coche de sustitución',
        lead: 'Parar un coche por avería, mantenimiento o neumáticos, y darle un coche de sustitución mientras tanto.',
        quick: [
          { label: 'Mandar un coche al taller', step: 1 },
          { label: 'Darle un coche de sustitución', step: 3 },
          { label: 'Cambiar los neumáticos', step: 4 },
          { label: 'Avisar al conductor', step: 6 },
        ],
        walk: [
          {
            tab: 'Estado',
            title: v.ops.stateSection,
            steps: [
              `En [[vehiculos]], abre el menú ⋮ del coche → «${rs.pending.title}» y entra en la pestaña «${rs.pending.tabNewState}».`,
              `En «${v.ops.newState}» elige qué le pasa: «${v.ops.maintenanceOnceOption}», «${v.ops.tiresOption}», «${v.ops.breakdownOption}» o «${v.ops.generalOption}».`,
              `Antes de abrir uno nuevo, mira en «${v.ops.tabOpen}» los que el coche ya tiene abiertos, para no repetirlo.`,
            ],
            shot: 'estado-1',
          },
          {
            tab: 'Disponibilidad',
            title: v.ops.availSection,
            steps: [
              'Aquí decides si el coche sigue rodando o se queda parado. Las opciones dependen de cómo está ahora.',
              `Si está en servicio: «${v.ops.availWithSub}», «${v.ops.availWithoutSub}» o «${v.ops.availStaysActive}».`,
              `Si ya está parado: «${v.ops.availStaysOut}» o «${v.ops.availBackToService}».`,
              `Si sale sin sustituto, puedes explicar por qué en «${v.ops.availReason}».`,
            ],
            shot: 'estado-2',
          },
          {
            tab: 'Sustituto',
            title: v.ops.subSection,
            steps: [
              `Con «${v.ops.availWithSub}» aparece «${v.ops.subSection}»: elige el «${v.ops.subSelect}», la «${v.ops.start}» y el «${v.ops.subReason}».`,
              `Si no hay ninguno libre, «${v.newSubstitute}» lo da de alta sin salir de aquí.`,
              `Si el coche ya tiene uno: «${v.ops.activeLink}» y «${v.ops.closeLink}».`,
            ],
            shot: 'estado-sustituto',
          },
          {
            tab: 'Neumáticos',
            title: v.ops.tiresSection,
            steps: [
              `Este paso solo aparece si en el primero elegiste «${v.ops.tiresOption}».`,
              `Indica el «${v.ops.tiresMileage}» y el «${v.ops.tiresChangeReason}»: «${v.ops.tiresWear}» o «${v.ops.tiresPuncture}».`,
              'Marca qué ruedas se cambian.',
            ],
            shot: 'estado-neumaticos',
          },
          {
            tab: 'Gestión',
            title: `${v.ops.manageSection} y ${v.ops.docsSection.toLowerCase()}`,
            steps: [
              `En «${v.ops.manageSection}» indica dónde está el coche, con su «${v.ops.managePostalCode}».`,
              `En «${v.ops.docsSection}» adjunta los papeles de este estado.`,
            ],
            shot: 'estado-gestion',
          },
          {
            tab: 'Correo',
            title: v.ops.comSection,
            steps: [
              `Para avisar del cambio, elige el «${v.ops.comTemplate}» y marca a quién va: «${v.ops.comToDriver}» o «${v.ops.comToSupervisor}».`,
              `Si quieres, añade un «${v.ops.comMessage}» tuyo.`,
              `Muévete entre los pasos con «${v.ops.back}» y «${v.ops.next}», y termina con «${v.ops.save}».`,
              `Los pasos en gris no se pueden abrir todavía: ${v.ops.stepLocked.toLowerCase()}`,
            ],
            shot: 'estado-email',
          },
        ],
        shots: {
          'estado-1': 'El primer paso: el nuevo estado del vehículo',
          'estado-2': 'La disponibilidad del vehículo',
          'estado-sustituto': 'La elección del coche de sustitución',
          'estado-neumaticos': 'Los datos del cambio de neumáticos',
          'estado-gestion': 'La ubicación y los archivos del estado',
          'estado-email': 'El correo que avisa del cambio',
        },
        faq: [
          {
            q: '¿Cómo vuelve el coche a estar en servicio?',
            a: `Al resolver su incidencia, con la casilla para devolverlo a Activo ([[resolver]]), o aquí con «${v.ops.availBackToService}».`,
          },
        ],
      },
      'itv-mantenimiento': {
        title: v.schedule.btn,
        lead: 'La cita de la ITV y el programa de mantenimiento de cada coche.',
        quick: [
          { label: 'Dar cita de ITV', step: 1 },
          { label: 'Poner un coche en su plan de mantenimiento', step: 2 },
        ],
        walk: [
          {
            tab: 'ITV',
            title: 'La cita de la ITV',
            steps: [
              `En «${nav.vehicles}», menú ⋮ del coche → «${v.schedule.btn}». Se abre en «${s.tabItv}».`,
              `Elige la «${s.itvDate}» y, si quieres, el «${s.itvPostalCode}».`,
              `Pulsa «${s.itvSchedule}». Para cambiarla: «${s.itvModify}» y luego «${s.itvSave}».`,
              `Cuando la ITV ya se ha pasado, «${s.resolveItv}» la registra. «${s.itvDelete}» quita la cita.`,
            ],
            shot: 'itv-1',
          },
          {
            tab: 'Mantenimiento',
            title: 'El programa de mantenimiento',
            steps: [
              `Pasa a «${s.tabMaintenance}».`,
              `Elige el «${s.maintenancePick}» del catálogo, o crea uno con «${s.maintenanceNewProgram}».`,
              `Indica desde cuándo se cuenta: «${s.maintenanceFromDate}» o «${s.maintenanceFromKm}».`,
              `Pulsa «${s.maintenanceSchedule}». Cuando el taller haga la revisión, «${s.resolveMaintenance}».`,
            ],
            shot: 'itv-2',
          },
        ],
        shots: {
          'itv-1': 'La pestaña para programar la ITV de un coche',
          'itv-2': 'La pestaña para programar el mantenimiento de un coche',
        },
        faq: [{ q: '¿Puede un coche tener dos citas de ITV?', a: s.itvOnlyOne }],
      },
      kilometraje: {
        title: nav.mileage,
        lead: 'Las lecturas de kilómetros, las que faltan este mes y la proyección a fin de contrato o de año.',
        quick: [
          { label: 'Ver quién no ha dado los km este mes', step: 2 },
          { label: 'Saber si un coche se va a pasar de km', step: 3 },
        ],
        walk: [
          {
            tab: 'Lecturas',
            title: m.tabs.readings,
            steps: [
              `«${m.tabs.readings}» enseña la última lectura de cada coche y su fecha.`,
              `Para encontrar un coche, busca su matrícula o filtra por «${m.supervisorFilter}».`,
            ],
            shot: 'km-lecturas',
          },
          {
            tab: 'Pendientes',
            title: m.tabs.pending,
            steps: [
              `«${m.tabs.pending}» lista los coches que aún no tienen lectura este mes.`,
              `«${m.email.bulkAction}» manda un recordatorio a sus conductores.`,
              `«${m.estimateAction}» rellena las lecturas que faltaron el mes anterior con una estimación, que sale marcada «${m.estimatedTag}».`,
            ],
            shot: 'km-pendientes',
          },
          {
            tab: 'Proyección',
            title: m.tabs.projection,
            steps: [
              'Calcula a qué ritmo va cada coche y con cuántos kilómetros acabará.',
              `En «${m.projModeLabel}» eliges «${m.projContract}» o «${m.projYear}».`,
              `La columna «${m.columns.level}» dice si va «${m.levels.within}», «${m.levels.watch}» o en «${m.levels.over}».`,
              `Si un coche va a pasarse, «${m.resolveOverage}» abre la solución, por ejemplo cambiarle el conductor.`,
            ],
            shot: 'km-proyeccion',
          },
          {
            tab: 'Ilimitados',
            title: m.tabs.unlimited,
            steps: [`«${m.tabs.unlimited}» reúne los coches que tienen kilómetros ilimitados.`],
            shot: 'km-ilimitados',
          },
        ],
        shots: {
          'km-lecturas': 'La pestaña de lecturas de kilometraje',
          'km-pendientes': 'Los coches con la lectura del mes pendiente',
          'km-proyeccion': 'La proyección de kilómetros a fin de contrato',
          'km-ilimitados': 'Los coches con kilómetros ilimitados',
        },
      },
      incidencias: {
        title: nav.incidents,
        lead: 'Averías, mantenimientos puntuales y peticiones de la flota: abrirlas, seguirlas y cerrarlas.',
        quick: [
          { label: 'Ver lo que sigue pendiente', step: 1 },
          { label: 'Abrir una incidencia', step: 3 },
          { label: 'Cerrar una incidencia', step: 5 },
        ],
        walk: [
          {
            tab: 'Bandeja',
            title: 'Qué hay en la bandeja',
            steps: [
              `Cuatro tipos: «${inc.types.breakdown}», «${inc.types.maintenance}», «${inc.types.tires}» y «${inc.types.general}». Los accidentes tienen su propia bandeja: [[accidentes]].`,
              `Dos pestañas: «${inc.tabOpen}» (abiertas y en curso) y «${inc.tabClosed}». Se entra siempre por lo pendiente.`,
              `La «${inc.columns.priority}» va de «${inc.priorities.critical}» a «${inc.priorities.informative}»; «${inc.columns.vehicleState}» dice si el coche sigue parado.`,
              `Una fila en azul es «${inc.changePending}»: alguien ha pedido cambiar el parte desde la app de campo.`,
            ],
            shot: 'incidencias',
          },
          {
            tab: 'Buscar',
            title: 'Buscar y filtrar',
            steps: [
              `En «${inc.searchLabel}» escribe una matrícula, un tipo o parte de la descripción.`,
              `Acota con «${inc.filterVehicle}», «${inc.filterType}» y «${inc.filterPriority}».`,
              `«${inc.exportCsv}» descarga lo que estás viendo, con los filtros puestos.`,
              `Arriba, «${inc.goAccidents}» y «${inc.goAlerts}» saltan a las otras dos bandejas.`,
            ],
            shot: 'incidencias-filtros',
          },
          {
            tab: 'Nueva',
            title: inc.incidents.newLabel,
            steps: [
              `Pulsa «${inc.incidents.newLabel}».`,
              `Elige el «${inc.form.vehicle}», el «${inc.form.type}» y la «${inc.form.priority}», y escribe la «${inc.form.description}».`,
              `El «${inc.form.postalCode}» sirve para buscar el taller más cercano.`,
              `Termina con «${inc.form.save}». Si además el coche se queda parado, usa mejor el cambio de estado: [[estado]].`,
            ],
            shot: 'incidencias-nueva',
          },
          {
            tab: 'Ver',
            title: inc.view,
            steps: [
              `El ojo de «${inc.columns.actions}» abre la incidencia entera, sin poder tocar nada.`,
              `«${inc.detail.request}»: lo que se pidió. «${inc.detail.resolution}»: cómo se cerró, con el «${inc.detail.workshop}», los «${inc.detail.downtimeLabel}» y quién la cerró.`,
              `Si es de neumáticos, también sale el «${inc.detail.tires}».`,
            ],
            shot: 'incidencias-ver',
          },
          {
            tab: 'Acciones',
            title: 'Cerrar, editar y documentos',
            steps: [
              `El círculo con ✓ es «${inc.resolve}»: abre el formulario de cierre de su tipo ([[resolver]]).`,
              `Si está apagado, hay «${inc.changePending}»: decídelos antes en [[solicitudes]], pestaña «${r.tabIncidents}».`,
              `El lápiz («${inc.edit}») corrige la prioridad, la fecha, el coste o la descripción.`,
              `La carpeta («${inc.documents}») lleva a la ficha del coche, donde se suben las facturas y fotos: [[ficha]].`,
            ],
            shot: 'incidencias-editar',
          },
        ],
        shots: {
          incidencias: 'La bandeja de incidencias abiertas',
          'incidencias-nueva': 'El formulario de nueva incidencia',
          'incidencias-ver': 'La incidencia abierta con el ojo',
          'incidencias-filtros': 'Los filtros de la bandeja de incidencias',
          'incidencias-editar': 'La ventana para editar una incidencia',
        },
        faq: [
          {
            q: '¿Por qué no puedo ponerla en «Cerrada» desde el lápiz?',
            a: `Porque cerrar pide los datos del cierre (coste, kilómetros, factura). Se cierra con «${inc.resolve}».`,
          },
          {
            q: '¿Dónde están las ITV?',
            a: `Una ITV no es una incidencia sino un aviso: está en [[alertas]] y se cita en [[itv-mantenimiento]].`,
          },
          {
            q: '¿Qué diferencia hay con cambiar el estado del coche?',
            a: 'El cambio de estado abre la incidencia Y para el coche, con su sustituto si hace falta ([[estado]]). Aquí solo se abre la incidencia.',
          },
        ],
      },
      resolver: {
        title: 'Resolver alertas e incidencias',
        lead: `Un solo botón, «${inc.resolve}», abre el formulario que toca para cada alerta o incidencia, esté donde esté.`,
        quick: [
          { label: 'Cerrar una avería', step: 2 },
          { label: 'Devolver el coche al servicio', step: 4 },
          { label: 'Resolver un aviso', step: 5 },
        ],
        walk: [
          {
            tab: 'Dónde',
            title: 'Dónde está «Resolver»',
            steps: [
              `«${inc.resolve}» está allí donde ves algo pendiente. En [[panel]], en las tiras de pendientes.`,
              'En las bandejas: [[alertas]], [[incidencias]] y [[accidentes]].',
              `En [[ficha]], en la tarjeta «${rs.pending.title}», y en el menú ⋮ de [[vehiculos]].`,
              'Da igual desde dónde lo abras: para el mismo caso sale siempre el mismo formulario.',
            ],
            shot: 'incidencias',
          },
          {
            tab: 'Qué abre',
            title: 'Un formulario para cada caso',
            steps: [
              `«${inc.types.breakdown}» y «${inc.types.general}»: la reparación, con «${rs.breakdown.confirm}».`,
              `«${inc.types.tires}»: los neumáticos montados y en qué posiciones.`,
              `«${inc.types.maintenance}» o «${a.typeOptions.maintenanceDue}»: el servicio hecho; si hay plan, se vuelve a anclar.`,
              `«${a.typeOptions.itvDue}»: registrar la ITV pasada. «${a.typeOptions.itvUnscheduled}»: abre «${v.schedule.btn}» para citarla.`,
              `Seguro: «${rs.insurance.confirm}», con la nueva fecha de vencimiento.`,
              `«${inc.types.accident}»: la reparación y el siniestro ([[accidentes#4]]).`,
            ],
            shot: 'resolver-averia',
          },
          {
            tab: 'Datos',
            title: 'Los datos del cierre',
            steps: [
              `Rellena «${rs.common.date}», «${rs.common.km}», «${rs.common.cost}» y «${rs.common.observations}».`,
              'Los km se cargan con un clic desde la última lectura del coche: en el taller no rueda.',
              `«${rs.common.postalCode}» trae el de la petición; corrígelo si al final el coche fue a otro sitio.`,
              'Adjunta la factura o el informe aquí mismo: queda guardado en los documentos del coche.',
            ],
            shot: 'resolver-averia',
          },
          {
            tab: 'Volver',
            title: 'Devolver el coche al servicio',
            steps: [
              `Si el coche está parado, sale la casilla «${rs.common.backToService}». Viene marcada cuando está parado por esto mismo (taller, ITV, accidente).`,
              'Si tenía un coche de sustitución, la misma casilla lo deja libre.',
              'Desmárcala si el coche sigue fuera de servicio por otra causa.',
              'Si otra petición del coche sigue abierta, el coche no vuelve a Activo y el aviso dice cuál es.',
            ],
            shot: 'accidentes-resolver',
          },
          {
            tab: 'Avisos',
            title: 'Resolver un aviso',
            steps: [
              `«${a.typeOptions.kmReadingPending}»: «${a.resolveModal.km.confirm}».`,
              `«${a.typeOptions.kmOverage}»: puedes pasar el coche a alguien que ruede menos, con «${a.resolveModal.overage.confirmChange}».`,
              `«${a.typeOptions.noDriver}»: «${rs.noDriver.confirmAssign}», o solo con la nota.`,
              `Los demás se cierran con una «${a.resolveModal.noteLabel}» y «${a.resolveModal.confirm}».`,
            ],
            shot: 'resolver-alerta',
          },
        ],
        shots: {
          'resolver-averia': 'El formulario para resolver una incidencia',
          'resolver-alerta': 'El formulario para resolver un aviso',
          incidencias: 'La bandeja de incidencias, con el botón de resolver en cada fila',
          'accidentes-resolver': 'La casilla para devolver el coche a Activo al resolver',
        },
        faq: [
          {
            q: '¿Por qué el botón de resolver sale apagado?',
            a: `Hay cambios al parte propuestos desde el campo. Se aceptan o rechazan en [[solicitudes]], pestaña «${r.tabIncidents}», y entonces se puede resolver.`,
          },
          {
            q: 'Se guardó, pero dice que no pudo subir el archivo.',
            a: 'La resolución vale igual. Sube el archivo desde [[documentos]] o desde la ficha del coche.',
          },
          {
            q: `¿Qué significa «${a.resolver.automatic}»?`,
            a: `${a.resolver.automaticTip}`,
          },
        ],
      },
      accidentes: {
        title: nav.accidents,
        lead: 'Comunicar un accidente con el parte guiado, seguirlo hasta cerrarlo y borrar a tiempo los datos de terceros.',
        quick: [
          { label: 'Comunicar un accidente', step: 2 },
          { label: 'Cerrar un accidente', step: 4 },
          { label: 'Borrar los datos de terceros', step: 5 },
        ],
        walk: [
          {
            tab: 'Bandeja',
            title: 'La bandeja de accidentes',
            steps: [
              `Funciona como [[incidencias]]: «${inc.tabOpen}» y «${inc.tabClosed}», búsqueda, filtros y «${inc.exportCsv}».`,
              `«${inc.accidents.ageColumn}» dice cuánto lleva abierto el expediente.`,
              'Pasado un año la fila se pone ámbar; a los 18 meses, roja: toca borrar los datos de terceros.',
            ],
            shot: 'accidentes',
          },
          {
            tab: 'Comunicar',
            title: inc.accidents.newLabel,
            steps: [
              `Pulsa «${inc.accidents.newLabel}», elige el coche y «${inc.accidents.pickContinue}».`,
              `También desde el menú ⋮ de [[vehiculos]] → «${v.accident.btn}» → «${v.accident.tabReport}».`,
              'Viene marcada la casilla que pasa el coche a accidentado, es decir, parado. Desmárcala si sigue rodando.',
            ],
            shot: 'accidentes-parte',
          },
          {
            tab: 'Parte',
            title: v.accident.stepsLabel,
            steps: [
              `«${v.accident.stepWhere}»: calle, localidad, «${v.accident.occurredAt}» y teléfono.`,
              `«${v.accident.stepDamage}»: la «${v.accident.damages}».`,
              `«${v.accident.stepPeople}»: ${v.accident.peopleNote.charAt(0).toLowerCase()}${v.accident.peopleNote.slice(1)} ${v.accident.thirdRequiredHint}`,
              `«${v.accident.stepReport}»: la «${v.accident.policeRef}» y el archivo del parte.`,
              `Termina con «${v.accident.submit}».`,
            ],
          },
          {
            tab: 'Seguir',
            title: 'Seguirlo y cerrarlo',
            steps: [
              `La flecha de la fila despliega el «${inc.report.title}»; el ojo abre la incidencia entera.`,
              'El lápiz reabre el mismo parte, con todo lo que tenía, para corregirlo.',
              `«${inc.resolve}» pide «${rs.accident.sectionRepair}», «${rs.accident.sectionClaim}» (el «${rs.accident.claimRef}» y «${rs.accident.liability}») y «${rs.accident.sectionNotes}».`,
              `Con «${rs.accident.totalLoss}», el botón pasa a «${rs.accident.confirmRetire}» y se abre su baja.`,
            ],
            shot: 'accidentes-resolver',
          },
          {
            tab: 'Terceros',
            title: inc.accidents.purge,
            steps: [
              'Los datos de los terceros y de los lesionados se guardan 18 meses (RGPD).',
              `Pasado ese plazo, el botón «${inc.accidents.purge}» de la fila se enciende.`,
              'Se borran nombres, matrículas, teléfonos y aseguradoras de los demás. Se queda dónde, cuándo, el atestado y los daños del coche.',
              'No se puede deshacer: la app pide confirmación.',
            ],
          },
        ],
        shots: {
          accidentes: 'La bandeja de accidentes con la antigüedad de cada uno',
          'accidentes-parte': 'El primer paso del parte de accidente',
          'accidentes-resolver': 'La ventana para cerrar un accidente',
        },
        faq: [
          {
            q: '¿Por qué no puedo borrar todavía los datos de terceros?',
            a: `${inc.accidents.purgeNotYet} Antes, el botón sale apagado.`,
          },
          {
            q: '¿Puedo convertir un accidente en avería?',
            a: 'No: el tipo de un accidente va fijo. Si se abrió por error, ciérralo con una nota y abre la avería en [[incidencias]].',
          },
          {
            q: '¿Dónde subo las fotos y el parte firmado?',
            a: 'En el último paso del parte, o después desde la ficha del coche ([[ficha]]).',
          },
        ],
      },
      alertas: {
        title: nav.alerts,
        lead: 'Los vencimientos y avisos de la flota: agruparlos, ordenarlos y resolverlos.',
        sections: [
          {
            title: 'Qué hay aquí',
            steps: [
              `Avisos con fecha: «${a.typeOptions.itvDue}», «${a.typeOptions.itvUnscheduled}», «${a.typeOptions.kmReadingPending}», «${a.typeOptions.kmOverage}», «${a.typeOptions.maintenanceDue}» y «${a.typeOptions.noDriver}».`,
              `«${a.statusOptions.open}» y «${a.statusOptions.resolved}» separan lo pendiente de lo ya hecho.`,
            ],
            shot: 'alertas',
          },
          {
            title: 'Encontrar lo urgente',
            steps: [
              `Filtra por «${a.filters.type}», «${a.filters.due}» (por ejemplo, «${a.dueOptions.overdue}»), «${a.filters.driver}» o «${a.filters.supervisor}».`,
              `Ordena con «${a.sortDueAsc}» o «${a.sortDueDesc}».`,
              `«${a.groupByDue}» o «${a.groupByType}» las reúne en bloques.`,
            ],
            shot: 'alertas-agrupadas',
          },
          {
            title: 'Atender una alerta',
            steps: [
              `«${a.resolve}» abre el formulario que toca para esa alerta: [[resolver#5]].`,
              `«${a.sendEmail}» escribe un correo sobre ella al conductor o al supervisor.`,
              `«${a.registerItv}», arriba, registra una ITV ya pasada. Para citarla: [[itv-mantenimiento]].`,
              `«${a.goIncidents}» salta a las incidencias ([[incidencias]]).`,
            ],
            shot: 'resolver-alerta',
          },
          {
            title: 'Quién la cerró',
            steps: [
              `En «${a.statusOptions.resolved}» se ven «${a.columns.resolvedAt}», «${a.columns.resolvedBy}» y la «${a.columns.resolutionNote}».`,
              `En verde, si la cerró quien lleva el coche: «${a.resolver.driverMatch}»`,
              `Con un icono de aviso, si la cerró alguien ajeno al coche: conviene comprobarlo.`,
              `«${a.resolver.automatic}»: ${a.resolver.automaticTip.charAt(0).toLowerCase()}${a.resolver.automaticTip.slice(1)}`,
            ],
            shot: 'alertas-resueltas',
          },
        ],
        shots: {
          alertas: 'La lista de alertas abiertas',
          'alertas-agrupadas': 'Las alertas agrupadas por mes de vencimiento',
          'resolver-alerta': 'La ventana para resolver una alerta',
          'alertas-resueltas': 'Las alertas resueltas, con quién cerró cada una',
        },
        faq: [
          {
            q: '¿Quién crea las alertas?',
            a: 'La app, sola, en su repaso diario: con las fechas de ITV, mantenimiento y seguro, las lecturas de km, el exceso de km y los coches sin conductor. No se crean a mano.',
          },
          {
            q: '¿Qué diferencia hay entre una alerta y una incidencia?',
            a: 'Una alerta es un aviso con fecha que da la app; una incidencia es algo que ha pasado y alguien ha comunicado ([[incidencias]]).',
          },
          {
            q: 'He registrado la ITV y la alerta ha desaparecido.',
            a: `Es lo esperado: se cierra sola y sale en «${a.statusOptions.resolved}» como «${a.resolver.automatic}».`,
          },
        ],
      },
      solicitudes: {
        title: nav.requests,
        lead: 'Lo que piden conductores y supervisores, en seis bandejas, para concederlo o rechazarlo.',
        sections: [
          {
            title: 'Las seis bandejas',
            steps: [
              `«${r.tabVehicles}»: alguien necesita coche, uno de sustitución porque el suyo está parado o uno porque no tiene.`,
              `«${r.tabDocuments}»: piden algo sobre un documento que ya existe, como verlo, corregirlo o borrarlo.`,
              `«${r.tabSupply}»: falta un papel y alguien lo ha pedido.`,
              `«${r.tabDrivers}»: proponen otro conductor para un coche.`,
              `«${r.tabProfiles}»: alguien pide corregir sus datos personales.`,
              `«${r.tabIncidents}»: proponen cambiar el parte de una incidencia; mientras, no se puede resolver ([[resolver]]).`,
            ],
            shot: 'solicitudes',
          },
          {
            title: 'Decidir',
            steps: [
              `Marca «${r.statusPending}» para ver solo lo que espera una decisión.`,
              `En «${r.tabVehicles}»: «${r.helpGrant}» ${r.helpGrantRest} «${r.helpReject}» ${r.helpRejectRest}`,
              `En las bandejas de documentos, cada petición se gestiona en dos pestañas: «${r.manage.tabDecide}» y «${r.manage.tabDocs}».`,
            ],
            note: 'La llave de la cabecera cuenta lo que está sin decidir y te trae directamente a la bandeja que tiene algo.',
            shot: 'solicitudes-gestionar',
          },
          {
            title: 'Filtrar',
            steps: [
              `Busca por persona, matrícula o texto, y marca «${r.statusPending}», «${r.statusAssigned}» o «${r.statusRejected}».`,
              `En «${r.tabVehicles}», «${r.originLabel}» separa «${r.originSubstitute}» de «${r.originNoVehicle}».`,
            ],
            shot: 'solicitudes-filtros',
          },
        ],
        shots: {
          solicitudes: 'La bandeja de solicitudes con sus seis pestañas',
          'solicitudes-gestionar': 'La ventana para gestionar una petición de documento',
          'solicitudes-filtros': 'Los filtros de estado y de origen, y cómo se decide',
        },
        faq: [
          {
            q: '¿Quién hace estas solicitudes?',
            a: 'Los conductores y supervisores, desde la app de campo. Desde aquí solo se deciden.',
          },
          {
            q: `¿Qué hace exactamente «${r.helpGrant}»?`,
            a: `«${r.helpGrant}» ${r.helpGrantRest} «${r.helpReject}» ${r.helpRejectRest}`,
          },
          {
            q: '¿Cómo aviso por correo a quien lo pidió?',
            a: 'Con las plantillas de correo de la app: [[correo]].',
          },
        ],
      },
      documentos: {
        title: nav.documents,
        lead: 'Quién puede leer cada tipo de documento, y el listado de los papeles de la flota y de las personas.',
        quick: [
          { label: 'Decidir quién ve cada tipo de papel', step: 1 },
          { label: 'Buscar un documento', step: 2 },
          { label: 'Cambiar el acceso de un solo documento', step: 3 },
        ],
        walk: [
          {
            tab: 'Por tipo',
            title: d.settings.title,
            steps: [
              `Entra en la pestaña «${d.tabs.settings}». Hay una fila por tipo de documento.`,
              `«${d.settings.adminColumn}» lo lee siempre. En «${d.settings.supervisorColumn}» marcas «${d.settings.supervisorReads}».`,
              `Para los conductores, «${d.settings.listColumn}» va de «${d.settings.driverOptions.none}» a «${d.settings.driverOptions.all}».`,
              `«${d.settings.viewColumn}», «${d.settings.downloadColumn}» y «${d.settings.deletionColumn}» pueden ser «${d.settings.actionOptions.allow}», «${d.settings.actionOptions.request}» o «${d.settings.actionOptions.deny}».`,
              `Pulsa «${d.settings.save}».`,
            ],
            shot: 'documentos-ajustes',
          },
          {
            tab: 'Listado',
            title: 'Encontrar un documento',
            steps: [
              `En «${d.tabs.documents}», elige el tipo arriba o deja «${d.allTypes}».`,
              `«${d.statusSummary}» resume cuántos hay en cada estado; pulsa uno para ver solo esos.`,
              `Filtra por «${d.userFilterLabel}» o «${d.uploaderFilterLabel}», o marca «${d.groupByPlate}».`,
              `«${d.newDocument}» sube uno nuevo para un coche o una persona.`,
            ],
            shot: 'documentos-lista',
          },
          {
            tab: 'Un documento',
            title: 'El acceso de un solo documento',
            steps: [
              `En su fila, el botón de acceso abre «${d.access.modal.title('…')}».`,
              `Cada permiso puede quedarse en «${d.access.modal.inheritShort}» o cambiarse solo para ese documento.`,
              `Los que se cambian salen marcados «${d.access.adjusted}» en el listado.`,
            ],
            shot: 'documentos-acceso',
          },
        ],
        shots: {
          'documentos-ajustes': 'Quién lee cada tipo de documento',
          'documentos-lista': 'El listado de documentos con su resumen por estado',
          'documentos-acceso': 'La ventana de acceso de un documento',
        },
        faq: [
          {
            q: `¿Qué pasa con «${d.settings.actionOptions.request}»?`,
            a: `El conductor lo pide y la petición llega a «${nav.requests}», donde se concede o se rechaza.`,
          },
        ],
      },
      usuarios: {
        title: nav.drivers,
        lead: 'Las personas de la app: sus roles, los coches que han tenido y sus documentos personales.',
        sections: [
          {
            title: 'Encontrar a alguien',
            steps: [
              'Las pestañas de arriba separan a las personas por su rol.',
              `En «${u.toolsToggle}» buscas por nombre, usuario o email, y filtras por «${u.roleFilterLabel}» o «${u.lblCreated}».`,
              `Las cuentas desactivadas no salen: marca «${u.showInactive}» para verlas.`,
            ],
            shot: 'usuarios',
          },
          {
            title: 'Dar de alta y cambiar',
            steps: [
              `«${u.newUser}» crea una persona; «${u.importBtn}» crea muchas de una vez.`,
              `En su fila, «${u.edit}» cambia sus datos y sus roles; «${u.deactivate}» le quita el acceso y «${u.reactivate}» se lo devuelve.`,
              `«${u.ownTitle}» enseña las cuentas que no se pueden desactivar: la tuya y la del sistema.`,
            ],
            shot: 'usuario-nuevo',
          },
          {
            title: 'La ficha de una persona',
            steps: [
              'Pulsa su nombre para ver los coches que ha tenido y sus documentos personales.',
              'Si es supervisor, la ficha enseña también su grupo.',
            ],
            shot: 'usuario-ficha',
          },
        ],
        shots: {
          usuarios: 'La lista de usuarios con sus pestañas por rol',
          'usuario-nuevo': 'La ventana para dar de alta un usuario',
          'usuario-ficha': 'La ficha de una persona',
        },
      },
      correo: {
        title: 'Enviar correo',
        lead: 'El asistente para mandar un correo sobre un coche: tipo, contenido, destinatarios y vista previa.',
        shots: {
          'correo-1': 'El primer paso del correo: el tipo y lo ya enviado',
          'correo-2': 'El contenido del correo',
          'correo-3': 'Los destinatarios del correo',
          'correo-4': 'La vista previa del correo antes de enviarlo',
        },
        quick: [
          { label: 'Mandar un aviso ya, sin retocarlo', step: 1 },
          { label: 'Cambiar el texto antes de enviarlo', step: 2 },
          { label: 'Mandarlo a otra dirección', step: 3 },
          { label: 'Ver cómo queda antes de enviarlo', step: 4 },
        ],
        walk: [
          {
            tab: v.email.typeLabel,
            title: 'De qué avisa el correo',
            steps: [
              `Abre el asistente con «${v.email.btn}»: está en el menú ⋮ de [[vehiculos]] y en [[ficha]]. En [[alertas]], cada fila tiene «${a.sendEmail}».`,
              `En «${v.email.typeLabel}» elige de qué avisa. Debajo salen los datos del coche que lo justifican.`,
              `«${v.email.quickSend}» lo manda en el momento, con su plantilla y a sus destinatarios habituales. Sale de verdad: no hay vista previa ni confirmación.`,
              `Más abajo, «${v.email.activityAlerts}»: cada uno tiene su «${v.email.quickSendAlert}», y si hay varios, «${withN(v.email.sendAll)}» los manda todos.`,
              `«${v.email.activitySent}» enseña lo que ya se ha mandado, para no avisar dos veces.`,
            ],
            shot: 'correo-1',
          },
          {
            tab: v.email.stepContent,
            title: 'Qué dice',
            steps: [
              `«${v.email.useTemplate}» viene marcado. Si lo quitas, se envía solo lo que escribas.`,
              `En «${v.email.langLabel}» elige «${v.email.langEs}», «${v.email.langEn}» o «${v.email.langBoth}».`,
              `«${v.email.bodyLabel}» es el texto de la plantilla y se puede retocar. El cambio vale solo para este envío: la plantilla sigue igual ([[ajustes]]).`,
              `«${v.email.bodyReset}» deshace tus retoques.`,
              `«${v.email.extraMessage}» añade un texto tuyo al de la plantilla.`,
            ],
            shot: 'correo-2',
          },
          {
            tab: v.email.recipients,
            title: 'A quién va',
            steps: [
              `Marca «${v.email.toAdmin}», «${v.email.toDriver}» o «${v.email.toSupervisor}»: puede ir a varios a la vez.`,
              `«${v.email.toRenting}» solo sale en el aviso de seguro.`,
              `En «${v.email.toOther}» escribes una dirección suelta.`,
              'Tiene que haber al menos un destinatario para seguir.',
            ],
            shot: 'correo-3',
          },
          {
            tab: v.email.preview,
            title: 'Cómo queda, y enviar',
            steps: [
              `Con «${v.ops.next}» llegas a «${v.email.preview}»: el «${v.email.subjectLabel}» y el correo entero, tal como lo verá quien lo reciba.`,
              `Si algo no está bien, vuelve con «${v.ops.back}» y cámbialo.`,
              `«${v.email.send}» aparece solo en este último paso. Al pulsarlo, el correo sale: no se puede deshacer.`,
              `Al terminar, la ventana dice a quién se ha enviado y a quién no.`,
            ],
            shot: 'correo-4',
          },
        ],
        faq: [
          {
            q: '¿Puedo mandar un correo sin plantilla?',
            a: `Sí: quita «${v.email.useTemplate}» y escribe el mensaje. Sin plantilla, el mensaje no puede ir vacío.`,
          },
          {
            q: 'He cambiado el texto de un correo, ¿he cambiado la plantilla?',
            a: 'No. Lo que retocas en el asistente vale para ese envío. Las plantillas se cambian en [[ajustes]].',
          },
          {
            q: '¿Cómo sé si ya se avisó de algo?',
            a: `En el primer paso, «${v.email.activitySent}» lista los últimos envíos del coche, y cada aviso abierto dice cuándo se mandó su último correo.`,
          },
        ],
      },
      informes: {
        title: 'Informes y facturas',
        lead: 'Descargar los datos de vehículos y personas, y llevar las facturas.',
        walk: [
          {
            tab: rp.tabs.downloads,
            title: 'Descargar datos',
            steps: [
              `En «${rp.downloads.kindLabel}» elige qué quieres bajar: vehículos (todo en un único Excel) o usuarios.`,
              `Ajusta los filtros para quedarte con lo que necesitas; «${rp.downloads.clearFilters}» los quita todos.`,
              `Pulsa «${rp.downloads.preview}» para ver lo que vas a bajar antes de descargarlo.`,
              `Descárgalo con «${rp.downloads.downloadXlsx}» o con «${rp.downloads.downloadCsv}».`,
            ],
            shot: 'informes-descargas',
          },
          {
            tab: rp.tabs.invoices,
            title: 'Las facturas',
            steps: [
              `Entra en la pestaña «${rp.tabs.invoices}»: lista las facturas de la flota. Filtra por vehículo para ver las de un coche.`,
              `«${inv.newInvoice}» registra una factura; «${inv.exportCsv}» descarga el listado.`,
              `Las de un coche concreto también se llevan desde su menú ⋮ en [[vehiculos]] → «${v.invoices.btn}».`,
            ],
            shot: 'informes-facturas',
          },
        ],
        shots: {
          'informes-descargas': 'La pestaña de descargas de informes',
          'informes-facturas': 'La lista de facturas de la flota',
        },
      },
      ajustes: {
        title: nav.settings,
        lead: 'Los catálogos, el borrado definitivo y las plantillas de correo.',
        sections: [
          {
            title: aj.tabs.catalogs,
            steps: [
              `«${aj.tabs.catalogs}» guarda las listas que usa el resto de la app: proyectos, rentings, marcas, modelos, sedes, programas de mantenimiento…`,
              'Lo que se da de alta aquí aparece luego en los desplegables de las fichas.',
            ],
            shot: 'ajustes-catalogos',
          },
          {
            title: aj.tabs.deletions,
            steps: [
              'Aquí acaba lo que se desactiva o se da de baja: coches, personas y demás registros.',
              `«${er.restore}» lo devuelve tal como estaba.`,
              `«${er.purge}» lo borra para siempre. Antes avisa: «${er.cascadeIntro}»`,
            ],
            note: `«${er.purge}» solo lo puede hacer el superusuario y no tiene vuelta atrás.`,
            shot: 'ajustes-borrado',
          },
          {
            title: aj.tabs.templates,
            steps: [
              `«${aj.tabs.templates}» tiene los últimos envíos, la configuración de los recordatorios y avisos, y el texto de cada tipo de correo.`,
            ],
            shot: 'ajustes-plantillas',
          },
        ],
        shots: {
          'ajustes-catalogos': 'Los catálogos de la app',
          'ajustes-borrado': 'El espacio de borrado definitivo',
          'ajustes-plantillas': 'Las plantillas de correo',
        },
      },
      hse: {
        title: 'Vista HSE',
        lead: 'La vista de solo lectura para prevención: los coches, sus lecturas y su informe.',
        sections: [
          {
            title: 'De un vistazo',
            steps: [
              `Cuatro cifras: «${h.stats.vehicles}», «${h.stats.readings}», «${h.stats.fuel}» y «${h.stats.stale}». Pulsa una para ver qué coches son.`,
              'Aquí no se cambia nada: es solo de lectura.',
            ],
            shot: 'hse',
          },
          {
            title: 'Las pestañas',
            steps: [
              `«${h.tabs.vehicles}»: cada coche con sus lecturas; despliega una fila para ver la evolución de km y consumo. «${h.includeStopped}» suma los que están parados.`,
              `«${h.tabs.reports}»: el informe de HSE, con el resumen, los vehículos y el kilometraje.`,
            ],
            shot: 'hse-informe',
          },
        ],
        shots: {
          hse: 'La vista HSE con sus cuatro cifras',
          'hse-informe': 'El informe de HSE',
        },
      },
      preguntas: {
        title: 'Preguntas frecuentes',
        lead: 'Las dudas que llegan con más frecuencia.',
        faq: [
          {
            q: 'He dado de baja un coche por error, ¿lo he perdido?',
            a: `No. «${v.deactivate}» no borra nada: el coche se reactiva en «${nav.settings}», en la pestaña de borrado definitivo.`,
          },
          {
            q: '¿Por qué no me sale «Eliminar definitivamente»?',
            a: 'Borrar para siempre solo lo puede hacer el superusuario. El resto de la administración puede restaurar.',
          },
          {
            q: '¿Por qué no puedo desactivar mi cuenta?',
            a: `En «${nav.drivers}», ni tu propia cuenta ni la del sistema se pueden desactivar.`,
          },
          {
            q: `¿Por qué no veo el botón «${app.shell.hse.button}»?`,
            a: 'Solo sale a quien tiene el rol HSE.',
          },
          {
            q: '¿Dónde están las facturas?',
            a: `En «${nav.reports}», en su pestaña de facturas. Y las de un coche, en su menú ⋮.`,
          },
          {
            q: 'Al importar, una fila sale en errores aunque parece correcta.',
            a: 'La sociedad, el proyecto, el CECO, el supervisor y el conductor tienen que existir ya en la app.',
          },
        ],
      },
    },
  }
}

const en = (ui: Ui): TutorialCopy => {
  const { app, vehicles: v, bulk: bk, schedule: s, mileage: m, alerts: a, requests: r } = ui
  const { users: u, reports: rp, invoices: inv, ajustes: aj, erratas: er, hse: h, documents: d } = ui
  const { vehicleDetail: vd, vehicleForm: vf, resolve: rs, incidents: inc } = ui
  const nav = app.shell.nav
  const home = app.home
  return {
    ui: {
      title: app.shell.nav.help,
      subtitle: 'How to use the management app, screen by screen',
      indexLabel: 'Help chapters',
      search: 'Search the help',
      searchPlaceholder: 'For example: export, replacement, inspection…',
      results: (n) => (n === 1 ? '1 result' : `${n} results`),
      noResults: (q) => `Nothing matches “${q}”.`,
      coverTitle: 'Welcome to the help',
      coverText:
        'Each chapter explains one screen or one task of the management app. Pick one from the index or search for what you need.',
      chaptersCount: (n) => (n === 1 ? '1 chapter' : `${n} chapters`),
      openScreen: 'Open this screen',
      quickTitle: 'What do you want to do?',
      walkLabel: 'Step-by-step walkthrough',
      stepOf: (i, n) => `Step ${i} of ${n}`,
      back: 'Back',
      next: 'Continue',
      prevChapter: 'Previous',
      nextChapter: 'Next',
      faqTitle: 'Frequent questions',
      pending: 'This chapter is being written: for now, only its summary.',
      shotPending: 'Screenshot pending',
      zoom: 'Enlarge the screenshot',
      backToScreen: 'Back to the screen',
      pagerLabel: 'Previous and next chapter',
      soon: 'Soon',
      read: 'Read',
      tasksTitle: 'Common tasks',
      start: 'Start from the beginning',
      resume: 'Pick up where you left off',
      progress: (seen, n) => `You have opened ${seen} of ${n} chapters`,
      moreFaq: 'More questions, by chapter',
      clearSearch: 'Clear the search',
      downloadsTitle: 'Example files',
      watchVideo: 'Watch the introduction video',
      videoFallback: 'Your browser cannot play this video. Below is what it says, scene by scene.',
      videoLangHint: `Want it in Spanish? Change the language at the bottom of the menu (“${app.shell.language}”): the help and the video both change.`,
      videoScenesTitle: 'What is in the video',
      videoScenesHint: 'Press the time to jump to that scene, or the chapter name to see it step by step.',
      videoSeek: (time) => `Go to ${time} in the video`,
      headerHint: `From any screen, the “?” button in the header (“${app.shell.helpHere}”) opens its chapter.`,
    },
    groups: {
      intro: 'Introduction',
      start: 'First steps',
      fleet: 'The fleet',
      events: 'What happens',
      papers: 'Papers and people',
      admin: 'Administration',
      other: 'Other',
    },
    audience: { superuser: 'Superuser only', hse: 'Requires the HSE role' },
    chapters: {
      video: {
        title: 'Introduction video',
        lead: 'The management app in a minute and a half, screen by screen. No sound: the text is in the video.',
      },
      entrar: {
        title: 'Signing in and finding your way',
        lead: 'How to sign in, what the header holds and how to reach each screen quickly.',
        quick: [
          { label: 'Sign in to the app', step: 1 },
          { label: 'See alerts and requests', step: 2 },
          { label: 'Change language or sign out', step: 3 },
        ],
        walk: [
          {
            tab: 'Sign in',
            title: 'Signing in',
            steps: [
              `Open the app: the first thing you see is “${app.login.heading}”.`,
              `Type your “${app.login.userLabel}” and your “${app.login.passwordLabel}”, and press “${app.login.submit}”.`,
              'Once in, you land on [[panel]]. If you cannot get in, ask an administrator to check your account and your roles.',
            ],
            shot: 'login',
          },
          {
            tab: 'Header',
            title: 'The header',
            steps: [
              'The header is always at the top, on every screen.',
              `Press the bell (“${app.shell.notifications}”) to see the latest alerts and incidents, each under its own tab: “${app.shell.bell.alerts}” and “${app.shell.bell.incidents}”.`,
              'The key with a number shows up when there are requests waiting for a decision. Press it and it takes you to the first tray with something pending ([[solicitudes]]).',
              `The “?” button (“${app.shell.helpHere}”) opens the chapter of this help that explains the screen you are on.`,
              `The “${app.shell.hse.button}” button opens [[hse]]. You only see it if you have that role.`,
            ],
            shot: 'cabecera',
          },
          {
            tab: 'Menu',
            title: 'The menu',
            steps: [
              `Press “${app.shell.menu}” in the header to see every screen of the app.`,
              `They are grouped into “${app.shell.navGroups.general}”, “${app.shell.navGroups.fleet}”, “${app.shell.navGroups.tracking}” and “${app.shell.navGroups.admin}”. Press a screen to go to it.`,
              `At the bottom of the menu you can change the language (“${app.shell.language}”): the whole app changes, and so does this help.`,
              `To leave, press “${app.shell.logout}”, also at the bottom of the menu.`,
            ],
            shot: 'menu',
          },
        ],
        shots: {
          login: 'The sign-in screen',
          cabecera: 'The header with the bell, the requests key and the menu',
          menu: 'The open menu with its groups',
        },
      },
      panel: {
        title: home.title,
        lead: 'The fleet at a glance: the figures, what is about to expire and what is pending.',
        quick: [
          { label: 'See the fleet figures', step: 1 },
          { label: 'Deal with what is pending', step: 2 },
          { label: 'Find a car or a person', step: 3 },
          { label: 'Add a vehicle or a user', step: 4 },
        ],
        walk: [
          {
            tab: 'Figures',
            title: 'The figures',
            steps: [
              `At the top there are three counters: “${home.statVehicles}”, “${home.statAlerts}” and “${home.statIncidents}”.`,
              `Below, six indicators: “${home.kpiVehicles}”, “${home.kpiUse}”, “${home.kpiCost}”, “${home.kpiItv}”, “${home.kpiInsurance}” and “${home.kpiMaintenance}”.`,
              'Press any indicator to open its window: there you see the detail car by car and can act on each one.',
            ],
            shot: 'panel-indicadores',
          },
          {
            tab: 'Pending',
            title: 'What is pending',
            steps: [
              `“${home.alertsTitle}” and “${home.incidentsTitle}” are two strips that gather what needs attention.`,
              'Press one of the badges on a strip to see only that type.',
              'Press the strip to open the full list. Each item is resolved from there: [[resolver]].',
            ],
            shot: 'panel-pendientes',
          },
          {
            tab: 'Search',
            title: 'Searching the fleet',
            steps: [
              `The table below changes with the tab you pick: “${home.tabs.fleet}”, “${home.tabs.substitute}”, “${home.tabs.supervisors}” or “${home.tabs.drivers}”.`,
              `Open “${home.toolsToggle}” to search and filter.`,
              `In that same panel, “${home.exportCsv}” downloads the table.`,
              'Press the plate of a car to open [[ficha]].',
            ],
            shot: 'panel',
          },
          {
            tab: 'Add',
            title: 'Quick additions',
            steps: [
              `To add from here, use “${home.addVehicle}” or “${home.addDriver}”, in the header of the screen.`,
              `Before taking you to its screen, the app warns you (“${home.addConfirmTitle}”): press “${home.addConfirmGo}” to go on.`,
              'Adding is explained step by step in [[alta]] (vehicles) and in [[usuarios]] (people).',
            ],
            shot: 'panel-altas',
          },
        ],
        shots: {
          'panel-indicadores': 'The six indicators of the overview',
          'panel-pendientes': 'The strips of pending alerts and incidents',
          panel: 'The overview table with its tabs',
          'panel-altas': 'The overview header with its add buttons',
        },
      },
      vehiculos: {
        title: v.title,
        lead: 'The fleet inventory: find a car, export lists and act on it without opening its page.',
        quick: [
          { label: 'Find a car', step: 1 },
          { label: 'Choose the columns', step: 2 },
          { label: 'See what is about to expire', step: 3 },
          { label: 'Export a list', step: 4 },
          { label: 'See the replacement cars', step: 5 },
          { label: 'Do something with a car', step: 6 },
        ],
        walk: [
          {
            tab: 'Search',
            title: 'Find a car',
            steps: [
              `Choose “${v.tabFleet}” or “${v.tabSubstitute}”. The number on each tab is how many there are.`,
              `Open “${v.toolsToggle}” and type the plate, make or model in “${v.lblSearch}”.`,
              `To narrow it down, use “${v.lblState}”, “${v.lblSupervisor}”, “${v.lblDriver}” or “${v.lblCreated}”.`,
              `“${v.stateHasSubstitute}” shows the cars that currently have a replacement.`,
            ],
            shot: 'vehiculos-filtros',
          },
          {
            tab: 'Table',
            title: 'Reading the table',
            steps: [
              'Each row is a car. Press its plate to open [[ficha]].',
              `The mileage cell says how long it has gone without a reading (“${v.kmNoReading}”, “${withN(v.kmStale)}”), with a traffic-light colour.`,
              'Dates in amber or red are due soon or already overdue.',
              `In “${v.toolsToggle}”, “${v.lblColumns}” chooses which columns you see and in what order (“${v.colMoveUp}”, “${v.colMoveDown}”).`,
            ],
            shot: 'vehiculos-columnas',
          },
          {
            tab: 'Due dates',
            title: 'See what is about to expire',
            steps: [
              `Tick one or more cuts: “${v.dueItv}”, “${v.dueInsurance}”, “${v.dueMaint}” or “${v.kmOver}”.`,
              'If you tick several, you get the cars that match any of them.',
              `“${v.clearFilters}” puts everything back as it was.`,
            ],
            shot: 'vehiculos-cortes',
          },
          {
            tab: 'Lists',
            title: 'Export a list',
            steps: [
              'Leave in the table only what you want to export: apply the filters, the cuts and the columns from the previous steps.',
              `Press “${v.exportCsv}”. “${v.exportTitle}” opens: ${v.exportIntro}`,
              `Press “${v.exportRun}” to download the file.`,
            ],
            shot: 'vehiculos-exportar',
          },
          {
            tab: 'Replacement',
            title: 'Replacement cars',
            steps: [
              `“${v.tabSubstitute}” lists the spare cars and says whether each one is “${v.free}” or “${v.busy}”.`,
              `In “${v.tabFleet}”, the arrow on a row expands the car covering it: “${v.subRow}”, ${v.subRowSince('…').toLowerCase()}`,
              `A free replacement can join the fleet with “${vf.convertBtn}”. The app warns you first.`,
              'To give a replacement to another car, follow [[estado]].',
            ],
            shot: 'vehiculos-sustitucion',
          },
          {
            tab: 'Actions',
            title: 'Do something with a car',
            steps: [
              'Press the three dots ⋮ at the end of the row of the car: its actions menu opens.',
              `To notify or book: “${v.email.btn}” ([[correo]]) and “${v.schedule.btn}” ([[itv-mantenimiento]]).`,
              `If something happened to it: “${v.accident.btn}” ([[accidentes]]) and “${rs.pending.title}” ([[estado]] and [[resolver]]).`,
              `For its data: “${v.kmFuel.btn}” ([[kilometraje]]), “${v.invoices.btn}” ([[informes#2]]) and “${v.edit}” ([[alta#6]]).`,
              `“${v.deactivate}” does not delete the car: it keeps its history, invoices and documents, and it can be reactivated in [[ajustes]].`,
            ],
            shot: 'vehiculos-menu',
          },
        ],
        shots: {
          vehiculos: 'The vehicle list with its two tabs',
          'vehiculos-filtros': 'The search and filter panel, open',
          'vehiculos-columnas': 'The drop-down to choose the columns',
          'vehiculos-cortes': 'The due-date cuts, ticked',
          'vehiculos-exportar': 'The window to export to CSV',
          'vehiculos-sustitucion': 'The replacement vehicles tab',
          'vehiculos-menu': 'The actions menu of a car',
        },
        faq: [
          {
            q: 'Why can’t I find a car I retired?',
            a: `Retired cars are hidden by default: tick “${v.showBajas}”.`,
          },
          {
            q: 'Where are the replacement cars?',
            a: `In their own tab, “${v.tabSubstitute}”.`,
          },
        ],
      },
      ficha: {
        title: 'The vehicle page',
        lead: 'Everything about a car on one page: indicators, contract, invoices, documents and its change history.',
        quick: [
          { label: 'See everything about a car', step: 1 },
          { label: 'Know when something is due', step: 2 },
          { label: 'See who changed what', step: 4 },
          { label: 'Undo a change', step: 5 },
        ],
        walk: [
          {
            tab: 'Header',
            title: 'The first thing you see',
            steps: [
              'To open the page of a car, press its plate in [[vehiculos]] or in [[panel]].',
              `At the top you see the plate and its badges: status, driver and supervisor. “${vd.backToVehicles}” takes you back to the list.`,
              `“${vd.monthlyCost}” and “${vd.contractEnd}” can be pressed: each one opens its detail.`,
              `Below are the actions: “${v.email.btn}”, “${vd.editSheet}” and the “${vd.statusLabel}” of the car.`,
            ],
            shot: 'ficha',
          },
          {
            tab: 'Indicators',
            title: 'The indicators',
            steps: [
              `The indicators sum up the dates of the car: “${vd.insuranceExpiry}”, “${vd.nextItv}” and “${vd.nextMaintenance}”. The last two lead to [[itv-mantenimiento]].`,
              `“${vd.pendingKpi}” gathers what the car has open: press it to see it and resolve it ([[estado]], [[resolver]]).`,
              `“${vd.mileage}” and “${vd.fuelAvgTitle}” open the mileage and fuel of the car ([[kilometraje]]).`,
            ],
            shot: 'ficha-indicadores',
          },
          {
            tab: 'Cards',
            title: 'The cards',
            steps: [
              `Each card holds one block of data. “${vd.techTitle}” and “${vd.contractTitle}”: the data of the car and of its contract.`,
              `“${vd.contractedKmTitle}” tells how it is doing on mileage; you can see it in “${vd.annualView}” or “${vd.contractView}” view.`,
              'The other cards: invoices, alerts and incidents, accidents, driver and sharing, and documents.',
              'At the top you can expand or collapse them all at once.',
            ],
            shot: 'ficha-tarjetas',
          },
          {
            tab: 'History',
            title: vd.historyTitle,
            steps: [
              `“${vd.historyTitle}” keeps every change to the car and who made it (“${vd.doneByLabel}”).`,
              `“${vd.historyFilterLabel}” filters by where the change came from; “${withN(vd.showFullHistory)}” shows them all.`,
              'The chart by day is only visible to the administration: press a day to see its changes.',
            ],
            shot: 'ficha-historico',
          },
          {
            tab: 'Undo',
            title: 'Undo a change',
            steps: [
              `Some changes in the history have “${vd.revertBtn}”: only the ones that can be undone.`,
              `It asks for confirmation: “${vd.revertTitle}” → “${vd.revertConfirm}”.`,
              vd.revertDone,
            ],
          },
        ],
        shots: {
          ficha: 'The header of a vehicle page',
          'ficha-indicadores': 'The indicators of the vehicle page',
          'ficha-tarjetas': 'The data cards of the vehicle page',
          'ficha-historico': 'The vehicle’s change history',
        },
      },
      alta: {
        title: 'Adding and editing a vehicle',
        lead: 'Add a fleet or replacement car, and change its data with the lock on sensitive fields.',
        quick: [
          { label: 'Add a car', step: 1 },
          { label: 'Set the driver and supervisor', step: 4 },
          { label: 'Change a field', step: 6 },
          { label: 'Change the plate or the VIN', step: 6 },
        ],
        walk: [
          {
            tab: 'Start',
            title: 'What car it is',
            steps: [
              `Press “${v.newVehicle}” in [[vehiculos]], or “${home.addVehicle}” in [[panel]].`,
              `Under “${vf.typeSectionTitle}” choose “${vf.fleetOption}” or “${vf.substituteOption}”. The type is fixed once the car is created.`,
              `Fill in “${vf.fixedTitle}”, which always stays at the top: “${vf.plate}”, “${vf.vin}” and “${vf.registrationDate}”.`,
              'If you have many cars to add at once, [[importar]] is quicker.',
            ],
            shot: 'alta-tipo',
          },
          {
            tab: vf.identificationTitle,
            title: vf.identificationTitle,
            steps: [
              `Choose the “${vf.brand}” and then the “${vf.model}”.`,
              `If the model is not there, “${vf.newModelButton}” adds it to that make.`,
              `Press “${vf.nextTab}”.`,
            ],
            shot: 'alta-1',
          },
          {
            tab: vf.technicalTitle,
            title: vf.technicalTitle,
            steps: [
              `Fill in the technical data of the car: “${vf.fuel}”, “${vf.segment}”, “${vf.consumption}”…`,
              `“${vf.kmStart}”: ${vf.kmStartNote}`,
              `Press “${vf.nextTab}” to go on.`,
            ],
            shot: 'alta-2',
          },
          {
            tab: vf.usageTitle,
            title: vf.usageTitle,
            steps: [
              `Choose the “${vf.businessUse}” and, if the car belongs to a project, the “${vf.project}”.`,
              `Assign the “${vf.driver}” and the “${vf.supervisor}”, and set the “${vf.costCenter}”.`,
              `Tick “${vf.multiuser}” if several people share it.`,
              'A replacement car does not have this tab.',
            ],
            shot: 'alta-3',
          },
          {
            tab: vf.propertyTitle,
            title: vf.propertyTitle,
            steps: [
              `Set “${vf.property}”, “${vf.company}” and “${vf.insuranceExpiry}”.`,
              `If it is a renting car, also fill in “${vf.rentingCompany}”, “${vf.monthFee}”, “${vf.contractStart}”… ${vf.contractCreateNote}`,
              `Tick “${vf.unlimitedKm}” if the contract has no mileage limit.`,
              `The footer of the screen warns you while there are “${vf.unsavedChanges}”. To finish, press “${vf.createVehicle}”: it only shows on this last tab.`,
            ],
            shot: 'alta-4',
          },
          {
            tab: 'Edit',
            title: 'Editing an existing car',
            steps: [
              `Open the editor from ⋮ → “${v.edit}” in [[vehiculos]], or with “${vd.editSheet}” in [[ficha]].`,
              `The data that identify the car are “${vf.lockClosed}”. To change them, press the lock: the app warns you (“${vf.unlockTitle}”) and you have to confirm with “${vf.unlockConfirm}”.`,
              `Before saving, “${vf.reviewChanges}” shows the before and after of each field.`,
              `If it is right, press “${vf.saveChanges}”; if not, “${vf.keepEditing}”.`,
            ],
            shot: 'editar-candado',
          },
        ],
        shots: {
          'alta-tipo': 'Adding a vehicle: type and fixed data',
          'alta-1': 'The vehicle identification tab',
          'alta-2': 'The technical features tab',
          'alta-3': 'The use and assignment tab',
          'alta-4': 'The ownership and contract tab',
          'editar-candado': 'Editing a vehicle with the lock on sensitive fields',
        },
      },
      importar: {
        title: 'Bulk import',
        lead: 'Add or update many vehicles or people at once, from an Excel or CSV file.',
        quick: [
          { label: 'Add many cars or people', step: 1 },
          { label: 'Change one field on many cars', step: 2 },
          { label: 'See which rows fail and why', step: 3 },
        ],
        walk: [
          {
            tab: 'File',
            title: 'Choose the file',
            steps: [
              `In “${nav.vehicles}” or “${nav.drivers}”, press “${v.importBtn}”.`,
              `“${bk.dropTitle}”. An Excel (.xlsx) or CSV file works, with the first row as the header.`,
              'The app counts the rows it has read and reports the empty ones it skips.',
              `Press “${bk.next}”.`,
            ],
            shot: 'importar-1',
          },
          {
            tab: 'Columns',
            title: 'Say what each column is',
            steps: [
              'Each app field is paired with a column of your file. If the headers are the usual ones, they pair up on their own.',
              `Whatever you leave as “${bk.unassigned}” is not touched.`,
              'If a plate already exists, its data is updated with the file (only what changes). To change one field on many cars, pair only the plate and that field.',
              `Press “${bk.validate}”.`,
            ],
            shot: 'importar-2',
          },
          {
            tab: 'Review',
            title: 'Review before importing',
            steps: [
              `The preview separates “${bk.tabNew}” and “${bk.tabErrors}”, and says how many will be created and how many updated.`,
              `In “${bk.tabErrors}” you see the row, the field and the reason. “${bk.downloadErrors}” downloads them so you can fix your file.`,
              `When it is right, press “${withN(bk.importN)}”.`,
            ],
            shot: 'importar-3',
          },
          {
            tab: 'Import',
            title: 'While it imports',
            steps: [
              'A bar counts the processed rows: created, updated, unchanged and failed.',
              `“${bk.stop}” stops halfway. What has already been created stays.`,
              `At the end, “${bk.downloadResults}” downloads what was done with each row.`,
            ],
          },
        ],
        shots: {
          'importar-1': 'The first import step: choosing the file',
          'importar-2': 'The file columns paired with the app fields',
          'importar-3': 'The preview with the new records and the errors',
        },
        sections: [
          {
            title: 'What the file must look like',
            steps: [
              'The first row is the header. Empty rows are skipped.',
              'In a CSV, the separator can be a semicolon, a comma or a tab: it is detected automatically. The encoding, UTF-8.',
              'Dates, as 2027-01-31 or as 31/01/2027.',
              'For yes or no, write “sí” or “no”.',
              'What is a dropdown in the app is written by its name: “Diésel”, “Renting”.',
              'For people, roles are separated by commas: conductor, supervisor.',
            ],
            note: 'The example files below already have this format: download one and change its data.',
          },
        ],
        downloads: [
          { label: 'Adding vehicles', file: 'vehiculos.csv' },
          { label: 'Updating a few fields of vehicles that already exist', file: 'vehiculos-actualizacion.csv' },
          { label: 'Adding people', file: 'conductores.csv' },
        ],
        faq: [
          {
            q: 'Why does a row that looks right appear under errors?',
            a: 'The company, project, cost centre, supervisor and driver are looked up by name in the app: they must already exist.',
          },
          {
            q: 'If I import the same file twice, is anything duplicated?',
            a: 'No. What already exists is updated or left unchanged.',
          },
        ],
      },
      estado: {
        title: 'Changing the status and the replacement car',
        lead: 'Take a car off the road for a breakdown, maintenance or tyres, and give it a replacement meanwhile.',
        quick: [
          { label: 'Send a car to the garage', step: 1 },
          { label: 'Give it a replacement car', step: 3 },
          { label: 'Change the tyres', step: 4 },
          { label: 'Tell the driver', step: 6 },
        ],
        walk: [
          {
            tab: 'Status',
            title: v.ops.stateSection,
            steps: [
              `In [[vehiculos]], open the ⋮ menu of the car → “${rs.pending.title}” and go to the “${rs.pending.tabNewState}” tab.`,
              `Under “${v.ops.newState}” choose what is wrong: “${v.ops.maintenanceOnceOption}”, “${v.ops.tiresOption}”, “${v.ops.breakdownOption}” or “${v.ops.generalOption}”.`,
              `Before opening a new one, check under “${v.ops.tabOpen}” the ones the car already has open, so you do not repeat it.`,
            ],
            shot: 'estado-1',
          },
          {
            tab: 'Availability',
            title: v.ops.availSection,
            steps: [
              'Here you decide whether the car keeps running or stays off the road. The options depend on how it is now.',
              `If it is in service: “${v.ops.availWithSub}”, “${v.ops.availWithoutSub}” or “${v.ops.availStaysActive}”.`,
              `If it is already off the road: “${v.ops.availStaysOut}” or “${v.ops.availBackToService}”.`,
              `If it goes out without a replacement, you can explain why under “${v.ops.availReason}”.`,
            ],
            shot: 'estado-2',
          },
          {
            tab: 'Replacement',
            title: v.ops.subSection,
            steps: [
              `With “${v.ops.availWithSub}”, “${v.ops.subSection}” appears: choose the “${v.ops.subSelect}”, the “${v.ops.start}” and the “${v.ops.subReason}”.`,
              `If none is free, “${v.newSubstitute}” adds one without leaving.`,
              `If the car already has one: “${v.ops.activeLink}” and “${v.ops.closeLink}”.`,
            ],
            shot: 'estado-sustituto',
          },
          {
            tab: 'Tyres',
            title: v.ops.tiresSection,
            steps: [
              `This step only shows if you chose “${v.ops.tiresOption}” in the first one.`,
              `Set the “${v.ops.tiresMileage}” and the “${v.ops.tiresChangeReason}”: “${v.ops.tiresWear}” or “${v.ops.tiresPuncture}”.`,
              'Tick which wheels are changed.',
            ],
            shot: 'estado-neumaticos',
          },
          {
            tab: 'Management',
            title: `${v.ops.manageSection} · ${v.ops.docsSection}`,
            steps: [
              `Under “${v.ops.manageSection}” say where the car is, with its “${v.ops.managePostalCode}”.`,
              `Under “${v.ops.docsSection}” attach the papers of this status.`,
            ],
            shot: 'estado-gestion',
          },
          {
            tab: 'Email',
            title: v.ops.comSection,
            steps: [
              `To tell people about the change, choose the “${v.ops.comTemplate}” and tick who gets it: “${v.ops.comToDriver}” or “${v.ops.comToSupervisor}”.`,
              `If you want, add a “${v.ops.comMessage}” of your own.`,
              `Move between the steps with “${v.ops.back}” and “${v.ops.next}”, and finish with “${v.ops.save}”.`,
              `The greyed-out steps cannot be opened yet: ${v.ops.stepLocked.toLowerCase()}`,
            ],
            shot: 'estado-email',
          },
        ],
        shots: {
          'estado-1': 'The first step: the vehicle’s new status',
          'estado-2': 'The vehicle’s availability',
          'estado-sustituto': 'Choosing the replacement car',
          'estado-neumaticos': 'The tyre change details',
          'estado-gestion': 'The location and files of the status',
          'estado-email': 'The email announcing the change',
        },
        faq: [
          {
            q: 'How does the car get back into service?',
            a: `When its incident is resolved, with the box to bring it back to Active ([[resolver]]), or here with “${v.ops.availBackToService}”.`,
          },
        ],
      },
      'itv-mantenimiento': {
        title: v.schedule.btn,
        lead: 'The inspection appointment and the maintenance programme of each car.',
        quick: [
          { label: 'Book an inspection', step: 1 },
          { label: 'Put a car on its maintenance plan', step: 2 },
        ],
        walk: [
          {
            tab: 'Inspection',
            title: 'The inspection appointment',
            steps: [
              `In “${nav.vehicles}”, the car’s ⋮ menu → “${v.schedule.btn}”. It opens on “${s.tabItv}”.`,
              `Choose the “${s.itvDate}” and, if you like, the “${s.itvPostalCode}”.`,
              `Press “${s.itvSchedule}”. To change it: “${s.itvModify}” and then “${s.itvSave}”.`,
              `Once the inspection is done, “${s.resolveItv}” records it. “${s.itvDelete}” removes the appointment.`,
            ],
            shot: 'itv-1',
          },
          {
            tab: 'Maintenance',
            title: 'The maintenance programme',
            steps: [
              `Go to “${s.tabMaintenance}”.`,
              `Choose the “${s.maintenancePick}” from the catalog, or create one with “${s.maintenanceNewProgram}”.`,
              `Say where it counts from: “${s.maintenanceFromDate}” or “${s.maintenanceFromKm}”.`,
              `Press “${s.maintenanceSchedule}”. When the garage does the service, “${s.resolveMaintenance}”.`,
            ],
            shot: 'itv-2',
          },
        ],
        shots: {
          'itv-1': 'The tab to schedule a car’s inspection',
          'itv-2': 'The tab to schedule a car’s maintenance',
        },
        faq: [{ q: 'Can a car have two inspection appointments?', a: s.itvOnlyOne }],
      },
      kilometraje: {
        title: nav.mileage,
        lead: 'Mileage readings, the ones missing this month and the projection to the end of the contract or year.',
        quick: [
          { label: 'See who has not sent this month’s mileage', step: 2 },
          { label: 'Know whether a car will go over its mileage', step: 3 },
        ],
        walk: [
          {
            tab: 'Readings',
            title: m.tabs.readings,
            steps: [
              `“${m.tabs.readings}” shows the latest reading of each car and its date.`,
              `To find a car, search for its plate or filter by “${m.supervisorFilter}”.`,
            ],
            shot: 'km-lecturas',
          },
          {
            tab: 'Pending',
            title: m.tabs.pending,
            steps: [
              `“${m.tabs.pending}” lists the cars with no reading yet this month.`,
              `“${m.email.bulkAction}” sends a reminder to their drivers.`,
              `“${m.estimateAction}” fills in last month’s missing readings with an estimate, marked “${m.estimatedTag}”.`,
            ],
            shot: 'km-pendientes',
          },
          {
            tab: 'Projection',
            title: m.tabs.projection,
            steps: [
              'It works out how fast each car is going and how many kilometres it will end with.',
              `In “${m.projModeLabel}” choose “${m.projContract}” or “${m.projYear}”.`,
              `The “${m.columns.level}” column says whether it is “${m.levels.within}”, “${m.levels.watch}” or “${m.levels.over}”.`,
              `If a car is going over, “${m.resolveOverage}” opens the fix, for example changing its driver.`,
            ],
            shot: 'km-proyeccion',
          },
          {
            tab: 'Unlimited',
            title: m.tabs.unlimited,
            steps: [`“${m.tabs.unlimited}” gathers the cars with unlimited mileage.`],
            shot: 'km-ilimitados',
          },
        ],
        shots: {
          'km-lecturas': 'The mileage readings tab',
          'km-pendientes': 'The cars with this month’s reading pending',
          'km-proyeccion': 'The mileage projection to the end of the contract',
          'km-ilimitados': 'The cars with unlimited km',
        },
      },
      incidencias: {
        title: nav.incidents,
        lead: 'Breakdowns, one-off maintenance and requests across the fleet: open them, follow them and close them.',
        quick: [
          { label: 'See what is still pending', step: 1 },
          { label: 'Open an incident', step: 3 },
          { label: 'Close an incident', step: 5 },
        ],
        walk: [
          {
            tab: 'Inbox',
            title: 'What is in the inbox',
            steps: [
              `Four types: “${inc.types.breakdown}”, “${inc.types.maintenance}”, “${inc.types.tires}” and “${inc.types.general}”. Accidents have their own inbox: [[accidentes]].`,
              `Two tabs: “${inc.tabOpen}” (open and in progress) and “${inc.tabClosed}”. It always opens on what is pending.`,
              `“${inc.columns.priority}” goes from “${inc.priorities.critical}” to “${inc.priorities.informative}”; “${inc.columns.vehicleState}” tells you whether the car is still off the road.`,
              `A blue row means “${inc.changePending}”: someone has asked to change the report from the field app.`,
            ],
            shot: 'incidencias',
          },
          {
            tab: 'Search',
            title: 'Searching and filtering',
            steps: [
              `In “${inc.searchLabel}”, type a plate, a type or part of the description.`,
              `Narrow it down with “${inc.filterVehicle}”, “${inc.filterType}” and “${inc.filterPriority}”.`,
              `“${inc.exportCsv}” downloads what you are seeing, with the filters applied.`,
              `At the top, “${inc.goAccidents}” and “${inc.goAlerts}” jump to the other two inboxes.`,
            ],
            shot: 'incidencias-filtros',
          },
          {
            tab: 'New',
            title: inc.incidents.newLabel,
            steps: [
              `Press “${inc.incidents.newLabel}”.`,
              `Choose the “${inc.form.vehicle}”, the “${inc.form.type}” and the “${inc.form.priority}”, and write the “${inc.form.description}”.`,
              `The “${inc.form.postalCode}” is used to find the nearest workshop.`,
              `Finish with “${inc.form.save}”. If the car is also going off the road, use the status change instead: [[estado]].`,
            ],
            shot: 'incidencias-nueva',
          },
          {
            tab: 'View',
            title: inc.view,
            steps: [
              `The eye in “${inc.columns.actions}” opens the whole incident, read-only.`,
              `“${inc.detail.request}”: what was asked for. “${inc.detail.resolution}”: how it was closed, with the “${inc.detail.workshop}”, the “${inc.detail.downtimeLabel}” and who closed it.`,
              `For tyres, the “${inc.detail.tires}” is shown too.`,
            ],
            shot: 'incidencias-ver',
          },
          {
            tab: 'Actions',
            title: 'Closing, editing and documents',
            steps: [
              `The circle with a ✓ is “${inc.resolve}”: it opens the closing form for its type ([[resolver]]).`,
              `If it is greyed out, there are “${inc.changePending}”: decide on them first in [[solicitudes]], tab “${r.tabIncidents}”.`,
              `The pencil (“${inc.edit}”) corrects the priority, date, cost or description.`,
              `The folder (“${inc.documents}”) takes you to the car page, where invoices and photos are uploaded: [[ficha]].`,
            ],
            shot: 'incidencias-editar',
          },
        ],
        shots: {
          incidencias: 'The inbox of open incidents',
          'incidencias-nueva': 'The new incident form',
          'incidencias-ver': 'An incident opened with the eye',
          'incidencias-filtros': 'The filters of the incidents inbox',
          'incidencias-editar': 'The window to edit an incident',
        },
        faq: [
          {
            q: 'Why can’t I set it to “Closed” with the pencil?',
            a: `Because closing needs the closing details (cost, mileage, invoice). It is closed with “${inc.resolve}”.`,
          },
          {
            q: 'Where are the inspections (MOT)?',
            a: 'An inspection is not an incident but a warning: it is in [[alertas]] and booked in [[itv-mantenimiento]].',
          },
          {
            q: 'How is this different from changing the car’s status?',
            a: 'A status change opens the incident AND takes the car off the road, with a replacement if needed ([[estado]]). Here you only open the incident.',
          },
        ],
      },
      resolver: {
        title: 'Resolving alerts and incidents',
        lead: `A single button, “${inc.resolve}”, opens the right form for each alert or incident, wherever it is.`,
        quick: [
          { label: 'Close a breakdown', step: 2 },
          { label: 'Put the car back in service', step: 4 },
          { label: 'Resolve a warning', step: 5 },
        ],
        walk: [
          {
            tab: 'Where',
            title: 'Where “Resolve” is',
            steps: [
              `“${inc.resolve}” is wherever you see something pending. In [[panel]], on the pending strips.`,
              'In the trays: [[alertas]], [[incidencias]] and [[accidentes]].',
              `In [[ficha]], on the “${rs.pending.title}” card, and in the ⋮ menu of [[vehiculos]].`,
              'It does not matter where you open it from: the same case always gets the same form.',
            ],
            shot: 'incidencias',
          },
          {
            tab: 'What opens',
            title: 'One form for each case',
            steps: [
              `“${inc.types.breakdown}” and “${inc.types.general}”: the repair, with “${rs.breakdown.confirm}”.`,
              `“${inc.types.tires}”: the tyres fitted and in which positions.`,
              `“${inc.types.maintenance}” or “${a.typeOptions.maintenanceDue}”: the service done; if there is a plan, it is re-anchored.`,
              `“${a.typeOptions.itvDue}”: record the inspection. “${a.typeOptions.itvUnscheduled}”: opens “${v.schedule.btn}” to book it.`,
              `Insurance: “${rs.insurance.confirm}”, with the new expiry date.`,
              `“${inc.types.accident}”: the repair and the claim ([[accidentes#4]]).`,
            ],
            shot: 'resolver-averia',
          },
          {
            tab: 'Details',
            title: 'The closing details',
            steps: [
              `Fill in “${rs.common.date}”, “${rs.common.km}”, “${rs.common.cost}” and “${rs.common.observations}”.`,
              'The mileage is loaded with one click from the latest reading of the car: it does not run while in the workshop.',
              `“${rs.common.postalCode}” comes from the request; correct it if the car ended up somewhere else.`,
              'Attach the invoice or the report right here: it is saved with the documents of the car.',
            ],
            shot: 'resolver-averia',
          },
          {
            tab: 'Back',
            title: 'Putting the car back in service',
            steps: [
              `If the car is off the road, the box “${rs.common.backToService}” appears. It comes ticked when it is off the road for this same reason (workshop, inspection, accident).`,
              'If it had a replacement car, the same box frees it.',
              'Untick it if the car is still out of service for another reason.',
              'If another request for the car is still open, the car does not go back to Active and the notice says which one.',
            ],
            shot: 'accidentes-resolver',
          },
          {
            tab: 'Warnings',
            title: 'Resolving a warning',
            steps: [
              `“${a.typeOptions.kmReadingPending}”: “${a.resolveModal.km.confirm}”.`,
              `“${a.typeOptions.kmOverage}”: you can give the car to someone who drives less, with “${a.resolveModal.overage.confirmChange}”.`,
              `“${a.typeOptions.noDriver}”: “${rs.noDriver.confirmAssign}”, or just with the note.`,
              `The rest are closed with a “${a.resolveModal.noteLabel}” and “${a.resolveModal.confirm}”.`,
            ],
            shot: 'resolver-alerta',
          },
        ],
        shots: {
          'resolver-averia': 'The form to resolve an incident',
          'resolver-alerta': 'The form to resolve a warning',
          incidencias: 'The incidents inbox, with the resolve button on each row',
          'accidentes-resolver': 'The checkbox to return the car to Active when resolving',
        },
        faq: [
          {
            q: 'Why is the resolve button greyed out?',
            a: `There are changes to the report proposed from the field. They are accepted or rejected in [[solicitudes]], tab “${r.tabIncidents}”, and then it can be resolved.`,
          },
          {
            q: 'It was saved, but it says the file could not be uploaded.',
            a: 'The resolution still counts. Upload the file from [[documentos]] or from the car page.',
          },
          {
            q: `What does “${a.resolver.automatic}” mean?`,
            a: `${a.resolver.automaticTip}`,
          },
        ],
      },
      accidentes: {
        title: nav.accidents,
        lead: 'Report an accident with the guided form, follow it until it is closed and delete third-party data in time.',
        quick: [
          { label: 'Report an accident', step: 2 },
          { label: 'Close an accident', step: 4 },
          { label: 'Delete third-party data', step: 5 },
        ],
        walk: [
          {
            tab: 'Inbox',
            title: 'The accidents inbox',
            steps: [
              `It works like [[incidencias]]: “${inc.tabOpen}” and “${inc.tabClosed}”, search, filters and “${inc.exportCsv}”.`,
              `“${inc.accidents.ageColumn}” says how long the file has been open.`,
              'After a year the row turns amber; at 18 months, red: the third-party data must be deleted.',
            ],
            shot: 'accidentes',
          },
          {
            tab: 'Report',
            title: inc.accidents.newLabel,
            steps: [
              `Press “${inc.accidents.newLabel}”, choose the car and “${inc.accidents.pickContinue}”.`,
              `Also from the ⋮ menu of [[vehiculos]] → “${v.accident.btn}” → “${v.accident.tabReport}”.`,
              'The box that sets the car as crashed, i.e. off the road, comes ticked. Untick it if it is still running.',
            ],
            shot: 'accidentes-parte',
          },
          {
            tab: 'Form',
            title: v.accident.stepsLabel,
            steps: [
              `“${v.accident.stepWhere}”: street, town, “${v.accident.occurredAt}” and phone.`,
              `“${v.accident.stepDamage}”: the “${v.accident.damages}”.`,
              `“${v.accident.stepPeople}”: ${v.accident.peopleNote.charAt(0).toLowerCase()}${v.accident.peopleNote.slice(1)} ${v.accident.thirdRequiredHint}`,
              `“${v.accident.stepReport}”: the “${v.accident.policeRef}” and the report file.`,
              `Finish with “${v.accident.submit}”.`,
            ],
          },
          {
            tab: 'Follow up',
            title: 'Following it up and closing it',
            steps: [
              `The arrow on the row unfolds the “${inc.report.title}”; the eye opens the whole incident.`,
              'The pencil reopens the same report, with everything it had, to correct it.',
              `“${inc.resolve}” asks for “${rs.accident.sectionRepair}”, “${rs.accident.sectionClaim}” (the “${rs.accident.claimRef}” and “${rs.accident.liability}”) and “${rs.accident.sectionNotes}”.`,
              `With “${rs.accident.totalLoss}”, the button becomes “${rs.accident.confirmRetire}” and its retirement opens.`,
            ],
            shot: 'accidentes-resolver',
          },
          {
            tab: 'Third parties',
            title: inc.accidents.purge,
            steps: [
              'The data of third parties and injured people is kept for 18 months (GDPR).',
              `After that, the row’s “${inc.accidents.purge}” button lights up.`,
              'Names, plates, phones and insurers of the others are deleted. Where, when, the police report and the car’s damage are kept.',
              'It cannot be undone: the app asks for confirmation.',
            ],
          },
        ],
        shots: {
          accidentes: 'The accidents inbox with the age of each one',
          'accidentes-parte': 'The first step of the accident report',
          'accidentes-resolver': 'The window to close an accident',
        },
        faq: [
          {
            q: 'Why can’t I delete the third-party data yet?',
            a: `${inc.accidents.purgeNotYet} Before that, the button is greyed out.`,
          },
          {
            q: 'Can I turn an accident into a breakdown?',
            a: 'No: an accident’s type is fixed. If it was opened by mistake, close it with a note and open the breakdown in [[incidencias]].',
          },
          {
            q: 'Where do I upload the photos and the signed report?',
            a: 'In the last step of the report, or later from the car page ([[ficha]]).',
          },
        ],
      },
      alertas: {
        title: nav.alerts,
        lead: 'The fleet due dates and warnings: group them, sort them and resolve them.',
        sections: [
          {
            title: 'What is here',
            steps: [
              `Dated warnings: “${a.typeOptions.itvDue}”, “${a.typeOptions.itvUnscheduled}”, “${a.typeOptions.kmReadingPending}”, “${a.typeOptions.kmOverage}”, “${a.typeOptions.maintenanceDue}” and “${a.typeOptions.noDriver}”.`,
              `“${a.statusOptions.open}” and “${a.statusOptions.resolved}” separate what is pending from what is done.`,
            ],
            shot: 'alertas',
          },
          {
            title: 'Finding what is urgent',
            steps: [
              `Filter by “${a.filters.type}”, “${a.filters.due}” (for example, “${a.dueOptions.overdue}”), “${a.filters.driver}” or “${a.filters.supervisor}”.`,
              `Sort with “${a.sortDueAsc}” or “${a.sortDueDesc}”.`,
              `“${a.groupByDue}” or “${a.groupByType}” puts them into blocks.`,
            ],
            shot: 'alertas-agrupadas',
          },
          {
            title: 'Dealing with an alert',
            steps: [
              `“${a.resolve}” opens the right form for that alert: [[resolver#5]].`,
              `“${a.sendEmail}” writes an email about it to the driver or the supervisor.`,
              `“${a.registerItv}”, at the top, records an inspection already done. To book one: [[itv-mantenimiento]].`,
              `“${a.goIncidents}” jumps to the incidents ([[incidencias]]).`,
            ],
            shot: 'resolver-alerta',
          },
          {
            title: 'Who closed it',
            steps: [
              `In “${a.statusOptions.resolved}” you see “${a.columns.resolvedAt}”, “${a.columns.resolvedBy}” and the “${a.columns.resolutionNote}”.`,
              `In green, if whoever has the car closed it: “${a.resolver.driverMatch}”`,
              'With a warning icon, if someone outside the car closed it: worth checking.',
              `“${a.resolver.automatic}”: ${a.resolver.automaticTip.charAt(0).toLowerCase()}${a.resolver.automaticTip.slice(1)}`,
            ],
            shot: 'alertas-resueltas',
          },
        ],
        shots: {
          alertas: 'The list of open alerts',
          'alertas-agrupadas': 'The alerts grouped by due month',
          'resolver-alerta': 'The window to resolve an alert',
          'alertas-resueltas': 'Resolved alerts, with who closed each one',
        },
        faq: [
          {
            q: 'Who creates the alerts?',
            a: 'The app, on its own, in its daily run: from the inspection, maintenance and insurance dates, the mileage readings, the mileage overage and the cars without a driver. They are not created by hand.',
          },
          {
            q: 'What is the difference between an alert and an incident?',
            a: 'An alert is a dated warning from the app; an incident is something that has happened and someone has reported ([[incidencias]]).',
          },
          {
            q: 'I recorded the inspection and the alert disappeared.',
            a: `That is expected: it closes on its own and shows in “${a.statusOptions.resolved}” as “${a.resolver.automatic}”.`,
          },
        ],
      },
      solicitudes: {
        title: nav.requests,
        lead: 'What drivers and supervisors ask for, in six trays, to grant or reject it.',
        sections: [
          {
            title: 'The six trays',
            steps: [
              `“${r.tabVehicles}”: someone needs a car, a replacement because theirs is off the road or one because they have none.`,
              `“${r.tabDocuments}”: something is asked about an existing document, such as seeing, correcting or deleting it.`,
              `“${r.tabSupply}”: a paper is missing and someone has asked for it.`,
              `“${r.tabDrivers}”: another driver is proposed for a car.`,
              `“${r.tabProfiles}”: someone asks to correct their personal details.`,
              `“${r.tabIncidents}”: a change to an incident report is proposed; meanwhile it cannot be resolved ([[resolver]]).`,
            ],
            shot: 'solicitudes',
          },
          {
            title: 'Deciding',
            steps: [
              `Tick “${r.statusPending}” to see only what is waiting for a decision.`,
              `In “${r.tabVehicles}”: “${r.helpGrant}” ${r.helpGrantRest} “${r.helpReject}” ${r.helpRejectRest}`,
              `In the document trays, each request is handled in two tabs: “${r.manage.tabDecide}” and “${r.manage.tabDocs}”.`,
            ],
            note: 'The key in the header counts what is undecided and takes you straight to the tray that has something.',
            shot: 'solicitudes-gestionar',
          },
          {
            title: 'Filtering',
            steps: [
              `Search by person, plate or text, and tick “${r.statusPending}”, “${r.statusAssigned}” or “${r.statusRejected}”.`,
              `In “${r.tabVehicles}”, “${r.originLabel}” separates “${r.originSubstitute}” from “${r.originNoVehicle}”.`,
            ],
            shot: 'solicitudes-filtros',
          },
        ],
        shots: {
          solicitudes: 'The requests inbox with its six tabs',
          'solicitudes-gestionar': 'The window to handle a document request',
          'solicitudes-filtros': 'The status and origin filters, and how requests are decided',
        },
        faq: [
          {
            q: 'Who makes these requests?',
            a: 'Drivers and supervisors, from the field app. Here they are only decided.',
          },
          {
            q: `What exactly does “${r.helpGrant}” do?`,
            a: `“${r.helpGrant}” ${r.helpGrantRest} “${r.helpReject}” ${r.helpRejectRest}`,
          },
          {
            q: 'How do I email the person who asked?',
            a: 'With the app’s email templates: [[correo]].',
          },
        ],
      },
      documentos: {
        title: nav.documents,
        lead: 'Who can read each document type, and the list of fleet and personal papers.',
        quick: [
          { label: 'Decide who sees each type of paper', step: 1 },
          { label: 'Find a document', step: 2 },
          { label: 'Change the access of a single document', step: 3 },
        ],
        walk: [
          {
            tab: 'By type',
            title: d.settings.title,
            steps: [
              `Open the “${d.tabs.settings}” tab. There is one row per document type.`,
              `“${d.settings.adminColumn}” always reads it. In “${d.settings.supervisorColumn}” you tick “${d.settings.supervisorReads}”.`,
              `For drivers, “${d.settings.listColumn}” goes from “${d.settings.driverOptions.none}” to “${d.settings.driverOptions.all}”.`,
              `“${d.settings.viewColumn}”, “${d.settings.downloadColumn}” and “${d.settings.deletionColumn}” can be “${d.settings.actionOptions.allow}”, “${d.settings.actionOptions.request}” or “${d.settings.actionOptions.deny}”.`,
              `Press “${d.settings.save}”.`,
            ],
            shot: 'documentos-ajustes',
          },
          {
            tab: 'List',
            title: 'Find a document',
            steps: [
              `In “${d.tabs.documents}”, pick the type at the top or leave “${d.allTypes}”.`,
              `“${d.statusSummary}” sums up how many there are in each status; press one to see only those.`,
              `Filter by “${d.userFilterLabel}” or “${d.uploaderFilterLabel}”, or tick “${d.groupByPlate}”.`,
              `“${d.newDocument}” uploads a new one for a car or a person.`,
            ],
            shot: 'documentos-lista',
          },
          {
            tab: 'One document',
            title: 'The access of a single document',
            steps: [
              `In its row, the access button opens “${d.access.modal.title('…')}”.`,
              `Each permission can stay as “${d.access.modal.inheritShort}” or be changed for that document only.`,
              `The changed ones are marked “${d.access.adjusted}” in the list.`,
            ],
            shot: 'documentos-acceso',
          },
        ],
        shots: {
          'documentos-ajustes': 'Who reads each document type',
          'documentos-lista': 'The document list with its summary by status',
          'documentos-acceso': 'The access window of one document',
        },
        faq: [
          {
            q: `What happens with “${d.settings.actionOptions.request}”?`,
            a: `The driver asks for it and the request arrives in “${nav.requests}”, where it is granted or rejected.`,
          },
        ],
      },
      usuarios: {
        title: nav.drivers,
        lead: 'The people in the app: their roles, the cars they have had and their personal documents.',
        sections: [
          {
            title: 'Finding someone',
            steps: [
              'The tabs at the top split people by role.',
              `In “${u.toolsToggle}” you search by name, username or email, and filter by “${u.roleFilterLabel}” or “${u.lblCreated}”.`,
              `Deactivated accounts are hidden: tick “${u.showInactive}” to see them.`,
            ],
            shot: 'usuarios',
          },
          {
            title: 'Adding and changing',
            steps: [
              `“${u.newUser}” creates a person; “${u.importBtn}” creates many at once.`,
              `In their row, “${u.edit}” changes their details and roles; “${u.deactivate}” removes their access and “${u.reactivate}” gives it back.`,
              `“${u.ownTitle}” shows the accounts that cannot be deactivated: yours and the system one.`,
            ],
            shot: 'usuario-nuevo',
          },
          {
            title: 'A person’s page',
            steps: [
              'Press their name to see the cars they have had and their personal documents.',
              'If they are a supervisor, the page also shows their group.',
            ],
            shot: 'usuario-ficha',
          },
        ],
        shots: {
          usuarios: 'The user list with its tabs by role',
          'usuario-nuevo': 'The window to add a user',
          'usuario-ficha': 'The page of one person',
        },
      },
      correo: {
        title: 'Sending email',
        lead: 'The wizard to send an email about a car: type, content, recipients and preview.',
        shots: {
          'correo-1': 'The first email step: the type and what was already sent',
          'correo-2': 'The email content',
          'correo-3': 'The email recipients',
          'correo-4': 'The email preview before sending',
        },
        quick: [
          { label: 'Send a notice right now, as it is', step: 1 },
          { label: 'Change the text before sending', step: 2 },
          { label: 'Send it to another address', step: 3 },
          { label: 'See how it looks before sending', step: 4 },
        ],
        walk: [
          {
            tab: v.email.typeLabel,
            title: 'What the email is about',
            steps: [
              `Open the wizard with “${v.email.btn}”: it is in the ⋮ menu of [[vehiculos]] and in [[ficha]]. In [[alertas]], each row has “${a.sendEmail}”.`,
              `In “${v.email.typeLabel}” choose what it is about. Below you get the car data that justifies it.`,
              `“${v.email.quickSend}” sends it at once, with its template and to its usual recipients. It really goes out: there is no preview and no confirmation.`,
              `Further down, “${v.email.activityAlerts}”: each one has its own “${v.email.quickSendAlert}”, and if there are several, “${withN(v.email.sendAll)}” sends them all.`,
              `“${v.email.activitySent}” shows what has already been sent, so nobody is told twice.`,
            ],
            shot: 'correo-1',
          },
          {
            tab: v.email.stepContent,
            title: 'What it says',
            steps: [
              `“${v.email.useTemplate}” comes ticked. Untick it and only what you write is sent.`,
              `In “${v.email.langLabel}” choose “${v.email.langEs}”, “${v.email.langEn}” or “${v.email.langBoth}”.`,
              `“${v.email.bodyLabel}” is the template text and you can edit it. The change applies to this email only: the template stays as it is ([[ajustes]]).`,
              `“${v.email.bodyReset}” undoes your edits.`,
              `“${v.email.extraMessage}” adds a text of your own to the template.`,
            ],
            shot: 'correo-2',
          },
          {
            tab: v.email.recipients,
            title: 'Who gets it',
            steps: [
              `Tick “${v.email.toAdmin}”, “${v.email.toDriver}” or “${v.email.toSupervisor}”: it can go to several at once.`,
              `“${v.email.toRenting}” only shows for the insurance notice.`,
              `In “${v.email.toOther}” you type a one-off address.`,
              'There must be at least one recipient to go on.',
            ],
            shot: 'correo-3',
          },
          {
            tab: v.email.preview,
            title: 'How it looks, and sending',
            steps: [
              `With “${v.ops.next}” you reach “${v.email.preview}”: the “${v.email.subjectLabel}” and the whole email, as the recipient will see it.`,
              `If something is wrong, go back with “${v.ops.back}” and change it.`,
              `“${v.email.send}” only appears in this last step. Once you press it, the email goes out: it cannot be undone.`,
              `When it finishes, the window says who it was sent to and who it was not.`,
            ],
            shot: 'correo-4',
          },
        ],
        faq: [
          {
            q: 'Can I send an email without a template?',
            a: `Yes: untick “${v.email.useTemplate}” and write the message. Without a template, the message cannot be empty.`,
          },
          {
            q: 'I changed the text of an email. Did I change the template?',
            a: 'No. What you edit in the wizard applies to that email only. Templates are changed in [[ajustes]].',
          },
          {
            q: 'How do I know whether a notice was already sent?',
            a: `In the first step, “${v.email.activitySent}” lists the latest emails of the car, and each open alert says when its last email was sent.`,
          },
        ],
      },
      informes: {
        title: 'Reports and invoices',
        lead: 'Download vehicle and people data, and keep track of invoices.',
        walk: [
          {
            tab: rp.tabs.downloads,
            title: 'Download data',
            steps: [
              `Under “${rp.downloads.kindLabel}” choose what to download: vehicles (everything in a single Excel file) or users.`,
              `Adjust the filters to keep what you need; “${rp.downloads.clearFilters}” removes them all.`,
              `Press “${rp.downloads.preview}” to see what you are about to download.`,
              `Download it with “${rp.downloads.downloadXlsx}” or with “${rp.downloads.downloadCsv}”.`,
            ],
            shot: 'informes-descargas',
          },
          {
            tab: rp.tabs.invoices,
            title: 'Invoices',
            steps: [
              `Go to the “${rp.tabs.invoices}” tab: it lists the invoices of the fleet. Filter by vehicle to see those of one car.`,
              `“${inv.newInvoice}” records an invoice; “${inv.exportCsv}” downloads the list.`,
              `Those of a single car can also be handled from its ⋮ menu in [[vehiculos]] → “${v.invoices.btn}”.`,
            ],
            shot: 'informes-facturas',
          },
        ],
        shots: {
          'informes-descargas': 'The reports downloads tab',
          'informes-facturas': 'The list of fleet invoices',
        },
      },
      ajustes: {
        title: nav.settings,
        lead: 'Catalogs, permanent deletion and email templates.',
        sections: [
          {
            title: aj.tabs.catalogs,
            steps: [
              `“${aj.tabs.catalogs}” keeps the lists the rest of the app uses: projects, rental companies, makes, models, sites, maintenance programmes…`,
              'What you add here then appears in the drop-downs of the records.',
            ],
            shot: 'ajustes-catalogos',
          },
          {
            title: aj.tabs.deletions,
            steps: [
              'Whatever is deactivated or retired ends up here: cars, people and other records.',
              `“${er.restore}” brings it back as it was.`,
              `“${er.purge}” deletes it for good. It warns first: “${er.cascadeIntro}”`,
            ],
            note: `Only the superuser can use “${er.purge}”, and it cannot be undone.`,
            shot: 'ajustes-borrado',
          },
          {
            title: aj.tabs.templates,
            steps: [
              `“${aj.tabs.templates}” holds the latest sends, the reminder and warning settings, and the text of each email type.`,
            ],
            shot: 'ajustes-plantillas',
          },
        ],
        shots: {
          'ajustes-catalogos': 'The app catalogs',
          'ajustes-borrado': 'The permanent deletion area',
          'ajustes-plantillas': 'The email templates',
        },
      },
      hse: {
        title: 'HSE view',
        lead: 'The read-only view for health and safety: the cars, their readings and their report.',
        sections: [
          {
            title: 'At a glance',
            steps: [
              `Four figures: “${h.stats.vehicles}”, “${h.stats.readings}”, “${h.stats.fuel}” and “${h.stats.stale}”. Press one to see which cars they are.`,
              'Nothing is changed here: it is read-only.',
            ],
            shot: 'hse',
          },
          {
            title: 'The tabs',
            steps: [
              `“${h.tabs.vehicles}”: each car with its readings; expand a row to see how mileage and consumption evolve. “${h.includeStopped}” adds the ones off the road.`,
              `“${h.tabs.reports}”: the HSE report, with the summary, the vehicles and the mileage.`,
            ],
            shot: 'hse-informe',
          },
        ],
        shots: {
          hse: 'The HSE view with its four figures',
          'hse-informe': 'The HSE report',
        },
      },
      preguntas: {
        title: 'Frequent questions',
        lead: 'The questions that come up most often.',
        faq: [
          {
            q: 'I retired a car by mistake. Is it lost?',
            a: `No. “${v.deactivate}” deletes nothing: the car is reactivated in “${nav.settings}”, in the permanent deletion tab.`,
          },
          {
            q: 'Why don’t I see “Delete permanently”?',
            a: 'Only the superuser can delete for good. The rest of the administration can restore.',
          },
          {
            q: 'Why can’t I deactivate my account?',
            a: `In “${nav.drivers}”, neither your own account nor the system account can be deactivated.`,
          },
          {
            q: `Why don’t I see the “${app.shell.hse.button}” button?`,
            a: 'It only appears to people with the HSE role.',
          },
          {
            q: 'Where are the invoices?',
            a: `In “${nav.reports}”, in its invoices tab. And a car’s invoices, in its ⋮ menu.`,
          },
          {
            q: 'When importing, a row is under errors although it looks right.',
            a: 'The company, project, cost centre, supervisor and driver must already exist in the app.',
          },
        ],
      },
    },
  }
}

const dict = { es, en }

/** Copia de la Ayuda en el idioma activo. Llama a las copias de las pantallas
 * que cita (siempre todas y en el mismo orden: son hooks). */
export function useTutorialCopy(): TutorialCopy {
  const lang = useAppLang()
  const { t } = useLang()
  const vehicles = useVehiclesCopy()
  const bulk = useBulkImportCopy()
  const schedule = useScheduleCopy()
  const mileage = useMileageCopy()
  const alerts = useAlertsPageCopy()
  const requests = useRequestsCopy()
  const users = useUsersCopy()
  const reports = useReportsCopy()
  const invoices = useInvoicesCopy()
  const ajustes = useAjustesCopy()
  const erratas = useErratasCopy()
  const hse = useHseCopy()
  const documents = useDocumentsCopy()
  const vehicleDetail = useVehicleDetailCopy()
  const vehicleForm = useVehicleFormCopy()
  const resolve = useResolveCopy()
  const incidents = useIncidentsCopy()
  return dict[lang]({
    app: t,
    vehicles,
    bulk,
    schedule,
    mileage,
    alerts,
    requests,
    users,
    reports,
    invoices,
    ajustes,
    erratas,
    hse,
    documents,
    vehicleDetail,
    vehicleForm,
    resolve,
    incidents,
  })
}
