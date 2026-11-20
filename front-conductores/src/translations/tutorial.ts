/**
 * Copia de la Ayuda de la app de campo, es/en.
 *
 * Sale del tutorial HTML (`tutoriales/conductores/tutoriales*.html`), pasado
 * capítulo a capítulo. Regla: los rótulos de la barra de abajo y de las vistas
 * de arriba no se escriben aquí, se toman de la copia de la app (`t.shell…`):
 * si un botón se renombra, la ayuda cambia sola. Los demás rótulos van entre
 * «» y se pintan como botones.
 *
 * La estructura (qué capítulos hay, recorridos, público) está en
 * `tutorial/chapters.ts`; aquí, solo cómo se cuenta en cada idioma.
 */
import { useLang } from '../i18n.tsx'
import type { ChapterId, GroupId } from '../tutorial/chapters.ts'

type AppCopy = ReturnType<typeof useLang>['t']

/** Una fila de «campo → qué poner» (las tablas del HTML). */
export interface Def {
  term: string
  text: string
}

/** Un bloque de contenido: pasos, tabla, nota, aviso y capturas. */
export interface Block {
  steps?: string[]
  defs?: Def[]
  /** Nota informativa (azul). */
  note?: string
  /** Aviso importante (ámbar). */
  warn?: string
  /** Capturas (sin `.webp`); con más de una, galería con pestañas. */
  shots?: string[]
  /** Rótulo de cada captura en la galería (mismo orden que `shots`). */
  shotLabels?: string[]
}

export interface TutorialSection extends Block {
  title: string
  /**
   * Para quién es. Las secciones con público seguidas van en pestañas
   * (`tab`), pero solo a quien supervisa; a los demás, la del conductor sola
   * y sin pestañas. La del supervisor no sale a quien no supervisa.
   */
  audience?: 'driver' | 'supervisor'
  /** Rótulo de su pestaña. */
  tab?: string
}

export interface TutorialWalkStep extends Block {
  /** Rótulo corto de la pestaña del recorrido. */
  tab: string
  title: string
}

export interface ChapterCopy {
  title: string
  /** Una frase: para qué sirve. */
  lead: string
  /** Lo que va antes del recorrido (avisos, «¿qué necesitas hacer?»). */
  intro?: TutorialSection[]
  walk?: TutorialWalkStep[]
  /** «¿Qué quieres hacer?»: `step` es la pestaña del recorrido (desde 1). */
  quick?: Array<{ label: string; step: number }>
  sections?: TutorialSection[]
  /** Texto alternativo de cada captura del capítulo. */
  shots?: Record<string, string>
  faq?: Array<{ q: string; a: string }>
}

export interface TutorialCopy {
  ui: {
    title: string
    subtitle: string
    back: string
    backToApp: string
    backToHelp: string
    indexLabel: string
    search: string
    searchPlaceholder: string
    clearSearch: string
    results: (n: number) => string
    noResults: (q: string) => string
    /** Sobre el título de la portada (el «Gransolar · Guía…» del manual). */
    coverEyebrow: string
    coverTitle: string
    coverText: string
    /** Rótulo del buscador de la portada. */
    finderLabel: string
    /** Índice fijo de arriba, en los capítulos. */
    tocLabel: string
    /** «Tutoriales:» de la isla de arriba, y la portada en su desplegable. */
    islandLabel: string
    allChapters: string
    footer: string
    start: string
    watchVideo: string
    resume: string
    tasksTitle: string
    chaptersTitle: string
    progress: (seen: number, n: number) => string
    read: string
    quickTitle: string
    walkLabel: string
    stepOf: (i: number, n: number) => string
    prev: string
    next: string
    prevChapter: string
    nextChapter: string
    pagerLabel: string
    faqTitle: string
    moreFaq: string
    shotPending: string
    zoom: string
    close: string
    showAll: string
    otherAudience: string
    videoFallback: string
    videoOffline: string
    videoLangHint: string
    videoScenesTitle: string
    videoScenesHint: string
    videoSeek: (time: string) => string
  }
  groups: Record<GroupId, string>
  audience: { driver: string; supervisor: string }
  chapters: Record<ChapterId, ChapterCopy>
}

const es = (t: AppCopy): TutorialCopy => {
  const tab = t.shell.tabs
  const mode = t.shell.mode
  return {
    ui: {
      title: 'Ayuda',
      subtitle: 'Cómo se usa la app de flota',
      back: 'Volver',
      backToApp: 'Volver a la app',
      backToHelp: 'Volver a la ayuda',
      indexLabel: 'Capítulos de la ayuda',
      search: 'Buscar en la ayuda',
      searchPlaceholder: 'Ej.: pinchazo, kilómetros, seguro, accidente…',
      clearSearch: 'Vaciar la búsqueda',
      results: (n) => `${n} resultado${n === 1 ? '' : 's'}`,
      noResults: (q) => `Nada coincide con «${q}».`,
      coverEyebrow: 'Gransolar · Guía para conductores',
      coverTitle: 'Manual de Flota',
      coverText:
        'Cómo usar la app de flota desde el móvil: anotar kilómetros y consumo, comunicar incidencias y accidentes, y gestionar la documentación de tu coche. Busca lo que necesitas o abre un capítulo.',
      finderLabel: '¿Qué necesitas hacer?',
      tocLabel: 'Índice de la ayuda',
      islandLabel: 'Tutoriales',
      allChapters: 'Todos los tutoriales',
      footer:
        'Las capturas son de la propia app, con datos de ejemplo. Lo que pulses en esta ayuda no cambia nada en la app.',
      start: 'Empezar por el principio',
      watchVideo: 'Ver el vídeo (menos de 3 min)',
      resume: 'Seguir donde lo dejaste',
      tasksTitle: 'Tareas frecuentes',
      chaptersTitle: 'Capítulos',
      progress: (seen, n) => `${seen} de ${n} leídos`,
      read: 'Leído',
      quickTitle: '¿Qué quieres hacer?',
      walkLabel: 'Paso a paso',
      stepOf: (i, n) => `Paso ${i} de ${n}`,
      prev: 'Atrás',
      next: 'Continuar',
      prevChapter: 'Anterior',
      nextChapter: 'Siguiente',
      pagerLabel: 'Capítulo anterior y siguiente',
      faqTitle: 'Dudas frecuentes',
      moreFaq: 'Más dudas, por capítulo',
      shotPending: 'Captura pendiente',
      zoom: 'Ampliar',
      close: 'Cerrar',
      showAll: 'Ver también lo de supervisores',
      otherAudience: 'Solo supervisores',
      videoFallback: 'Tu navegador no puede reproducir este vídeo. Debajo tienes lo que dice, escena a escena.',
      videoOffline: 'El vídeo necesita conexión. Debajo tienes lo que dice, escena a escena.',
      videoLangHint: '',
      videoScenesTitle: 'Qué sale en el vídeo',
      videoScenesHint: 'Toca el minuto para saltar a esa escena, o el nombre del capítulo para verlo paso a paso.',
      videoSeek: (time) => `Ir al ${time} del vídeo`,
    },
    groups: {
      start: 'Primeros pasos',
      car: 'Tu coche',
      events: 'Si pasa algo',
      papers: 'Papeles y avisos',
      supervisor: 'Si supervisas',
      other: 'Otros',
    },
    audience: { driver: 'Conductores', supervisor: 'Solo supervisores' },
    chapters: {
      video: {
        title: 'Vídeo de presentación',
        lead: 'La app en menos de tres minutos. Sin sonido: los textos van en pantalla.',
      },
      entrar: {
        title: 'Entrar en la app',
        lead: 'Con el enlace que te ha dado la empresa, tu usuario y tu contraseña.',
        sections: [
          {
            title: 'Entrar',
            steps: [
              'Abre en el móvil el enlace de la app de campo que te ha dado la empresa. También viene en los correos de recordatorio, en el botón «Abrir la app de campo».',
              'Escribe tu usuario o email y tu contraseña y pulsa «Entrar».',
              'Arriba a la derecha puedes cambiar el idioma: «ES» / «EN».',
              'Si te lo pregunta, permite las notificaciones: así te avisará de lo que tengas pendiente.',
            ],
            note: 'Por seguridad la sesión se cierra sola a las 2 horas, o antes si no la usas un rato. Y solo puede estar abierta en un dispositivo a la vez: si entras desde otro, se cierra en el primero.',
            warn: '¿Entras y te dice que no tienes acceso? Es porque aún no tienes coche asignado o tu usuario no tiene permiso para esta app. Pide acceso desde esa misma pantalla o habla con administración.',
            shots: ['login'],
          },
        ],
        shots: { login: 'Pantalla de inicio de sesión' },
      },
      pantalla: {
        title: 'Conoce la pantalla',
        lead: 'La app no es igual para todos: lo que ves depende de si conduces, de si supervisas o de las dos cosas.',
        sections: [
          {
            title: '¿Qué ve cada uno?',
            defs: [
              { term: mode.vehicle, text: 'El coche que conduces. Conductor: siempre. Supervisor: solo si además conduces un coche; si no, te manda a «' + mode.fleet + '».' },
              { term: mode.shares, text: 'Coches que compartes. Solo sale si tienes alguno en reparto.' },
              { term: mode.fleet, text: 'Los coches que supervisas. Solo la ven los supervisores.' },
              { term: mode.profile, text: 'Tus datos, documentos y peticiones. La ven todos.' },
              { term: 'Barra de abajo', text: `Las acciones de tu coche. En «${mode.fleet}» cambia a «${tab.home}» · «${tab.alerts}» · «${tab.projection}».` },
            ],
            note: 'Si no ves un botón de los que salen aquí, no es un fallo: tu usuario no tiene ese rol o no tienes nada que enseñar en él.',
          },
          {
            title: 'Si conduces',
            audience: 'driver',
            tab: 'Conductores',
            steps: [
              `**Cabecera.** El idioma («ES» / «EN»), tus iniciales (abren ${mode.profile}) y el botón rojo para salir.`,
              `**Vistas.** «${mode.vehicle}», «${mode.shares}» (solo si compartes algún coche) y «${mode.profile}». «${mode.fleet}» no te sale: es de supervisores.`,
              '**Te queda poco.** Lo que tienes que hacer pronto. Si no aparece, no tienes nada pendiente.',
              '**Tu coche.** Matrícula, estado y modelo. «Ver ficha» abre la ficha completa.',
              '**KM actual y Próximas citas.** La última lectura, el mejor día para registrar los km del mes y las fechas de ITV y mantenimiento. Más abajo, plegadas: Alertas, Incidencias, Accidentes y Documentación, cada una con su número.',
              `**Barra de abajo.** Las acciones de tu coche: «${tab.km}» «${tab.fuel}» «${tab.itv}» «${tab.maintenance}» «${tab.incident}» «${tab.accident}» «${tab.document}». La ITV solo sale si tu coche tiene una cita programada.`,
            ],
            shots: ['home'],
          },
          {
            title: 'Si supervisas',
            audience: 'supervisor',
            tab: 'Supervisores',
            steps: [
              `Lo que ves al pulsar «${mode.fleet}». La app recuerda la última vista que usaste.`,
              `**Vistas.** Tú tienes además «${mode.fleet}». Si también conduces un coche, sigues teniendo «${mode.vehicle}» para el tuyo.`,
              '**Flota a cargo.** Cuántos coches ves y cuántas lecturas de km faltan este mes.',
              '**A tu cargo.** Tus coches y tus conductores. Toca una cifra para ver la lista.',
              '**Alertas e incidencias.** Lo que hay abierto en tus coches; desde cada lista lo resuelves ahí mismo. Más abajo está la lista de coches, con buscador.',
              `**Barra de abajo.** En «${mode.fleet}» cambia: «${tab.home}» «${tab.alerts}» «${tab.projection}». Lo que haces con un coche (km, ITV, recordatorio…) va en su ficha.`,
            ],
            note: 'Todo lo de supervisar se explica en [[flota]].',
            shots: ['flota'],
          },
        ],
        shots: { home: 'Vista Mi vehículo de un conductor', flota: 'Vista Flota de un supervisor' },
      },
      km: {
        title: 'Registrar los km',
        lead: 'Una vez al mes, lo que marca el cuadro del coche.',
        sections: [
          {
            title: 'Registrar la lectura',
            steps: [
              `Toca «${tab.km}» en la barra de abajo. Se abre «Registrar km» con la matrícula de tu coche.`,
              'Arriba te recuerda la última lectura y su fecha: la nueva tiene que ser igual o mayor.',
              'La fecha de la lectura ya viene con la de hoy.',
              'En **Odómetro (km totales del cuadro)** escribe los kilómetros que marca el coche, sin puntos.',
              'Pulsa «Guardar lectura».',
            ],
            note: '¿Cuándo? En la tarjeta KM actual verás el mejor día para registrar los km del mes. Mientras falte la lectura te llegará un correo de recordatorio.',
            warn: 'Revisa bien la cifra antes de guardar: un número de más o de menos cambia los cálculos de kilómetros del contrato del coche.',
            shots: ['km'],
          },
        ],
        shots: { km: 'Ventana Registrar km' },
      },
      combustible: {
        title: 'Anotar el consumo',
        lead: 'El consumo medio que te enseña el ordenador de a bordo.',
        sections: [
          {
            title: 'Anotar el consumo medio',
            steps: [
              'Mira en el ordenador de a bordo el consumo medio de tu último trayecto o ciclo de repostaje (l/100 km, o kWh/100 km si es eléctrico).',
              `Toca «${tab.fuel}». Se abre «Consumo medio».`,
              'Escribe la cifra en **Consumo medio real en ese momento** (por ejemplo 6,4). La fecha ya viene puesta.',
              'Pulsa «Guardar consumo». Debajo verás tu última anotación.',
            ],
            warn: 'No anotes el «consumo histórico» o acumulado total del vehículo: solo el del último trayecto. No hace falta poner litros ni importe.',
            shots: ['combustible'],
          },
        ],
        shots: { combustible: 'Ventana Consumo medio' },
      },
      itv: {
        title: 'ITV',
        lead: 'Cuando ya has pasado la ITV, lo apuntas aquí.',
        sections: [
          {
            title: 'Registrar la ITV',
            steps: [
              `Toca «${tab.itv}». Arriba verás la próxima ITV programada.`,
              'Pon la fecha de la ITV (el botón «Hoy» la rellena).',
              'Elige el resultado: **Favorable** cierra los avisos de ITV; **Desfavorable** deja la cita pendiente.',
              'Si puedes, añade el informe de la ITV (foto o PDF) y pulsa «Registrar ITV».',
            ],
            note: 'El botón se puede usar desde 30 días antes de la cita. Si todavía no toca, sale apagado: tócalo igualmente y te dirá cuándo es la cita y desde qué día podrás registrarla.',
            warn: 'La cita la programa administración o tu supervisor. Si tu coche no tiene ITV programada, el botón de ITV no aparece.',
            shots: ['itv'],
          },
        ],
        shots: { itv: 'Ventana Registrar ITV' },
      },
      mantenimiento: {
        title: 'Mantenimiento',
        lead: 'Cuando ya has hecho la revisión del plan de tu coche, la apuntas aquí.',
        sections: [
          {
            title: 'Marcar el mantenimiento como hecho',
            steps: [
              `Toca «${tab.maintenance}». Verás el plan del coche (por ejemplo Revisión general), cada cuánto toca y cuándo es la próxima.`,
              'Cuando lo hayas hecho, pulsa «Marcar como realizado» y completa la fecha y los km.',
            ],
            note: 'El botón se puede usar desde 30 días antes de la fecha prevista. Si todavía no toca, sale apagado: tócalo igualmente y te dirá cuándo toca y desde qué día podrás registrarlo.',
            warn: 'El plan de mantenimiento lo programa administración o tu supervisor. Las reparaciones que surjan por el camino no van aquí: comunícalas como [[incidencia]].',
            shots: ['mantenimiento'],
          },
        ],
        shots: { mantenimiento: 'Ventana Actualizar mantenimiento' },
      },
      reparto: {
        title: 'Coches en reparto',
        lead: 'Coches que usas unos días o unas horas, junto con otras personas.',
        sections: [
          {
            title: `La vista «${mode.shares}»`,
            steps: [
              `Si tienes algún coche repartido, arriba aparece «${mode.shares}». Si no, esa vista no sale.`,
              'Cada tarjeta te dice los días, el horario, tu parte, el periodo y con quién lo repartes. Si además es tu coche, lleva la marca **Tu coche**.',
              'Toca la tarjeta para abrir la ficha del coche: mientras dure el reparto puedes anotar sus km y su combustible, comunicar incidencias o subir documentos.',
            ],
            shots: ['reparto'],
          },
        ],
        shots: { reparto: 'Vista Reparto' },
      },
      incidencia: {
        title: 'Comunicar una incidencia',
        lead: 'Una avería, un cambio de neumáticos, un mantenimiento puntual o cualquier otra petición a la gestión de flota.',
        intro: [
          {
            title: 'Cómo funciona la ventana',
            steps: [
              `Toca «${tab.incident}» en la barra de abajo. Se abre «Comunicar incidencia · matrícula», que va por pestañas: arriba ves en cuál estás (en verde las que ya has hecho), pasas a la siguiente con «Continuar» y vuelves con «Atrás» sin perder lo escrito. Solo la última pestaña envía.`,
            ],
            defs: [
              { term: 'Avería · Mantenimiento puntual', text: 'Incidencia › Disponibilidad › Documentos › Gestión' },
              { term: 'Cambio de neumáticos', text: 'Incidencia › Neumáticos › Documentos › Gestión' },
              { term: 'Petición general', text: 'Incidencia › Documentos › Gestión' },
            ],
            warn: '¿Ha sido un accidente? No lo comuniques aquí: usa [[accidente]], que tiene su propio parte.',
          },
        ],
        quick: [
          { label: 'Comunicar una avería', step: 1 },
          { label: 'Pedir coche de sustitución', step: 2 },
          { label: 'Cambiar neumáticos', step: 3 },
          { label: 'Adjuntar fotos', step: 4 },
        ],
        walk: [
          {
            tab: 'Incidencia',
            title: 'Pestaña «Incidencia»: qué pasa',
            steps: ['Es la primera y la más importante: aquí dices qué ocurre y con qué urgencia.'],
            defs: [
              { term: 'Tipo', text: '**Obligatorio.** Qué clase de incidencia es. Decide las pestañas que vendrán después.' },
              { term: 'Fecha', text: '**Obligatorio.** Cuándo ha pasado. Viene con la de hoy y no admite fechas futuras.' },
              { term: 'Prioridad', text: '**Obligatorio.** Crítica, Moderada, Funcional o Informativa. Por defecto, Moderada. La gestión ordena su bandeja por ella.' },
              { term: 'Descripción', text: '**Obligatorio.** Cuéntalo con tus palabras: qué notas, desde cuándo, si hay testigos encendidos… En Cambio de neumáticos va en su propia pestaña y es opcional.' },
              { term: 'Avería', text: 'El vehículo ha fallado: no está en condiciones de circular o no se puede usar con normalidad.' },
              { term: 'Mantenimiento puntual', text: 'Cosas rotas o cambios necesarios que no impiden conducir. El mantenimiento programado va por su plan, no por aquí.' },
              { term: 'Cambio de neumáticos', text: 'Por desgaste o pinchazo. El taller y la cita se concretan después, en la gestión.' },
              { term: 'Petición general', text: 'Peticiones que quizá no tienen que ver con el vehículo: documentación, tarjetas, dudas…' },
            ],
            note: 'Para continuar: tipo, fecha, prioridad y descripción rellenos. Si falta algo, «Continuar» sale apagado.',
            shots: ['incidencia-1', 'incidencia-1-neum'],
            shotLabels: ['Avería', 'Neumáticos'],
          },
          {
            tab: 'Disponibilidad',
            title: 'Pestaña «Disponibilidad»: cómo queda el coche',
            steps: ['Solo sale en Avería y Mantenimiento puntual. Elige una de las tres tarjetas:'],
            defs: [
              { term: 'Sigue en servicio', text: 'Puedo seguir conduciéndolo mientras se atiende. Es la que viene marcada.' },
              { term: 'No se puede usar', text: 'El coche se queda parado, pero no hace falta otro.' },
              { term: 'Necesito coche de sustitución', text: 'Se abre una solicitud de coche a administración, que decide si lo facilita. Obliga a adjuntar algún documento en la pestaña siguiente.' },
            ],
            note: 'Lo que elijas aquí no cambia el estado del vehículo en la app: lo registra la gestión, que es quien decide si el coche pasa a «Averiado» o «En mantenimiento».',
            shots: ['incidencia-2', 'incidencia-2-sust'],
            shotLabels: ['Sigue en servicio', 'Con sustitución'],
          },
          {
            tab: 'Neumáticos',
            title: 'Pestaña «Neumáticos»: el parte de ruedas',
            steps: ['Solo sale si el tipo es Cambio de neumáticos, y ocupa el sitio de «Disponibilidad». Arriba te recuerda qué es obligatorio.'],
            defs: [
              { term: 'Kilometraje actual', text: '**Obligatorio.** Viene con la última lectura del coche. Si ha rodado desde entonces, corrígelo.' },
              { term: 'Motivo del cambio', text: '**Obligatorio.** Desgaste o Pinchazo. Según lo que elijas cambian los campos de debajo.' },
              { term: '¿Qué ruedas? (desgaste)', text: 'Delanteras, Traseras o Las 4 ruedas, y las medidas de cada eje elegido.' },
              { term: '¿Qué rueda? (pinchazo)', text: 'Delantera o trasera, izquierda o derecha, y la medida de ese neumático.' },
              { term: 'Comentario', text: 'Opcional: cualquier cosa que ayude al taller.' },
            ],
            note: 'La medida viene escrita en el lateral del neumático, con este formato: 205/55 R16.',
            shots: ['incidencia-neumaticos'],
          },
          {
            tab: 'Documentos',
            title: 'Pestaña «Documentos»: lo que lo prueba',
            steps: [
              'Adjunta lo que ayude a entenderlo: fotos del daño, el presupuesto del taller… Se aceptan fotos y PDF, y puedes añadir varios.',
              'Toca «Adjuntar documento o foto»: puedes hacer la foto en el momento o elegirla de la galería.',
              'Cada archivo sale en una lista con su papelera por si te equivocas.',
              'Normalmente es opcional: puedes continuar sin adjuntar nada.',
            ],
            warn: 'Si pediste coche de sustitución, adjuntar al menos un documento es obligatorio. Y aparece una segunda caja, «Documentación del coche de sustitución», para los papeles del coche que ya te hayan dado. Esa sí es opcional.',
            note: 'Las fotos se comprimen solas antes de subirse, para que no gasten muchos datos.',
            shots: ['incidencia-3', 'incidencia-3-sust'],
            shotLabels: ['Opcional', 'Con sustitución'],
          },
          {
            tab: 'Gestión',
            title: 'Pestaña «Gestión»: dónde se arregla',
            steps: [
              'La última pestaña. Ayuda a la gestión a buscarte taller.',
              'Repasa con «Atrás» si quieres cambiar algo.',
              'Pulsa «Comunicar incidencia» para enviarla.',
            ],
            defs: [
              { term: 'Código postal de la ubicación preferente', text: 'Si lo sabes, el CP desde el que prefieres ir al taller más cercano (5 cifras). Es opcional: se completa al cerrar la incidencia.' },
            ],
            warn: 'Si escribes el código postal, que esté entero (5 cifras): a medias no deja enviar.',
            shots: ['incidencia-4'],
          },
          {
            tab: 'Al enviar',
            title: 'Y después de enviar, ¿qué?',
            steps: [
              'La incidencia aparece en la tarjeta Incidencias de tu coche, con su número en el título, hasta que se cierre.',
              'La gestión de flota la atiende: busca taller, cambia el estado del coche si hace falta y, cuando está resuelta, la cierra.',
              `Si pediste coche de sustitución, la solicitud aparece también en ${mode.profile} → Peticiones, donde ves si se ha concedido o rechazado.`,
            ],
            defs: [
              { term: 'Incidencia comunicada.', text: 'Ya la tiene la gestión.' },
              { term: '… Tu solicitud de coche de sustitución queda pendiente de administración.', text: 'El coche no llega por comunicarlo: administración decide y te lo dirá.' },
              { term: 'Sin conexión: la incidencia quedó guardada en el móvil…', text: 'Se enviará sola al recuperar la cobertura. No cierres sesión mientras tanto.' },
              { term: 'Incidencia comunicada; algún adjunto no se pudo subir.', text: `La incidencia está, pero falta un archivo: súbelo desde «${tab.document}».` },
            ],
          },
        ],
        shots: {
          'incidencia-1': 'Pestaña Incidencia con una avería',
          'incidencia-1-neum': 'Pestaña Incidencia con cambio de neumáticos',
          'incidencia-2': 'Pestaña Disponibilidad',
          'incidencia-2-sust': 'Disponibilidad con coche de sustitución',
          'incidencia-neumaticos': 'Pestaña Neumáticos',
          'incidencia-3': 'Pestaña Documentos',
          'incidencia-3-sust': 'Pestaña Documentos con coche de sustitución',
          'incidencia-4': 'Pestaña Gestión',
        },
      },
      accidente: {
        title: 'Parte de accidente',
        lead: 'Un parte guiado en cuatro pasos. Solo son obligatorios los datos del primer paso y la descripción de los daños: lo demás se puede completar después.',
        intro: [
          {
            title: 'Primero, tu seguridad',
            warn: 'Primero tu seguridad, después la app. Si hay heridos, llama al 112. El parte se puede rellenar más tarde, con calma y en un sitio seguro: la fecha y la hora se escriben a mano.',
            defs: [
              { term: 'Solo mi coche, sin nadie más', text: 'En «Implicados» no añades a nadie.' },
              { term: 'Hay otro vehículo', text: 'Implicados → Terceros.' },
              { term: 'Hay heridos', text: '112 · Implicados → Lesionados.' },
              { term: 'Aún no tengo el parte en papel', text: 'Se sube después.' },
              { term: 'No tengo cobertura', text: 'Se envía solo al volver la red.' },
            ],
          },
          {
            title: 'En el lugar del accidente',
            steps: [
              'Ponte a salvo: chaleco, luces de emergencia y triángulos o baliza.',
              '¿Hay heridos? Llama al 112 antes que nada.',
              'Fotos: los daños de los dos coches, las matrículas y el lugar (señales, marcas en el suelo…).',
              'Datos del otro conductor: nombre, matrícula, aseguradora y nº de póliza.',
              'Parte amistoso firmado por los dos, si hay otro coche. Hazle una foto.',
              'Si viene la policía, apunta el número del atestado.',
              'Rellena el parte en la app cuando estés en un sitio seguro.',
            ],
          },
          {
            title: `Dónde está el botón «${tab.accident}»`,
            defs: [
              { term: mode.vehicle, text: `En la barra de abajo: «${tab.accident}». Es lo normal: el parte es del coche que conduces.` },
              { term: 'Ficha del coche', text: `Entre sus botones, «${tab.accident}». Sirve también para un coche que tienes en reparto.` },
              { term: `${mode.fleet} (supervisores)`, text: `En la tarjeta de cada coche, «${tab.accident}», para comunicarlo en nombre del conductor. Queda registrado a tu nombre.` },
            ],
            note: 'Se abre «Comunicación de accidente · matrícula», con cuatro pasos arriba: Dónde y cuándo › Daños › Implicados › Atestado y archivo. Avanzas con «Continuar» y vuelves con «Atrás» sin perder nada.',
          },
        ],
        quick: [
          { label: 'Empezar el parte', step: 1 },
          { label: 'Contar los daños', step: 2 },
          { label: 'Añadir al otro conductor', step: 3 },
          { label: 'Subir el parte amistoso', step: 4 },
        ],
        walk: [
          {
            tab: 'Dónde y cuándo',
            title: 'Paso 1 · «Dónde y cuándo»',
            steps: ['Al abrirse, los obligatorios salen marcados con su chapa y «Continuar» está apagado. Se enciende cuando están todos.'],
            defs: [
              { term: 'Calle', text: '**Obligatorio.** Dónde ha sido. En carretera, su nombre y el punto kilométrico.' },
              { term: 'Número', text: 'Si lo hay.' },
              { term: 'Código postal', text: '**Obligatorio.** 5 cifras.' },
              { term: 'Localidad · Provincia', text: '**Obligatorio.** Las dos.' },
              { term: 'Fecha y hora', text: '**Obligatorio.** Cuándo ocurrió, no cuándo lo rellenas. No admite una hora futura.' },
              { term: 'Teléfono', text: '**Obligatorio.** Uno en el que te localicen estos días.' },
              { term: 'Prioridad', text: '**Obligatorio.** Crítica si el coche no puede circular o hay heridos; Moderada (la que viene puesta) para un golpe normal.' },
            ],
            shots: ['accidente-0', 'accidente-1'],
            shotLabels: ['Al abrir', 'Relleno'],
          },
          {
            tab: 'Daños',
            title: 'Paso 2 · «Daños»',
            defs: [
              { term: 'Descripción de los daños', text: '**Obligatorio.** Qué le ha pasado al coche y cómo ocurrió, en pocas frases.' },
              { term: 'CP del taller', text: 'Opcional. Si sabes a qué zona iría el coche a reparar.' },
            ],
            steps: [
              'Qué parte del coche: «puerta trasera derecha», «paragolpes delantero».',
              'Qué no funciona: «el piloto trasero está roto», «no abre la puerta».',
              'Cómo fue, sin culpas: «al salir de una rotonda, el otro coche…».',
            ],
            shots: ['accidente-2'],
          },
          {
            tab: 'Implicados',
            title: 'Paso 3 · «Implicados»',
            steps: [
              'Otros vehículos y personas heridas, si los hay. Es opcional: si solo ha sido tu coche, pulsa «Continuar» sin añadir a nadie.',
              'En **Terceros implicados** (otros vehículos) o en **Lesionados** (personas heridas), pulsa «+ Añadir».',
              'Se abre una ventana para esa persona. Rellénala y pulsa «Guardar».',
              'Cada persona queda en la lista en una línea, con el lápiz para corregirla y la papelera para quitarla. Añade tantas como haga falta.',
            ],
            defs: [
              { term: 'Tercero implicado', text: 'Nombre y apellidos y matrícula (**obligatorios**); marca, modelo, teléfono, aseguradora, nº de póliza y sus daños.' },
              { term: 'Lesionado', text: 'Nombre y apellidos (**obligatorio**); teléfono, correo, matrícula del coche en el que iba y plaza ocupada (Conductor u Ocupante).' },
            ],
            note: 'Qué pedirle al otro conductor: nombre y apellidos, matrícula, marca y modelo, teléfono, aseguradora y nº de póliza. Casi todo viene en el parte amistoso o en el recibo de su seguro.',
            shots: ['accidente-tercero', 'accidente-lesionado', 'accidente-3'],
            shotLabels: ['Tercero', 'Lesionado', 'La lista'],
          },
          {
            tab: 'Atestado y archivo',
            title: 'Paso 4 · «Atestado y archivo»',
            defs: [
              { term: 'Referencia del atestado', text: 'Opcional. Si ha intervenido la policía, el número que te den.' },
              { term: 'Archivo del parte', text: 'Opcional. La foto o el PDF del parte amistoso. Las fotos se comprimen solas.' },
            ],
            steps: ['Pulsa «Comunicar accidente».'],
            note: `¿Aún no tienes el parte o el atestado? Envía igual. Cuando los tengas, súbelos con «${tab.document}»: tipo Parte de accidente (o Fotos de daños) y, en «Ligado a», este accidente.`,
            shots: ['accidente-4'],
          },
          {
            tab: 'Al enviar',
            title: 'Y después de enviar, ¿qué?',
            defs: [
              { term: 'Accidente comunicado correctamente.', text: 'Ya lo tiene la gestión de flota.' },
              { term: 'Sin conexión: el accidente quedó guardado en el móvil (con su archivo)…', text: 'Se envía solo al recuperar la cobertura. No cierres sesión mientras tanto.' },
              { term: 'Accidente comunicado, pero no se pudo subir el archivo…', text: `El parte está; falta el archivo: súbelo desde «${tab.document}».` },
            ],
            steps: [
              'El accidente aparece en la tarjeta Accidentes de tu coche, con su número en el título.',
              'La gestión de flota lo tramita con el seguro, decide el estado del coche y, cuando está resuelto, lo cierra con el expediente del siniestro y quién asume el coste.',
              'Si te quedas sin coche para trabajar, díselo a tu supervisor o a la gestión.',
            ],
          },
        ],
        shots: {
          'accidente-0': 'Paso Dónde y cuándo, vacío',
          'accidente-1': 'Paso Dónde y cuándo, relleno',
          'accidente-2': 'Paso Daños',
          'accidente-tercero': 'Ventana Tercero implicado',
          'accidente-lesionado': 'Ventana Lesionado',
          'accidente-3': 'Lista de implicados',
          'accidente-4': 'Paso Atestado y archivo',
        },
        faq: [
          { q: '¿Lo comunico como accidente o como incidencia?', a: 'Si ha habido un golpe (con otro coche, un objeto, un animal…), es un accidente. Si el coche falla solo, sin golpe, es una [[incidencia]] de tipo avería.' },
          { q: 'El otro conductor no quiere firmar el parte amistoso', a: 'No discutas. Apunta su matrícula, haz fotos y, si hace falta, llama a la policía. En la app rellena lo que tengas: solo son obligatorios su nombre y su matrícula.' },
          { q: 'Me he equivocado en un dato después de enviar', a: 'Desde la app no se edita un parte enviado. Avisa a tu supervisor o a la gestión con el dato correcto.' },
          { q: 'Fue hace unos días y no lo comuniqué', a: 'Comunícalo igual, con la fecha y hora en que ocurrió. Cuanto antes, mejor para el seguro.' },
        ],
      },
      documentos: {
        title: 'Documentos',
        lead: 'Los papeles del coche (permiso de circulación, seguro…) y los tuyos (permiso de conducir…).',
        intro: [
          {
            title: '¿Qué necesitas hacer?',
            defs: [
              { term: 'Ver qué papeles tiene mi coche', text: 'Tarjeta «Documentación».' },
              { term: 'Tengo un papel nuevo y quiero guardarlo', text: `«${tab.document}» → Subir.` },
              { term: 'Me falta un papel', text: `«${tab.document}» → Pedir.` },
              { term: 'Quiero verlo o llevarlo en el móvil', text: 'Ojo · Descargar.' },
              { term: 'Un documento tiene un dato malo', text: 'Lápiz → Pedir corrección.' },
              { term: 'Sobra un documento', text: 'Papelera → Pedir borrado.' },
              { term: 'No me deja verlo', text: 'Llave → Pedir acceso.' },
            ],
            note: 'Desde la app no se cambia ni se borra nada directamente: subir y ver sí, pero corregir, borrar y ver lo restringido se pide, y lo decide la gestión de flota. Así ningún papel de la flota desaparece por error.',
          },
        ],
        quick: [
          { label: 'Ver mis papeles', step: 1 },
          { label: 'Subir un documento', step: 2 },
          { label: 'Pedir un documento', step: 6 },
          { label: 'Pedir una corrección', step: 8 },
          { label: 'Pedir acceso', step: 10 },
        ],
        walk: [
          {
            tab: 'Consultar',
            title: 'La tarjeta «Documentación»',
            steps: [
              `En la pantalla de ${mode.vehicle}, baja hasta **Documentación** y tócala para desplegarla. El número de al lado es cuántos documentos hay en total.`,
              'Dentro hay dos pestañas: **Documentación del coche** (permiso de circulación, ficha técnica, seguro, contrato…, que se quedan con el coche) y **Documentación del conductor** (tus papeles personales, que van contigo).',
              'Cada fila dice el tipo, el día en que se subió y, si caduca, cuándo caduca.',
            ],
            defs: [
              { term: 'Vigente', text: 'Está en regla.' },
              { term: 'Caducado', text: 'Ha pasado su fecha: hay que subir el nuevo (o pedirlo).' },
              { term: 'Pendiente de archivar', text: 'Ya está en la app y se guarda en el archivo de la empresa más tarde, solo.' },
              { term: 'Pendiente de borrado', text: 'Alguien ha pedido borrarlo y la gestión lo está revisando.' },
            ],
            note: 'No ves todos los documentos de la flota: solo los de tu coche que la gestión ha dejado ver al conductor, los que has subido tú y los tuyos personales. ¿Te falta alguno? Pídelo.',
            shots: ['documentos', 'documentos-personal'],
            shotLabels: ['Del coche', 'Del conductor'],
          },
          {
            tab: 'Subir · Qué quieres',
            title: 'Subir · 1 · «Qué quieres»',
            steps: [
              `Toca «${tab.document}» en la barra de abajo. Se abre «Documento · matrícula», y lo primero que pregunta es qué vienes a hacer.`,
              'Con tocar una de las dos tarjetas ya pasa a la siguiente pestaña: no hace falta pulsar «Continuar».',
            ],
            defs: [
              { term: 'Subir un documento', text: 'Tienes el papel (o una foto) y lo guardas en la ficha.' },
              { term: 'Pedir un documento', text: `No lo tienes: se lo pides a administración. Ver [[documentos#6]].` },
              { term: 'Del coche', text: 'Qué quieres › Tipo y documento › Ligado a › Notas' },
              { term: 'Personal (tuyo)', text: 'Qué quieres › Tipo y documento › Notas' },
            ],
            shots: ['doc-1-modo'],
          },
          {
            tab: 'Subir · Tipo',
            title: 'Subir · 2 · «Tipo y documento»',
            defs: [
              { term: 'Documento de', text: 'El vehículo (sus papeles) o El conductor · tu nombre (tus papeles personales). Si eliges el conductor, cambian los tipos y se salta Ligado a.' },
              { term: 'Tipo de documento', text: 'Del coche: permiso de circulación, ficha técnica, seguro, contrato, acta de devolución, parte de accidente, fotos de daños u Otro. Tuyos: permiso de conducir u Otro.' },
              { term: 'Foto o PDF', text: '**Obligatorio.** Toca la caja: haz la foto en el momento o elige un archivo del móvil. Se admiten fotos (JPG, PNG, HEIC…) y PDF.' },
              { term: 'Caducidad', text: 'Opcional. Solo sale en los que caducan: seguro, contrato y permiso de conducir.' },
            ],
            note: 'Haz la foto con buena luz, de frente y sin reflejos. Si el papel tiene varias hojas, mejor un PDF que varias fotos. Comprueba que se leen la matrícula, las fechas y los números.',
            shots: ['doc-2-archivo', 'doc-personal'],
            shotLabels: ['Del coche: el seguro', 'Tuyo: el permiso'],
          },
          {
            tab: 'Subir · Ligado a',
            title: 'Subir · 3 · «Ligado a»',
            steps: ['Aquí dices a qué incidencia del coche acompaña el documento. Si es personal, este paso no sale. Depende del tipo:'],
            defs: [
              { term: 'Fotos de daños', text: '**Obligatorio.** Elige la incidencia abierta de la que son las fotos.' },
              { term: 'Parte de accidente', text: '**Obligatorio.** Elige el accidente abierto. Si no hay ninguno, no se puede subir y la app te lo dice.' },
              { term: 'Contrato · Ficha técnica · Acta de devolución · Otro', text: 'Opcional: elige una incidencia si viene a cuento, o deja Ninguna.' },
              { term: 'Seguro · Permiso de circulación', text: 'No se ligan: la pestaña te dice que sigas al paso siguiente.' },
            ],
            note: 'Solo se ofrecen incidencias sin cerrar. Las fotos de una avería también puedes subirlas al comunicar la [[incidencia#4]].',
            shots: ['doc-3-ligado'],
          },
          {
            tab: 'Subir · Notas',
            title: 'Subir · 4 · «Notas» y subir',
            steps: [
              'Escribe en **Notas** (opcional) algo que ayude a reconocerlo después, por ejemplo «Póliza renovada en junio».',
              'Pulsa «Subir».',
              'Desde ahí puedes «Subir otro» o «Cerrar». El documento ya aparece en la tarjeta Documentación.',
            ],
            defs: [
              { term: 'Documento subido y archivado en Drive.', text: 'Todo listo.' },
              { term: 'Documento subido. Queda pendiente de archivar en Drive…', text: 'Ya está en la app; se archiva solo más tarde.' },
              { term: 'Estás sin conexión: el documento se subirá solo en cuanto vuelva la red.', text: 'Se queda en el móvil y se envía al recuperar cobertura. No cierres sesión mientras tanto.' },
            ],
            shots: ['doc-4-notas'],
          },
          {
            tab: 'Pedir',
            title: 'Pedir un documento que no tienes',
            steps: [
              'En «Qué quieres» elige **Pedir un documento**. Solo hay una pestaña más, «Qué pides».',
              'Pulsa «Enviar la petición». Verás «Petición enviada».',
              'Administración la ve en su bandeja y te facilita el documento (o te dice por qué no).',
              `Síguela en ${mode.profile} → Peticiones.`,
            ],
            defs: [
              { term: 'Documento de', text: 'Del vehículo o tuyo. Solo puedes pedir los tuyos, no los de otra persona.' },
              { term: 'Documento que necesitas', text: '**Obligatorio.** Permiso de circulación, ficha técnica, seguro, contrato, acta de devolución, permiso de conducir u Otro.' },
              { term: '¿Para qué lo necesitas?', text: '**Obligatorio.** Es lo que lee quien lo decide. Por ejemplo «Me la piden en el taller para el cambio de ruedas».' },
            ],
            warn: 'No se pueden pedir la factura de taller, las fotos de daños, el informe de ITV ni el parte de accidente. Y pedir necesita conexión: sin cobertura no se guarda para luego.',
            shots: ['doc-pedir'],
          },
          {
            tab: 'Ver y descargar',
            title: 'Ver y descargar',
            steps: [
              'Cada fila de la tarjeta Documentación lleva sus botones a la derecha.',
              '**Ver** lo abre dentro de la app, sin salir a otra web. Al cerrar la ventana, la copia desaparece del móvil.',
              '**Descargar** guarda una copia en tu móvil, con un nombre que dice qué es y de qué coche. Útil para enseñarlo sin cobertura.',
            ],
            defs: [
              { term: 'Ojo', text: 'Lo abre en la app.' },
              { term: 'Flecha', text: 'Guarda una copia en el móvil.' },
              { term: 'Lápiz', text: 'Pedir que se corrija.' },
              { term: 'Papelera', text: 'Pedir que se borre.' },
              { term: 'Llave', text: 'Sale en lugar del ojo o de la descarga: hay que pedir acceso.' },
              { term: 'Reloj de arena', text: 'Ya lo has pedido y la gestión aún no ha contestado.' },
            ],
            shots: ['documentos'],
          },
          {
            tab: 'Corregir',
            title: 'Pedir que se corrija un documento',
            steps: [
              'Toca el lápiz de la fila. Se abre «Corregir documento».',
              'Cambia lo que esté mal: el tipo de documento, la fecha de caducidad (solo en los que caducan) o la nota.',
              'En **Por qué hay que corregirlo** explícalo en una frase.',
              'Pulsa «Enviar petición». La gestión la aplica o la rechaza.',
            ],
            note: 'Esto no cambia el documento al momento: solo manda la petición. Un documento solo puede tener una petición a la vez.',
            shots: ['doc-corregir'],
          },
          {
            tab: 'Borrar',
            title: 'Pedir que se borre un documento',
            steps: [
              'Toca la papelera de la fila. Se abre «Pedir el borrado · documento».',
              'Si quieres, escribe el motivo: «Está repetido», «Es de otro coche»…',
              'Pulsa «Pedir borrado». El documento sigue en la lista con la chapa **Pendiente de borrado** hasta que la gestión decida.',
            ],
            defs: [
              { term: 'Borrarlo', text: 'Desaparece de la lista (la gestión lo guarda aparte por si hubiera que recuperarlo).' },
              { term: 'Ocultarlo', text: 'Se queda en la flota, pero deja de verse en la app de campo.' },
              { term: 'Rechazar', text: 'No se toca: vuelve a salir normal, sin la chapa.' },
            ],
            shots: ['doc-borrar'],
          },
          {
            tab: 'Pedir acceso',
            title: 'Pedir acceso a un documento',
            steps: [
              'La gestión decide, por tipo de documento, qué puede hacer el conductor con él. La línea bajo el nombre te lo dice.',
              'Toca la llave. Se abre «Pedir la lectura» (o la descarga) del documento.',
              'Escribe para qué lo necesitas (opcional) y pulsa «Enviar petición».',
              'Cuando la gestión te lo conceda, verás otra vez el ojo o la flecha.',
            ],
            defs: [
              { term: 'con solicitud', text: 'Hay que pedirlo: en vez del ojo o la flecha sale una llave.' },
              { term: 'pedida, pendiente de la gestión', text: 'Ya lo has pedido: sale un reloj de arena.' },
              { term: 'concedida', text: 'Te lo han concedido: vuelve el botón normal.' },
              { term: 'no permitida', text: 'No se puede ni pidiéndolo. El botón sale apagado.' },
            ],
            note: 'Un botón apagado no está roto: tócalo y te explica por qué no se puede. Si de verdad lo necesitas, habla con quien lleva la flota.',
            shots: ['doc-pedir-acceso', 'doc-no-permitido'],
            shotLabels: ['Con solicitud', 'No permitido'],
          },
        ],
        sections: [
          {
            title: 'Los tipos de documento, de un vistazo',
            defs: [
              { term: 'Permiso de circulación', text: 'Del coche · no caduca · no se liga · se puede pedir.' },
              { term: 'Ficha técnica', text: 'Del coche · no caduca · ligado opcional · se puede pedir.' },
              { term: 'Seguro', text: 'Del coche · caduca · no se liga · se puede pedir.' },
              { term: 'Contrato', text: 'Del coche · caduca · ligado opcional · se puede pedir.' },
              { term: 'Acta de devolución', text: 'Del coche · no caduca · ligado opcional · se puede pedir.' },
              { term: 'Fotos de daños', text: 'Del coche · ligado obligatorio · no se puede pedir.' },
              { term: 'Parte de accidente', text: 'Del coche · ligado a un accidente abierto · no se puede pedir.' },
              { term: 'Factura de taller · Informe de ITV', text: 'No se suben desde aquí: se adjuntan al cerrar la incidencia o al registrar la ITV.' },
              { term: 'Permiso de conducir', text: 'Tuyo · caduca · no se liga · se puede pedir.' },
              { term: 'Otro', text: 'Del coche o tuyo · ligado opcional · se puede pedir.' },
            ],
          },
        ],
        shots: {
          documentos: 'Tarjeta Documentación, pestaña del coche',
          'documentos-personal': 'Tarjeta Documentación, pestaña del conductor',
          'doc-1-modo': 'Pestaña Qué quieres',
          'doc-2-archivo': 'Subir el seguro del coche',
          'doc-personal': 'Subir el permiso de conducir',
          'doc-3-ligado': 'Pestaña Ligado a',
          'doc-4-notas': 'Pestaña Notas',
          'doc-pedir': 'Pestaña Qué pides',
          'doc-corregir': 'Ventana Corregir documento',
          'doc-borrar': 'Ventana Pedir el borrado',
          'doc-pedir-acceso': 'Pedir la lectura del contrato',
          'doc-no-permitido': 'Borrado no permitido',
        },
        faq: [
          { q: 'No encuentro un documento que sé que existe', a: `Puede que la gestión no lo haya dejado ver al conductor. Pídelo desde «${tab.document}» → Pedir un documento: sirve también para los que no ves en la lista.` },
          { q: 'Me he equivocado de tipo al subirlo', a: 'Toca el lápiz y pide la corrección. No lo borres y lo vuelvas a subir: perderías el archivo original y su historial.' },
          { q: 'Pone «Pendiente de archivar» desde hace días', a: 'El documento ya está guardado y lo puedes ver desde la app. Archivarlo en el Drive de la empresa se reintenta solo; si dura mucho, avisa a la gestión.' },
          { q: 'Al abrirlo dice «No se pudo abrir el documento»', a: 'Comprueba la cobertura e inténtalo de nuevo. Si sigue fallando con ese documento, puede que su archivo ya no exista: avisa a la gestión.' },
          { q: '¿Quién ve mis documentos personales?', a: 'Tú, tu supervisor y la gestión de flota. Tus documentos personales nunca se te ocultan a ti.' },
        ],
      },
      avisos: {
        title: 'Avisos y alertas',
        lead: '«Te queda poco», las alertas y los colores.',
        sections: [
          {
            title: 'Lo que tienes pendiente',
            steps: [
              'Al entrar verás arriba **Te queda poco** si falta algo: la lectura de km del mes, el consumo, una ITV o un mantenimiento cercano. Toca el aviso y se abre su formulario ahí mismo.',
              'Despliega la tarjeta **Alertas** para ver todo lo abierto del coche, con su nivel (Crítica, Aviso) y su fecha.',
              'Pulsa «Solucionar» en la alerta: normalmente es hacer lo que pide (registrar la lectura, la ITV, el mantenimiento…). Al guardarlo, la alerta se cierra.',
            ],
            note: 'Si no ves el bloque «Te queda poco», no tienes nada pendiente.',
            shots: ['home', 'alertas'],
            shotLabels: ['Te queda poco', 'Tarjeta Alertas'],
          },
          {
            title: '¿Qué significan los colores?',
            defs: [
              { term: 'Verde', text: 'Todo al día.' },
              { term: 'Ámbar', text: 'Se acerca la fecha o hace 15-30 días que no anotas.' },
              { term: 'Rojo', text: 'Vencido, a menos de 7 días, o más de 30 días sin anotar.' },
            ],
          },
        ],
        shots: { home: 'Bloque Te queda poco', alertas: 'Tarjeta Alertas desplegada' },
      },
      perfil: {
        title: 'Mi perfil',
        lead: 'Tus datos y tus peticiones. Tu ficha no se edita directamente: se pide el cambio.',
        sections: [
          {
            title: 'Tus datos y tus peticiones',
            steps: [
              `Entra en «${mode.profile}» o toca tus iniciales en la cabecera. Verás tu correo, teléfono, tipo de permiso y si tienes tarjeta de combustible.`,
              'Abajo, «Mis datos» abre una ventana en 3 pasos: **Tus datos** (corrige solo lo que esté mal), **Documentos** (revisa tus documentos personales) y **Enviar** (repasa lo que cambia, añade una nota y envía).',
              'La gestión de flota revisa la petición y la aplica o la rechaza.',
              'En **Peticiones** ves todo lo que has pedido, pendiente y resuelto (también lo rechazado). En **Mis documentos**, tus papeles personales.',
              `Desde el perfil, el botón «${tab.document}» sirve, por ejemplo, para subir tu permiso de conducir.`,
            ],
            shots: ['perfil', 'mis-datos'],
            shotLabels: ['Mi perfil', 'Mis datos'],
          },
        ],
        shots: { perfil: 'Mi perfil', 'mis-datos': 'Ventana Mis datos' },
      },
      flota: {
        title: 'Tu flota',
        lead: `Si supervisas coches, la vista «${mode.fleet}» es tu panel: lo que tienes, lo que hay que atender y cómo resolverlo sin salir de la app.`,
        quick: [
          { label: 'Ver cómo va mi flota', step: 1 },
          { label: 'Buscar un coche', step: 2 },
          { label: 'Apuntar en lugar del conductor', step: 3 },
          { label: 'Dar cita de ITV', step: 4 },
          { label: 'Enviar un recordatorio', step: 5 },
          { label: 'Atender lo pendiente', step: 6 },
          { label: 'Un coche se pasa de km', step: 7 },
        ],
        walk: [
          {
            tab: 'A tu cargo',
            title: `Entrar en «${mode.fleet}» y leer «A tu cargo»`,
            steps: [
              `Pulsa «${mode.fleet}» arriba. La barra de abajo cambia a «${tab.home}» «${tab.alerts}» «${tab.projection}».`,
              'Arriba, **Flota a cargo** te dice cuántos vehículos ves y cuántas lecturas de km faltan este mes.',
              'La tarjeta **A tu cargo** tiene dos bloques: lo que tienes (coches que supervisas y conductores que los llevan) y alertas e incidencias (cuántas alertas, incidencias y accidentes hay abiertos).',
              'Toca cualquier cifra y se abre su lista. Las alertas y las incidencias se resuelven ahí mismo, con el mismo formulario que en el resto de la app.',
            ],
            note: '«Vehículos» de arriba y «Coches» de A tu cargo pueden no coincidir: arriba cuenta también tu propio coche. A tu cargo se puede plegar tocando su título.',
            shots: ['flota', 'acargo-alertas'],
            shotLabels: ['A tu cargo', 'Al tocar Alertas'],
          },
          {
            tab: 'Lista de coches',
            title: 'La lista de coches',
            steps: [
              'Debajo de A tu cargo están todos tus coches, uno por tarjeta: matrícula, estado, quién lo lleva y sus kilómetros.',
              'Usa el buscador (matrícula, modelo, conductor…) y el filtro de estado para acotar.',
              'Si supervisas coches multiusuario, la lista se parte en **Flota general** y **Coches multiusuario**. En los multiusuario no hay conductor: tú registras sus km y su combustible.',
              'Toca la tarjeta para abrir la ficha del coche, con todos sus botones.',
            ],
            defs: [
              { term: 'Incidencia', text: 'Comunicarla en nombre del conductor.' },
              { term: 'Accidente', text: 'El parte de accidente.' },
              { term: 'Mantenimiento', text: 'Abre Actualizar por su pestaña de mantenimiento.' },
              { term: 'Recordatorio', text: 'Enviar recordatorio al conductor.' },
              { term: 'Programar ITV', text: 'Poner la cita de ITV.' },
              { term: 'Programar mantenimiento', text: 'Elegir su programa de mantenimiento.' },
            ],
            shots: ['flota-lista', 'ficha-campo'],
            shotLabels: ['La lista', 'La ficha'],
          },
          {
            tab: 'Ficha y Actualizar',
            title: 'La ficha del coche y la ventana «Actualizar»',
            steps: [
              'Toca un coche de la lista. Arriba ves sus km, sus próximas citas y su proyección; si falta la lectura del mes, un aviso con «Registrarla ahora».',
              'Debajo, sus botones: «Registrar km», «Consumo medio», «Registrar ITV» (si tiene cita), «Actualizar mantenimiento», «Programar ITV», «Programar mantenimiento», «Incidencia», «Accidente», «Pedir o subir documento» y «Enviar recordatorio».',
              '«Actualizar mantenimiento» abre «Actualizar · matrícula», desde donde pasas a Km, Combustible, ITV, Mantenimiento e Incidencias. Al guardar no se cierra: te dice qué guardó y sigues con otra pestaña.',
            ],
            note: '«Actualizar mantenimiento» solo abre la ventana cuando el mantenimiento está a 30 días o menos. Antes sale apagado: tócalo y te dice cuándo es.',
            warn: 'Aviso de responsabilidad: registrar es tarea del conductor, y lo que hagas tú queda a tu nombre. Lo recuerda un recuadro ámbar al abrir estas ventanas.',
            shots: ['ficha-acciones', 'actualizar', 'actualizar-incidencias'],
            shotLabels: ['Sus botones', 'Actualizar · Km', 'Actualizar · Incidencias'],
          },
          {
            tab: 'Programar',
            title: 'Programar la ITV y el mantenimiento',
            steps: [
              '**Programar ITV:** la fecha de la ITV (**obligatoria**, la que te haya dado la estación) y, si quieres, el CP preferente (5 cifras). Si ya tenía cita, guardar la corrige: la cita es una.',
              '**Programar mantenimiento:** elige el programa del catálogo (por ejemplo Revisión general), indica desde cuándo cuenta (la fecha, los km o los dos) y guarda. Los km se cargan del coche de un toque.',
            ],
            note: 'Un coche solo tiene un mantenimiento programado a la vez; quitar una cita lo hace administración. Se puede programar también en un coche cubierto por uno de sustitución.',
            shots: ['programar-itv', 'programar-mantenimiento'],
            shotLabels: ['ITV', 'Mantenimiento'],
          },
          {
            tab: 'Recordatorio',
            title: 'Enviar un recordatorio al conductor',
            steps: [
              'El icono del sobre de la tarjeta (o «Enviar recordatorio» en la ficha) abre «Recordatorio · matrícula», con el nombre del conductor arriba.',
              'Pulsa «Enviar». La ventana dice qué ha pasado: «Correo enviado.», «Alerta creada en la app.» o por qué no salió el correo.',
            ],
            defs: [
              { term: 'Motivo', text: 'Lectura de km sin registrar, ITV o Mantenimiento. Cada opción enseña su fecha para que veas si de verdad toca.' },
              { term: 'Cómo', text: 'Enviar correo y/o Crear alerta en la app.' },
              { term: 'Correo', text: 'Plantilla de gestión (tu mensaje va dentro) o Texto propio.' },
              { term: 'Mensaje adicional', text: 'Opcional, con la plantilla.' },
            ],
            warn: 'Si el coche no tiene conductor, la ventana te avisa: el correo no se podrá entregar.',
            shots: ['recordatorio'],
          },
          {
            tab: 'Bandeja',
            title: 'La bandeja de alertas de toda tu flota',
            steps: [
              `Pulsa «${tab.alerts}» en la barra de abajo.`,
              'Hay tres tarjetas plegadas: Alertas, Incidencias y Accidentes, cada una con cuántas hay abiertas.',
              'Despliega una: cada fila dice de qué coche es. Arriba puedes buscar, filtrar por tipo y ordenar por prioridad o por fecha.',
              'Pulsa «Solucionar» en una alerta: se abre lo que pide. Al guardarlo, la alerta se cierra. «Ver cerradas» enseña lo que ya está resuelto.',
            ],
            note: 'En una alerta la prioridad es su nivel (lo calcula la app según lo cerca que esté la fecha); en una incidencia la marca quien la abrió.',
            shots: ['bandeja', 'bandeja-alertas'],
            shotLabels: ['Bandeja', 'Alertas desplegadas'],
          },
          {
            tab: 'Proyección km',
            title: 'Proyección km: quién se va a pasar del contrato',
            steps: [
              `Pulsa «${tab.projection}». Arriba: cuántos vehículos, cuántos a vigilar y cuántos en riesgo. Filtra con los chips.`,
              'Cada tarjeta enseña el % de km gastado, la media mensual frente a la contratada, la proyección a fin de contrato y los km restantes. Si se va a pasar, el exceso estimado en km y euros.',
              'Si el coche tiene la alerta de exceso, pulsa «Resolver»: propón a alguien de tu flota que ruede menos, o elige «Nadie de la lista — lo explico abajo», y pulsa «Enviar propuesta».',
            ],
            note: 'No se cambia nada en ese momento: la propuesta la decide administración, y el cambio de conductor lo hace la gestión. Al conductor no se le enseña esta alerta.',
            shots: ['proyeccion', 'exceso-resolver'],
            shotLabels: ['Proyección', 'Resolver'],
          },
        ],
        shots: {
          flota: 'Vista Flota con A tu cargo',
          'acargo-alertas': 'Lista de alertas abierta desde A tu cargo',
          'flota-lista': 'Lista de coches de la flota',
          'ficha-campo': 'Ficha de un coche',
          'ficha-acciones': 'Botones de la ficha',
          actualizar: 'Ventana Actualizar, pestaña Km',
          'actualizar-incidencias': 'Ventana Actualizar, pestaña Incidencias',
          'programar-itv': 'Programar ITV',
          'programar-mantenimiento': 'Programar mantenimiento',
          recordatorio: 'Ventana Recordatorio',
          bandeja: 'Bandeja de alertas',
          'bandeja-alertas': 'Bandeja con las alertas desplegadas',
          proyeccion: 'Proyección de km',
          'exceso-resolver': 'Proponer otro conductor',
        },
      },
      offline: {
        title: 'Sin cobertura',
        lead: 'Lo que registres sin red no se pierde.',
        sections: [
          {
            title: 'Qué pasa sin conexión',
            steps: [
              'Si guardas algo sin conexión, la app lo deja en cola y te lo dice con un aviso ámbar bajo la cabecera.',
              'El botón de esa acción lleva un punto ámbar mientras espera.',
              'Cuando vuelve la conexión, se envía solo (o toca el aviso para enviarlo ya) y te dice lo que se ha mandado.',
            ],
            warn: 'No cierres sesión ni borres los datos del navegador mientras haya cosas en cola, o se perderían.',
            note: 'Los capítulos de esta ayuda que ya hayas abierto se pueden leer sin cobertura. El vídeo necesita conexión.',
          },
        ],
      },
      preguntas: {
        title: 'Preguntas frecuentes',
        lead: 'Las dudas más habituales.',
        faq: [
          { q: 'Me sigue llegando el correo de los km aunque ya los registré', a: 'Comprueba que la lectura se guardó y que no está en cola por falta de cobertura ([[offline]]). El recordatorio deja de llegar en cuanto la lectura del mes está registrada.' },
          { q: 'No puedo pulsar el botón de ITV o mantenimiento', a: 'Solo se activan desde 30 días antes de la cita. Tócalo igualmente: te dirá la fecha de la cita y desde qué día podrás registrarla.' },
          { q: 'No veo el botón de ITV', a: 'Tu coche no tiene ninguna ITV programada. Las citas las pone administración o tu supervisor.' },
          { q: 'He puesto mal un dato en un documento', a: 'Toca el lápiz del documento y pide la corrección ([[documentos#8]]). No hace falta borrarlo y volver a subirlo.' },
          { q: '¿Puedo cambiar el estado de mi coche a «averiado»?', a: 'No directamente. Comunica una incidencia y di cómo queda el coche en Disponibilidad ([[incidencia#2]]); la gestión cambia el estado.' },
          { q: 'Se me ha cerrado la sesión de repente', a: 'Pasa a las 2 horas, tras un rato sin usarla o si has entrado con tu usuario en otro dispositivo. Vuelve a entrar.' },
          { q: '¿La app está en inglés?', a: 'Sí: cambia el idioma con ES / EN en la cabecera (también en la pantalla de entrada).' },
        ],
      },
    },
  }
}

const en = (t: AppCopy): TutorialCopy => {
  const tab = t.shell.tabs
  const mode = t.shell.mode
  return {
    ui: {
      title: 'Help',
      subtitle: 'How to use the fleet app',
      back: 'Back',
      backToApp: 'Back to the app',
      backToHelp: 'Back to help',
      indexLabel: 'Help chapters',
      search: 'Search the help',
      searchPlaceholder: 'E.g.: puncture, km, insurance, accident…',
      clearSearch: 'Clear the search',
      results: (n) => `${n} result${n === 1 ? '' : 's'}`,
      noResults: (q) => `Nothing matches “${q}”.`,
      coverEyebrow: 'Gransolar · Drivers’ guide',
      coverTitle: 'Fleet manual',
      coverText:
        'How to use the fleet app on your phone: log km and fuel use, report incidents and accidents, and manage your car’s documents. Search for what you need or open a chapter.',
      finderLabel: 'What do you need to do?',
      tocLabel: 'Help contents',
      islandLabel: 'Tutorials',
      allChapters: 'All tutorials',
      footer:
        'The screenshots come from the app itself, with sample data. Nothing you tap in this help changes anything in the app.',
      start: 'Start from the beginning',
      watchVideo: 'Watch the video (under 3 min)',
      resume: 'Pick up where you left off',
      tasksTitle: 'Common tasks',
      chaptersTitle: 'Chapters',
      progress: (seen, n) => `${seen} of ${n} read`,
      read: 'Read',
      quickTitle: 'What do you want to do?',
      walkLabel: 'Step by step',
      stepOf: (i, n) => `Step ${i} of ${n}`,
      prev: 'Back',
      next: 'Continue',
      prevChapter: 'Previous',
      nextChapter: 'Next',
      pagerLabel: 'Previous and next chapter',
      faqTitle: 'Common questions',
      moreFaq: 'More questions, by chapter',
      shotPending: 'Screenshot pending',
      zoom: 'Enlarge',
      close: 'Close',
      showAll: 'Also show supervisor chapters',
      otherAudience: 'Supervisors only',
      videoFallback: 'Your browser cannot play this video. Below is what it says, scene by scene.',
      videoOffline: 'The video needs a connection. Below is what it says, scene by scene.',
      videoLangHint: 'The English version of the video is on its way: for now it plays in Spanish. The scenes below are in English.',
      videoScenesTitle: 'What the video shows',
      videoScenesHint: 'Tap the time to jump to that scene, or the chapter name to see it step by step.',
      videoSeek: (time) => `Go to ${time} in the video`,
    },
    groups: {
      start: 'First steps',
      car: 'Your car',
      events: 'If something happens',
      papers: 'Papers and alerts',
      supervisor: 'If you supervise',
      other: 'Other',
    },
    audience: { driver: 'Drivers', supervisor: 'Supervisors only' },
    chapters: {
      video: {
        title: 'Introduction video',
        lead: 'The app in under three minutes. No sound: the text is on screen.',
      },
      entrar: {
        title: 'Sign in to the app',
        lead: 'With the link your company gave you, your username and your password.',
        sections: [
          {
            title: 'Sign in',
            steps: [
              'On your phone, open the field app link the company gave you. It also comes in the reminder emails, in the «Open the field app» button.',
              'Enter your username or email and your password and tap «Sign in».',
              'At the top right you can change the language: «ES» / «EN».',
              'If it asks, allow notifications: that way it will remind you of what you have pending.',
            ],
            note: 'For security, your session closes by itself after 2 hours, or sooner if you leave it unused for a while. And it can only be open on one device at a time: if you sign in from another one, the first one is signed out.',
            warn: 'Do you sign in and it says you don’t have access? That’s because you don’t have a car assigned yet or your user doesn’t have permission for this app. Request access from that same screen or talk to administration.',
            shots: ['login'],
          },
        ],
        shots: { login: 'Sign-in screen' },
      },
      pantalla: {
        title: 'Get to know the screen',
        lead: 'The app is not the same for everyone: what you see depends on whether you drive, supervise or both.',
        sections: [
          {
            title: 'What does each person see?',
            defs: [
              { term: mode.vehicle, text: `The car you drive. Driver: always. Supervisor: only if you also drive a car; if not, it sends you to «${mode.fleet}».` },
              { term: mode.shares, text: 'Cars you share. Only shown if you have one shared.' },
              { term: mode.fleet, text: 'The cars you supervise. Only supervisors see it.' },
              { term: mode.profile, text: 'Your details, documents and requests. Everyone sees it.' },
              { term: 'Bottom bar', text: `The actions for your car. In «${mode.fleet}» it changes to «${tab.home}» · «${tab.alerts}» · «${tab.projection}».` },
            ],
            note: 'If you don’t see one of the buttons listed here, it is not a fault: your user doesn’t have that role or there is nothing to show in it.',
          },
          {
            title: 'If you drive',
            audience: 'driver',
            tab: 'Drivers',
            steps: [
              `**Header.** The language («ES» / «EN»), your initials (they open ${mode.profile}) and the red button to sign out.`,
              `**Views.** «${mode.vehicle}», «${mode.shares}» (only if you share a car) and «${mode.profile}». You won’t see «${mode.fleet}»: it is for supervisors.`,
              '**Due soon.** What you need to do soon. If it doesn’t appear, you have nothing pending.',
              '**Your car.** Plate, state and model. «View card» opens the full vehicle card.',
              '**Current km and Upcoming dates.** The last reading, the best day to log the month’s km and the MOT and maintenance dates. Further down, collapsed: Alerts, Incidents, Accidents and Documentation, each with its count.',
              `**Bottom bar.** The actions for your car: «${tab.km}» «${tab.fuel}» «${tab.itv}» «${tab.maintenance}» «${tab.incident}» «${tab.accident}» «${tab.document}». MOT only appears if your car has an appointment scheduled.`,
            ],
            shots: ['home'],
          },
          {
            title: 'If you supervise',
            audience: 'supervisor',
            tab: 'Supervisors',
            steps: [
              `What you see when you tap «${mode.fleet}». The app remembers the last view you used.`,
              `**Views.** You also have «${mode.fleet}». If you also drive a car, you still have «${mode.vehicle}» for yours.`,
              '**Fleet in my care.** How many cars you see and how many km readings are missing this month.',
              '**In your charge.** Your vehicles and your drivers. Tap a figure to see the list.',
              '**Alerts and incidents.** What is open on your cars; you resolve them right there, from each list. Further down is the list of cars, with a search box.',
              `**Bottom bar.** In «${mode.fleet}» it changes: «${tab.home}» «${tab.alerts}» «${tab.projection}». What you do with a car (km, MOT, reminder…) is on its card.`,
            ],
            note: 'Everything about supervising is explained in [[flota]].',
            shots: ['flota'],
          },
        ],
        shots: { home: 'A driver’s My vehicle view', flota: 'A supervisor’s Fleet view' },
      },
      km: {
        title: 'Log your km',
        lead: 'Once a month, what the car’s dashboard shows.',
        sections: [
          {
            title: 'Log the reading',
            steps: [
              `Tap «${tab.km}» on the bottom bar. “Log kilometres” opens with your car’s plate.`,
              'At the top it reminds you of the last reading and its date: the new one must be the same or higher.',
              'The reading date is already set to today.',
              'In **Odometer (total km on the dashboard)** enter the kilometres the car shows, without dots.',
              'Tap «Save reading».',
            ],
            note: 'When? On the Current km card you will see the best day to log the km for the month. While the reading is missing you will get a reminder email.',
            warn: 'Check the figure carefully before saving: one digit too many or too few changes the kilometre calculations for the car’s contract.',
            shots: ['km'],
          },
        ],
        shots: { km: 'Log kilometres window' },
      },
      combustible: {
        title: 'Note your consumption',
        lead: 'The average consumption shown by the on-board computer.',
        sections: [
          {
            title: 'Note the average consumption',
            steps: [
              'Check the on-board computer for the average consumption of your last trip or refuelling cycle (l/100 km, or kWh/100 km if it is electric).',
              `Tap «${tab.fuel}». “Average consumption” opens.`,
              'Enter the figure in **Actual average consumption at that moment** (for example 6.4). The date is already filled in.',
              'Tap «Save consumption». Below you will see your last entry.',
            ],
            warn: 'Do not note the “historical consumption” or the vehicle’s total accumulated figure: only the one for the last trip. You don’t need to enter litres or amounts.',
            shots: ['combustible'],
          },
        ],
        shots: { combustible: 'Average consumption window' },
      },
      itv: {
        title: 'MOT',
        lead: 'Once you have passed the MOT, you record it here.',
        sections: [
          {
            title: 'Log the MOT',
            steps: [
              `Tap «${tab.itv}». At the top you will see the scheduled next MOT.`,
              'Enter the MOT date (the «Today» button fills it in).',
              'Choose the result: **Passed** closes the MOT alerts; **Failed** leaves the appointment pending.',
              'If you can, add the MOT report (photo or PDF) and tap «Log MOT».',
            ],
            note: 'The button can be used from 30 days before the appointment. If it is not due yet, it looks greyed out: tap it anyway and it will tell you when the appointment is and from what day you can log it.',
            warn: 'The appointment is scheduled by administration or your supervisor. If your car has no MOT scheduled, the MOT button does not appear.',
            shots: ['itv'],
          },
        ],
        shots: { itv: 'Log MOT window' },
      },
      mantenimiento: {
        title: 'Maintenance',
        lead: 'Once your car’s planned service is done, you record it here.',
        sections: [
          {
            title: 'Mark the maintenance as done',
            steps: [
              `Tap «${tab.maintenance}». You will see the car’s plan (for example General service), how often it is due and when the next one is.`,
              'Once it is done, tap «Mark as done» and fill in the date and the km.',
            ],
            note: 'The button can be used from 30 days before the due date. If it is not due yet, it looks greyed out: tap it anyway and it will tell you when it is due and from what day you can log it.',
            warn: 'The maintenance plan is scheduled by administration or your supervisor. Repairs that come up along the way do not go here: report them as an [[incidencia]].',
            shots: ['mantenimiento'],
          },
        ],
        shots: { mantenimiento: 'Update maintenance window' },
      },
      reparto: {
        title: 'Shared cars',
        lead: 'Cars you use on some days or for some hours, together with other people.',
        sections: [
          {
            title: `The «${mode.shares}» view`,
            steps: [
              `If you have a shared car, «${mode.shares}» appears at the top. If not, that view doesn’t show.`,
              'Each card shows the days, the time slot, your share, the period and who you share it with. If it’s also your own car, it carries the **Your car** badge.',
              'Tap the card to open the car’s details: while the sharing lasts you can log its km and fuel, report incidents or upload documents.',
            ],
            shots: ['reparto'],
          },
        ],
        shots: { reparto: 'Shared view' },
      },
      incidencia: {
        title: 'Report an incident',
        lead: 'A breakdown, a tyre change, one-off maintenance or any other request to fleet management.',
        intro: [
          {
            title: 'How the window works',
            steps: [
              `Tap «${tab.incident}» on the bottom bar. “Report an incident · plate” opens, and it works in tabs: at the top you see which one you are on (the ones you have finished are in green), you move on with «Continue» and go back with «Back» without losing what you wrote. Only the last tab sends it.`,
            ],
            defs: [
              { term: 'Breakdown · One-off maintenance', text: 'Incident › Availability › Documents › Management' },
              { term: 'Tyre change', text: 'Incident › Tyres › Documents › Management' },
              { term: 'General request', text: 'Incident › Documents › Management' },
            ],
            warn: 'Was it an accident? Don’t report it here: use [[accidente]], which has its own report.',
          },
        ],
        quick: [
          { label: 'Report a breakdown', step: 1 },
          { label: 'Ask for a replacement car', step: 2 },
          { label: 'Change tyres', step: 3 },
          { label: 'Attach photos', step: 4 },
        ],
        walk: [
          {
            tab: 'Incident',
            title: '“Incident” tab: what is happening',
            steps: ['This is the first and most important one: here you say what is happening and how urgent it is.'],
            defs: [
              { term: 'Type', text: '**Required.** What kind of incident it is. It decides the tabs that come next.' },
              { term: 'Date', text: '**Required.** When it happened. It comes set to today and does not accept future dates.' },
              { term: 'Priority', text: '**Required.** Critical, Moderate, Functional or Informative. By default, Moderate. Management sorts its inbox by it.' },
              { term: 'Description', text: '**Required.** Explain it in your own words: what you notice, since when, whether any warning lights are on… For a Tyre change it goes in its own tab and is optional.' },
              { term: 'Breakdown', text: 'The vehicle has failed: it is not roadworthy or cannot be used normally.' },
              { term: 'One-off maintenance', text: 'Broken things or needed changes that do not prevent driving. Scheduled maintenance goes through its plan, not here.' },
              { term: 'Tyre change', text: 'Due to wear or a puncture. The workshop and appointment are set later, by management.' },
              { term: 'General request', text: 'Requests that may not be related to the vehicle: paperwork, cards, questions…' },
            ],
            note: 'To continue: type, date, priority and description filled in. If anything is missing, «Continue» is greyed out.',
            shots: ['incidencia-1', 'incidencia-1-neum'],
            shotLabels: ['Breakdown', 'Tyres'],
          },
          {
            tab: 'Availability',
            title: '“Availability” tab: how the car is left',
            steps: ['It only appears for Breakdown and One-off maintenance. Choose one of the three cards:'],
            defs: [
              { term: 'Still in service', text: 'I can keep driving it while it is handled. This one is selected by default.' },
              { term: 'Cannot be used', text: 'The car stays off the road, but no other one is needed.' },
              { term: 'I need a replacement car', text: 'A car request is opened for administration, who decide whether to provide one. You must attach a document in the next tab.' },
            ],
            note: 'What you choose here does not change the vehicle’s state in the app: management records it, and they decide whether the car goes to “Broken down” or “Maintenance”.',
            shots: ['incidencia-2', 'incidencia-2-sust'],
            shotLabels: ['Still in service', 'With replacement'],
          },
          {
            tab: 'Tyres',
            title: '“Tyres” tab: the tyre report',
            steps: ['It only appears if the type is Tyre change, and it takes the place of “Availability”. At the top it reminds you what is required.'],
            defs: [
              { term: 'Current mileage', text: '**Required.** It comes with the car’s last reading. If you have driven since then, correct it.' },
              { term: 'Reason for replacement', text: '**Required.** Wear or Puncture. The fields below change depending on what you choose.' },
              { term: 'Which tyres? (wear)', text: 'Front, Rear or All 4 tyres, and the sizes for each axle chosen.' },
              { term: 'Which tyre? (puncture)', text: 'Front or rear, left or right, and the size of that tyre.' },
              { term: 'Comment', text: 'Optional: anything that helps the workshop.' },
            ],
            note: 'The size is written on the side of the tyre, in this format: 205/55 R16.',
            shots: ['incidencia-neumaticos'],
          },
          {
            tab: 'Documents',
            title: '“Documents” tab: the proof',
            steps: [
              'Attach whatever helps explain it: photos of the damage, the workshop quote… Photos and PDFs are accepted, and you can add several.',
              'Tap «Attach a document or photo»: you can take the photo there and then or choose it from your gallery.',
              'Each file appears in a list with its bin in case you make a mistake.',
              'It is usually optional: you can continue without attaching anything.',
            ],
            warn: 'If you asked for a replacement car, attaching at least one document is required. And a second box appears, “Replacement car paperwork”, for the papers of the car you have already been given. That one is optional.',
            note: 'Photos are compressed automatically before uploading, so they don’t use much data.',
            shots: ['incidencia-3', 'incidencia-3-sust'],
            shotLabels: ['Optional', 'With replacement'],
          },
          {
            tab: 'Management',
            title: '“Management” tab: where it gets fixed',
            steps: [
              'The last tab. It helps management find you a workshop.',
              'Go back with «Back» if you want to change anything.',
              'Tap «Report incident» to send it.',
            ],
            defs: [
              { term: 'Preferred location postal code', text: 'If you know it, the postcode you would rather go to the nearest workshop from (5 digits). It is optional: it is filled in when the incident is closed.' },
            ],
            warn: 'If you enter the postcode, make sure it is complete (5 digits): a partial one won’t let you send.',
            shots: ['incidencia-4'],
          },
          {
            tab: 'After sending',
            title: 'And after sending, what next?',
            steps: [
              'The incident appears on your car’s Incidents card, with its count in the title, until it is closed.',
              'Fleet management handles it: they find a workshop, change the car’s state if needed and, once it is resolved, close it.',
              `If you asked for a replacement car, the request also appears in ${mode.profile} → Requests, where you can see whether it has been granted or rejected.`,
            ],
            defs: [
              { term: 'Incident reported.', text: 'Management has it now.' },
              { term: '… Your replacement car request is pending with administration.', text: 'Reporting it doesn’t bring the car: administration decides and will let you know.' },
              { term: 'Offline: the incident was saved on this device…', text: 'It will be sent automatically when you get signal back. Don’t sign out in the meantime.' },
              { term: 'Incident reported; an attachment could not be uploaded.', text: `The incident is there, but a file is missing: upload it from «${tab.document}».` },
            ],
          },
        ],
        shots: {
          'incidencia-1': 'Incident tab with a breakdown',
          'incidencia-1-neum': 'Incident tab with a tyre change',
          'incidencia-2': 'Availability tab',
          'incidencia-2-sust': 'Availability with a replacement car',
          'incidencia-neumaticos': 'Tyres tab',
          'incidencia-3': 'Documents tab',
          'incidencia-3-sust': 'Documents tab with a replacement car',
          'incidencia-4': 'Management tab',
        },
      },
      accidente: {
        title: 'Accident report',
        lead: 'A guided report in four steps. Only the first step and the damage description are required: you can complete the rest later.',
        intro: [
          {
            title: 'Your safety first',
            warn: 'Your safety first, the app later. If anyone is hurt, call 112. You can fill in the report later, calmly and somewhere safe: you type in the date and time yourself.',
            defs: [
              { term: 'Only my car, nobody else', text: 'Don’t add anyone under “People involved”.' },
              { term: 'Another vehicle was involved', text: 'People involved → Third parties.' },
              { term: 'Someone is injured', text: '112 · People involved → Injured people.' },
              { term: 'I don’t have the paper report yet', text: 'Upload it later.' },
              { term: 'I have no signal', text: 'It’s sent automatically once you’re back online.' },
            ],
          },
          {
            title: 'At the scene of the accident',
            steps: [
              'Get to safety: hi-vis vest, hazard lights and warning triangles or beacon.',
              'Anyone injured? Call 112 before anything else.',
              'Photos: the damage to both cars, the registration plates and the scene (signs, marks on the road…).',
              'The other driver’s details: name, registration, insurer and policy number.',
              'Joint accident report form signed by both of you, if another car is involved. Take a photo of it.',
              'If the police come, write down the police report number.',
              'Fill in the report in the app once you’re somewhere safe.',
            ],
          },
          {
            title: `Where to find the «${tab.accident}» button`,
            defs: [
              { term: mode.vehicle, text: `In the bottom bar: «${tab.accident}». This is the usual way: the report belongs to the car you drive.` },
              { term: 'Car details', text: `Among its buttons, «${tab.accident}». It also works for a car you have shared.` },
              { term: `${mode.fleet} (supervisors)`, text: `On each car’s card, «${tab.accident}», to report it on behalf of the driver. It’s recorded under your name.` },
            ],
            note: 'This opens “Accident report · registration”, with four steps at the top: Where and when › Damage › People involved › Police report and file. Move forward with «Continue» and go back with «Back» without losing anything.',
          },
        ],
        quick: [
          { label: 'Start the report', step: 1 },
          { label: 'Describe the damage', step: 2 },
          { label: 'Add the other driver', step: 3 },
          { label: 'Upload the joint report', step: 4 },
        ],
        walk: [
          {
            tab: 'Where and when',
            title: 'Step 1 · “Where and when”',
            steps: ['When it opens, required fields carry their badge and «Continue» is disabled. It turns on once they’re all filled in.'],
            defs: [
              { term: 'Street', text: '**Required.** Where it happened. On a road, its name and the kilometre marker.' },
              { term: 'Number', text: 'If there is one.' },
              { term: 'Postal code', text: '**Required.** 5 digits.' },
              { term: 'Town / city · Province', text: '**Required.** Both.' },
              { term: 'Date and time', text: '**Required.** When it happened, not when you fill it in. A future time isn’t accepted.' },
              { term: 'Phone', text: '**Required.** One where you can be reached over the next few days.' },
              { term: 'Priority', text: '**Required.** Critical if the car can’t be driven or someone is injured; Moderate (the default) for an ordinary bump.' },
            ],
            shots: ['accidente-0', 'accidente-1'],
            shotLabels: ['On opening', 'Filled in'],
          },
          {
            tab: 'Damage',
            title: 'Step 2 · “Damage”',
            defs: [
              { term: 'Damage description', text: '**Required.** What happened to the car and how, in a few sentences.' },
              { term: 'Workshop postal code', text: 'Optional. If you know which area the car would go to for repair.' },
            ],
            steps: [
              'Which part of the car: “rear right door”, “front bumper”.',
              'What doesn’t work: “the rear light is broken”, “the door won’t open”.',
              'How it happened, without blame: “coming out of a roundabout, the other car…”.',
            ],
            shots: ['accidente-2'],
          },
          {
            tab: 'People involved',
            title: 'Step 3 · “People involved”',
            steps: [
              'Other vehicles and injured people, if any. It’s optional: if only your car was involved, tap «Continue» without adding anyone.',
              'Under **Third parties involved** (other vehicles) or **Injured people**, tap «+ Add».',
              'A window opens for that person. Fill it in and tap «Save».',
              'Each person appears in the list on one line, with the pencil to correct it and the bin to remove it. Add as many as you need.',
            ],
            defs: [
              { term: 'Third party involved', text: 'Full name and registration (**required**); make, model, phone, insurer, policy number and their damage.' },
              { term: 'Injured person', text: 'Full name (**required**); phone, email, registration of the car they were in and seat occupied (Driver or Passenger).' },
            ],
            note: 'What to ask the other driver: full name, registration, make and model, phone, insurer and policy number. Almost all of it is on the joint accident report form or their insurance receipt.',
            shots: ['accidente-tercero', 'accidente-lesionado', 'accidente-3'],
            shotLabels: ['Third party', 'Injured person', 'The list'],
          },
          {
            tab: 'Police report and file',
            title: 'Step 4 · “Police report and file”',
            defs: [
              { term: 'Police report reference', text: 'Optional. If the police were involved, the number they give you.' },
              { term: 'Accident report file', text: 'Optional. The photo or PDF of the joint accident report form. Photos are compressed automatically.' },
            ],
            steps: ['Tap «Report accident».'],
            note: `Don’t have the report or the police report yet? Send it anyway. Once you have them, upload them with «${tab.document}»: type Accident report (or Damage photos) and, under “Linked to”, this accident.`,
            shots: ['accidente-4'],
          },
          {
            tab: 'After sending',
            title: 'And after sending, what next?',
            defs: [
              { term: 'Accident reported successfully.', text: 'Fleet management has it now.' },
              { term: 'Offline: the accident report was saved on this device (with its file)…', text: 'It’s sent automatically once you’re back online. Don’t sign out in the meantime.' },
              { term: 'The accident was reported, but the file could not be uploaded…', text: `The report is in; the file is missing: upload it from «${tab.document}».` },
            ],
            steps: [
              'The accident appears on your car’s Accidents card, with the count in the title.',
              'Fleet management handles it with the insurer, decides the car’s status and, once it’s resolved, closes it with the claim file number and who bears the cost.',
              'If you’re left without a car for work, tell your supervisor or fleet management.',
            ],
          },
        ],
        shots: {
          'accidente-0': 'Where and when step, empty',
          'accidente-1': 'Where and when step, filled in',
          'accidente-2': 'Damage step',
          'accidente-tercero': 'Third party involved window',
          'accidente-lesionado': 'Injured person window',
          'accidente-3': 'List of people involved',
          'accidente-4': 'Police report and file step',
        },
        faq: [
          { q: 'Should I report it as an accident or as an incident?', a: 'If there was a collision (with another car, an object, an animal…), it’s an accident. If the car simply fails, with no collision, it’s a breakdown [[incidencia]].' },
          { q: 'The other driver won’t sign the joint accident report form', a: 'Don’t argue. Note their registration, take photos and, if necessary, call the police. In the app, fill in what you have: only their name and registration are required.' },
          { q: 'I got something wrong after sending', a: 'You can’t edit a sent report from the app. Tell your supervisor or fleet management the correct details.' },
          { q: 'It happened a few days ago and I didn’t report it', a: 'Report it anyway, with the date and time it happened. The sooner, the better for the insurance.' },
        ],
      },
      documentos: {
        title: 'Documents',
        lead: 'The car’s paperwork (registration certificate, insurance…) and yours (driving licence…).',
        intro: [
          {
            title: 'What do you need to do?',
            defs: [
              { term: 'See which documents my car has', text: '“Documentation” card.' },
              { term: 'I have a new document and want to save it', text: `«${tab.document}» → Upload.` },
              { term: 'I’m missing a document', text: `«${tab.document}» → Ask for.` },
              { term: 'I want to view it or keep it on my phone', text: 'Eye · Download.' },
              { term: 'A document has wrong details', text: 'Pencil → Ask for a fix.' },
              { term: 'A document shouldn’t be there', text: 'Bin → Request deletion.' },
              { term: 'It won’t let me view it', text: 'Key → Request access.' },
            ],
            note: 'Nothing is changed or deleted directly from the app: you can upload and view, but fixing, deleting and viewing restricted documents are requested, and fleet management decides. That way no fleet document disappears by mistake.',
          },
        ],
        quick: [
          { label: 'See my documents', step: 1 },
          { label: 'Upload a document', step: 2 },
          { label: 'Ask for a document', step: 6 },
          { label: 'Ask for a fix', step: 8 },
          { label: 'Request access', step: 10 },
        ],
        walk: [
          {
            tab: 'View',
            title: 'The “Documentation” card',
            steps: [
              `On the ${mode.vehicle} screen, scroll down to **Documentation** and tap it to expand it. The number next to it is how many documents there are in total.`,
              'Inside there are two tabs: **Vehicle documents** (registration certificate, technical datasheet, insurance, contract…, which stay with the car) and **Driver documents** (your personal documents, which go with you).',
              'Each row shows the type, the day it was uploaded and, if it expires, when it expires.',
            ],
            defs: [
              { term: 'Valid', text: 'It’s all in order.' },
              { term: 'Expired', text: 'Its date has passed: you need to upload the new one (or ask for it).' },
              { term: 'Pending archiving', text: 'It’s already in the app and is saved to the company archive later, automatically.' },
              { term: 'Deletion pending', text: 'Someone has asked to delete it and fleet management is reviewing it.' },
            ],
            note: 'You don’t see every document in the fleet: only the ones for your car that fleet management lets drivers see, the ones you uploaded and your personal ones. Missing one? Ask for it.',
            shots: ['documentos', 'documentos-personal'],
            shotLabels: ['Vehicle', 'Driver'],
          },
          {
            tab: 'Upload · What',
            title: 'Upload · 1 · “What you need”',
            steps: [
              `Tap «${tab.document}» in the bottom bar. “Document · plate” opens, and the first thing it asks is what you want to do.`,
              'Just tap one of the two cards and it moves to the next tab: no need to press «Continue».',
            ],
            defs: [
              { term: 'Upload a document', text: 'You have the document (or a photo) and file it here.' },
              { term: 'Ask for a document', text: 'You don’t have it: ask the office to provide it. See [[documentos#6]].' },
              { term: 'Vehicle', text: 'What you need › Type and file › Linked to › Notes' },
              { term: 'Personal (yours)', text: 'What you need › Type and file › Notes' },
            ],
            shots: ['doc-1-modo'],
          },
          {
            tab: 'Upload · Type',
            title: 'Upload · 2 · “Type and file”',
            defs: [
              { term: 'Document of', text: 'The vehicle (its papers) or The driver · your name (your personal documents). If you choose the driver, the types change and Linked to is skipped.' },
              { term: 'Document type', text: 'Vehicle: registration certificate, technical datasheet, insurance, contract, return report, accident report, damage photos or Other. Yours: driving licence or Other.' },
              { term: 'Photo or PDF', text: '**Required.** Tap the box: take a photo there and then or choose a file from your phone. Photos (JPG, PNG, HEIC…) and PDFs are accepted.' },
              { term: 'Expiry', text: 'Optional. Only shown for documents that expire: insurance, contract and driving licence.' },
            ],
            note: 'Take the photo in good light, straight on and without glare. If the document has several pages, one PDF is better than several photos. Check that the plate, dates and numbers are readable.',
            shots: ['doc-2-archivo', 'doc-personal'],
            shotLabels: ['Vehicle: insurance', 'Yours: licence'],
          },
          {
            tab: 'Upload · Linked to',
            title: 'Upload · 3 · “Linked to”',
            steps: ['Here you say which of the car’s incidents the document goes with. If it’s personal, this step doesn’t appear. It depends on the type:'],
            defs: [
              { term: 'Damage photos', text: '**Required.** Choose the open incident the photos belong to.' },
              { term: 'Accident report', text: '**Required.** Choose the open accident. If there isn’t one, you can’t upload it and the app tells you so.' },
              { term: 'Contract · Technical datasheet · Return report · Other', text: 'Optional: choose an incident if relevant, or leave it as None.' },
              { term: 'Insurance · Registration certificate', text: 'Not linked: the tab tells you to move on to the next step.' },
            ],
            note: 'Only open incidents are offered. You can also upload photos of a breakdown when you report the [[incidencia#4]].',
            shots: ['doc-3-ligado'],
          },
          {
            tab: 'Upload · Notes',
            title: 'Upload · 4 · “Notes” and upload',
            steps: [
              'In **Notes** (optional), write something that helps you recognise it later, for example “Policy renewed in June”.',
              'Press «Upload».',
              'From there you can «Upload another» or «Close». The document now appears in the Documentation card.',
            ],
            defs: [
              { term: 'Document uploaded and archived in Drive.', text: 'All done.' },
              { term: 'Document uploaded. Pending archiving in Drive…', text: 'It’s already in the app; it gets archived automatically later.' },
              { term: 'You are offline: the document will upload automatically once you reconnect.', text: 'It stays on your phone and is sent when you get signal back. Don’t log out in the meantime.' },
            ],
            shots: ['doc-4-notas'],
          },
          {
            tab: 'Ask for',
            title: 'Ask for a document you don’t have',
            steps: [
              'In “What you need”, choose **Ask for a document**. There’s only one more tab, “What you ask for”.',
              'Press «Send the request». You’ll see “Request sent”.',
              'Administration sees it in their inbox and provides the document (or tells you why not).',
              `Track it in ${mode.profile} → Requests.`,
            ],
            defs: [
              { term: 'Document of', text: 'The vehicle’s or yours. You can only ask for your own, not someone else’s.' },
              { term: 'Document you need', text: '**Required.** Registration certificate, technical datasheet, insurance, contract, return report, driving licence or Other.' },
              { term: 'What do you need it for?', text: '**Required.** That’s what the person deciding reads. For example “The workshop needs it for the tyre change”.' },
            ],
            warn: 'You can’t ask for the workshop invoice, damage photos, the MOT report or the accident report. And asking needs a connection: without signal it isn’t saved for later.',
            shots: ['doc-pedir'],
          },
          {
            tab: 'View and download',
            title: 'View and download',
            steps: [
              'Each row in the Documentation card has its buttons on the right.',
              '**View** opens it inside the app, without going to another website. When you close the window, the copy is gone from your phone.',
              '**Download** saves a copy on your phone, with a name that says what it is and which car it’s for. Handy for showing it without signal.',
            ],
            defs: [
              { term: 'Eye', text: 'Opens it in the app.' },
              { term: 'Arrow', text: 'Saves a copy on your phone.' },
              { term: 'Pencil', text: 'Ask for it to be fixed.' },
              { term: 'Bin', text: 'Request deletion.' },
              { term: 'Key', text: 'Appears instead of the eye or download: you need to request access.' },
              { term: 'Hourglass', text: 'You’ve already asked and management hasn’t answered yet.' },
            ],
            shots: ['documentos'],
          },
          {
            tab: 'Fix',
            title: 'Ask for a document to be fixed',
            steps: [
              'Tap the row’s pencil. “Fix document” opens.',
              'Change what’s wrong: the document type, the expiry date (only for documents that expire) or the note.',
              'In **Why it needs fixing**, explain it in one sentence.',
              'Press «Send request». Management applies or rejects it.',
            ],
            note: 'This doesn’t change the document right away: it only sends the request. A document can only have one request at a time.',
            shots: ['doc-corregir'],
          },
          {
            tab: 'Delete',
            title: 'Request a document’s deletion',
            steps: [
              'Tap the row’s bin. “Request deletion · document” opens.',
              'If you like, write the reason: “It’s a duplicate”, “It’s for another car”…',
              'Press «Request deletion». The document stays in the list with the **Deletion pending** badge until management decides.',
            ],
            defs: [
              { term: 'Delete it', text: 'It disappears from the list (management keeps it aside in case it needs to be recovered).' },
              { term: 'Hide it', text: 'It stays in the fleet, but is no longer visible in the field app.' },
              { term: 'Reject', text: 'Nothing changes: it shows as normal again, without the badge.' },
            ],
            shots: ['doc-borrar'],
          },
          {
            tab: 'Request access',
            title: 'Request access to a document',
            steps: [
              'Management decides, per document type, what the driver can do with it. The line under the name tells you.',
              'Tap the key. “Request to view” (or to download) the document opens.',
              'Write what you need it for (optional) and press «Send request».',
              'Once management grants it, you’ll see the eye or the arrow again.',
            ],
            defs: [
              { term: 'on request', text: 'You have to ask for it: instead of the eye or the arrow, a key appears.' },
              { term: 'requested, awaiting management', text: 'You’ve already asked: an hourglass appears.' },
              { term: 'granted', text: 'It’s been granted: the normal button is back.' },
              { term: 'not allowed', text: 'Not possible, even on request. The button is greyed out.' },
            ],
            note: 'A greyed-out button isn’t broken: tap it and it explains why you can’t. If you really need it, talk to whoever runs the fleet.',
            shots: ['doc-pedir-acceso', 'doc-no-permitido'],
            shotLabels: ['On request', 'Not allowed'],
          },
        ],
        sections: [
          {
            title: 'Document types at a glance',
            defs: [
              { term: 'Registration certificate', text: 'Car · doesn’t expire · not linked · can be requested.' },
              { term: 'Technical datasheet', text: 'Car · doesn’t expire · linking optional · can be requested.' },
              { term: 'Insurance', text: 'Car · expires · not linked · can be requested.' },
              { term: 'Contract', text: 'Car · expires · linking optional · can be requested.' },
              { term: 'Return report', text: 'Car · doesn’t expire · linking optional · can be requested.' },
              { term: 'Damage photos', text: 'Car · linking required · cannot be requested.' },
              { term: 'Accident report', text: 'Car · linked to an open accident · cannot be requested.' },
              { term: 'Workshop invoice · MOT report', text: 'Not uploaded from here: they’re attached when closing the incident or when you log the MOT.' },
              { term: 'Driving licence', text: 'Yours · expires · not linked · can be requested.' },
              { term: 'Other', text: 'Car or yours · linking optional · can be requested.' },
            ],
          },
        ],
        shots: {
          documentos: 'Documentation card, vehicle tab',
          'documentos-personal': 'Documentation card, driver tab',
          'doc-1-modo': 'What you need tab',
          'doc-2-archivo': 'Uploading the car’s insurance',
          'doc-personal': 'Uploading the driving licence',
          'doc-3-ligado': 'Linked to tab',
          'doc-4-notas': 'Notes tab',
          'doc-pedir': 'What you ask for tab',
          'doc-corregir': 'Fix document window',
          'doc-borrar': 'Request deletion window',
          'doc-pedir-acceso': 'Requesting to view the contract',
          'doc-no-permitido': 'Deletion not allowed',
        },
        faq: [
          { q: 'I can’t find a document I know exists', a: `Fleet management may not have made it visible to drivers. Ask for it from «${tab.document}» → Ask for a document: it also works for ones you can’t see in the list.` },
          { q: 'I chose the wrong type when uploading', a: 'Tap the pencil and ask for a fix. Don’t delete it and upload it again: you’d lose the original file and its history.' },
          { q: 'It’s said “Pending archiving” for days', a: 'The document is already saved and you can view it from the app. Archiving it to the company Drive is retried automatically; if it takes too long, let fleet management know.' },
          { q: 'When I open it, it says “The document could not be opened”', a: 'Check your signal and try again. If it keeps failing with that document, its file may no longer exist: let fleet management know.' },
          { q: 'Who can see my personal documents?', a: 'You, your supervisor and fleet management. Your personal documents are never hidden from you.' },
        ],
      },
      avisos: {
        title: 'Notices and alerts',
        lead: '“Due soon”, alerts and the colours.',
        sections: [
          {
            title: 'What you have pending',
            steps: [
              'When you open the app, you’ll see **Due soon** at the top if something is missing: this month’s km reading, fuel consumption, an MOT or upcoming maintenance. Tap the notice and its form opens right there.',
              'Expand the **Alerts** card to see everything open on the car, with its level (Critical, Warning) and its date.',
              'Tap «Resolve» on the alert: usually it means doing what it asks (logging the reading, the MOT, the maintenance…). Once you save it, the alert closes.',
            ],
            note: 'If you don’t see the “Due soon” block, you have nothing pending.',
            shots: ['home', 'alertas'],
            shotLabels: ['Due soon', 'Alerts card'],
          },
          {
            title: 'What do the colours mean?',
            defs: [
              { term: 'Green', text: 'All up to date.' },
              { term: 'Amber', text: 'The date is getting close, or you haven’t logged anything for 15-30 days.' },
              { term: 'Red', text: 'Overdue, less than 7 days away, or more than 30 days without logging.' },
            ],
          },
        ],
        shots: { home: 'Due soon block', alertas: 'Alerts card expanded' },
      },
      perfil: {
        title: 'My profile',
        lead: 'Your details and your requests. You don’t edit your record directly: you request the change.',
        sections: [
          {
            title: 'Your details and your requests',
            steps: [
              `Go to «${mode.profile}» or tap your initials in the header. You’ll see your email, phone, licence type and whether you have a fuel card.`,
              'At the bottom, «My details» opens a window with 3 steps: **Your details** (correct only what’s wrong), **Documents** (review your personal documents) and **Send** (check what changes, add a note and send).',
              'Fleet management reviews the request and either applies or rejects it.',
              'Under **Requests** you see everything you’ve asked for, pending and decided (rejected ones too). Under **My documents**, your personal papers.',
              `From your profile, the «${tab.document}» button lets you upload, for example, your driving licence.`,
            ],
            shots: ['perfil', 'mis-datos'],
            shotLabels: ['My profile', 'My details'],
          },
        ],
        shots: { perfil: 'My profile', 'mis-datos': 'My details window' },
      },
      flota: {
        title: 'Your fleet',
        lead: `If you supervise cars, the «${mode.fleet}» view is your dashboard: what you have, what needs attention and how to resolve it without leaving the app.`,
        quick: [
          { label: 'See how my fleet is doing', step: 1 },
          { label: 'Find a car', step: 2 },
          { label: 'Log on the driver’s behalf', step: 3 },
          { label: 'Book an MOT', step: 4 },
          { label: 'Send a reminder', step: 5 },
          { label: 'Deal with what’s pending', step: 6 },
          { label: 'A car is over its km', step: 7 },
        ],
        walk: [
          {
            tab: 'In your charge',
            title: `Open «${mode.fleet}» and read “In your charge”`,
            steps: [
              `Tap «${mode.fleet}» at the top. The bottom bar changes to «${tab.home}» «${tab.alerts}» «${tab.projection}».`,
              'At the top, **Fleet in my care** tells you how many vehicles you can see and how many km readings are missing this month.',
              'The **In your charge** card has two blocks: what you have (vehicles you supervise and the drivers who drive them) and alerts and incidents (how many alerts, incidents and accidents are open).',
              'Tap any figure and its list opens. Alerts and incidents are resolved right there, with the same form as everywhere else in the app.',
            ],
            note: '“Vehicles” at the top and in In your charge may not match: the top one also counts your own car. You can collapse In your charge by tapping its title.',
            shots: ['flota', 'acargo-alertas'],
            shotLabels: ['In your charge', 'When you tap Alerts'],
          },
          {
            tab: 'Car list',
            title: 'The car list',
            steps: [
              'Below In your charge you’ll find all your cars, one per card: plate, status, who drives it and its kilometres.',
              'Use the search box (plate, model, driver…) and the status filter to narrow it down.',
              'If you supervise multi-user cars, the list splits into **General fleet** and **Multi-user cars**. Multi-user cars have no driver: you log their km and fuel.',
              'Tap the card to open the car record, with all its buttons.',
            ],
            defs: [
              { term: 'Incident', text: 'Report it on the driver’s behalf.' },
              { term: 'Accident', text: 'The accident report.' },
              { term: 'Maintenance', text: 'Opens Update on its maintenance tab.' },
              { term: 'Reminder', text: 'Send reminder to the driver.' },
              { term: 'Schedule MOT', text: 'Book the MOT.' },
              { term: 'Schedule service', text: 'Choose its maintenance programme.' },
            ],
            shots: ['flota-lista', 'ficha-campo'],
            shotLabels: ['The list', 'The record'],
          },
          {
            tab: 'Record and Update',
            title: 'The car record and the “Update” window',
            steps: [
              'Tap a car in the list. At the top you see its km, its upcoming appointments and its projection; if this month’s reading is missing, a notice with «Log it now».',
              'Below, its buttons: «Log km», «Average consumption», «Log MOT» (if it has an appointment), «Update maintenance», «Schedule MOT», «Schedule service», «Incident», «Accident», «Ask for or upload a document» and «Send reminder».',
              '«Update maintenance» opens “Update · plate”, from where you can move to Km, Fuel, MOT, Maintenance and Incidents. It doesn’t close when you save: it tells you what it saved and you carry on with another tab.',
            ],
            note: '«Update maintenance» only opens the window when the maintenance is 30 days away or less. Before that it appears greyed out: tap it and it tells you when it’s due.',
            warn: 'Responsibility notice: logging is the driver’s job, and whatever you do is recorded under your name. An amber box reminds you when these windows open.',
            shots: ['ficha-acciones', 'actualizar', 'actualizar-incidencias'],
            shotLabels: ['Its buttons', 'Update · Km', 'Update · Incidents'],
          },
          {
            tab: 'Schedule',
            title: 'Schedule the MOT and maintenance',
            steps: [
              '**Schedule MOT:** the MOT date (**required**, the one the test centre gave you) and, if you like, the preferred postcode (5 digits). If it already had an appointment, saving corrects it: there’s only one.',
              '**Schedule service:** choose the programme from the catalogue (for example General service), enter from when it counts (the date, the km or both) and save. You can load the km from the car with one tap.',
            ],
            note: 'A car can only have one scheduled maintenance at a time; removing an appointment is done by administration. You can also schedule on a car covered by a replacement.',
            shots: ['programar-itv', 'programar-mantenimiento'],
            shotLabels: ['MOT', 'Maintenance'],
          },
          {
            tab: 'Reminder',
            title: 'Send a reminder to the driver',
            steps: [
              'The envelope icon on the card (or «Send reminder» on the record) opens “Reminder · plate”, with the driver’s name at the top.',
              'Tap «Send». The window tells you what happened: “Email sent.”, “In-app alert created.” or why the email didn’t go out.',
            ],
            defs: [
              { term: 'Reason', text: 'Km reading not logged, MOT or Maintenance. Each option shows its date so you can check it’s really due.' },
              { term: 'How', text: 'Send email and/or Create in-app alert.' },
              { term: 'Email', text: 'Management template (your message goes inside) or Your own text.' },
              { term: 'Additional message', text: 'Optional, with the template.' },
            ],
            warn: 'If the car has no driver, the window warns you: the email can’t be delivered.',
            shots: ['recordatorio'],
          },
          {
            tab: 'Inbox',
            title: 'The alerts inbox for your whole fleet',
            steps: [
              `Tap «${tab.alerts}» in the bottom bar.`,
              'There are three collapsed cards: Alerts, Incidents and Accidents, each showing how many are open.',
              'Expand one: each row says which car it belongs to. At the top you can search, filter by type and sort by priority or by date.',
              'Tap «Resolve» on an alert: whatever it asks for opens. Once you save it, the alert closes. «Show closed» shows what’s already resolved.',
            ],
            note: 'For an alert, the priority is its level (the app works it out from how close the date is); for an incident, it’s set by whoever opened it.',
            shots: ['bandeja', 'bandeja-alertas'],
            shotLabels: ['Inbox', 'Alerts expanded'],
          },
          {
            tab: 'Km projection',
            title: 'Km projection: who is going to exceed the contract',
            steps: [
              `Tap «${tab.projection}». At the top: how many vehicles, how many to watch and how many at risk. Filter with the chips.`,
              'Each card shows the % of km used, the monthly average against the contracted one, the projection to end of contract and the remaining km. If it’s going to exceed, the estimated overage in km and euros.',
              'If the car has the overage alert, tap «Resolve»: propose someone from your fleet who drives less, or choose “Nobody on the list — I explain below”, and tap «Send proposal».',
            ],
            note: 'Nothing changes at that moment: administration decides on the proposal, and the driver change is made by fleet management. The driver doesn’t see this alert.',
            shots: ['proyeccion', 'exceso-resolver'],
            shotLabels: ['Projection', 'Resolve'],
          },
        ],
        shots: {
          flota: 'Fleet view with In your charge',
          'acargo-alertas': 'Alerts list opened from In your charge',
          'flota-lista': 'Fleet car list',
          'ficha-campo': 'A car’s record',
          'ficha-acciones': 'Record buttons',
          actualizar: 'Update window, Km tab',
          'actualizar-incidencias': 'Update window, Incidents tab',
          'programar-itv': 'Schedule MOT',
          'programar-mantenimiento': 'Schedule service',
          recordatorio: 'Reminder window',
          bandeja: 'Alerts inbox',
          'bandeja-alertas': 'Inbox with alerts expanded',
          proyeccion: 'Km projection',
          'exceso-resolver': 'Propose another driver',
        },
      },
      offline: {
        title: 'No signal',
        lead: 'Whatever you log without a connection isn’t lost.',
        sections: [
          {
            title: 'What happens offline',
            steps: [
              'If you save something while offline, the app queues it and tells you with an amber notice under the header.',
              'The button for that action shows an amber dot while it waits.',
              'When the connection comes back, it’s sent automatically (or tap the notice to send it now) and the app tells you what was sent.',
            ],
            warn: 'Don’t log out or clear the browser data while there are items in the queue, or they’ll be lost.',
            note: 'The help chapters you have already opened can be read without signal. The video needs a connection.',
          },
        ],
      },
      preguntas: {
        title: 'Frequently asked questions',
        lead: 'The most common questions.',
        faq: [
          { q: 'I keep getting the km email even though I already logged them', a: 'Check that the reading was saved and isn’t queued because of no signal ([[offline]]). The reminder stops as soon as this month’s reading is logged.' },
          { q: 'I can’t tap the MOT or maintenance button', a: 'They only become active 30 days before the appointment. Tap it anyway: it will tell you the appointment date and from what day you can log it.' },
          { q: 'I can’t see the MOT button', a: 'Your car has no MOT scheduled. Appointments are set by administration or your supervisor.' },
          { q: 'I entered something wrong on a document', a: 'Tap the document’s pencil and request the correction ([[documentos#8]]). There’s no need to delete it and upload it again.' },
          { q: 'Can I change my car’s status to “broken down”?', a: 'Not directly. Report an incident and say how the car is left under Availability ([[incidencia#2]]); fleet management changes the status.' },
          { q: 'My session suddenly ended', a: 'It happens after 2 hours, after a while without using it, or if you signed in with your user on another device. Just sign in again.' },
          { q: 'Is the app available in English?', a: 'Yes: switch the language with ES / EN in the header (also on the sign-in screen).' },
        ],
      },
    },
  }
}

export function useTutorialCopy(): TutorialCopy {
  const { t, language } = useLang()
  return language === 'en' ? en(t) : es(t)
}
