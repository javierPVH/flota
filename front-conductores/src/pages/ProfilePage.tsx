import { useOutletContext } from 'react-router-dom'
import { Badge } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'
import { CollapsibleCard, useAccordion } from '../components/CollapsibleCard.tsx'
import type { LayoutContext } from '../components/Layout.tsx'
import { MyRequests } from '../components/MyRequests.tsx'
import { PersonalDocumentsPanel, usePersonalDocuments } from '../components/PersonalDocuments.tsx'
import { useLang } from '../i18n.tsx'
import type { Role } from '../types.ts'

/** En el orden en que se leen las chapas; HSE va el último porque aquí no
 * opera nada: es el rol de lectura de la web de gestión. */
const ROLES: Role[] = ['driver', 'supervisor', 'admin', 'hse']

/** Las dos tarjetas plegables del perfil, en el orden en que se leen. Las dos
 * arrancan **plegadas**, como las del vehículo: el recuento va en el título,
 * así que se sabe cuántos documentos hay y si algo espera decisión sin
 * desplegar nada, y la pantalla entra entera en un móvil. */
const PROFILE_CARDS = ['documents', 'requests'] as const

/**
 * DNI enmascarado: es su propio dato, pero esta pantalla se mira de pie en una
 * obra y con gente al lado. Con los últimos cuatro se reconoce la ficha sin
 * pintar el documento entero (dato mínimo, RGPD).
 */
const maskDni = (dni: string | null): string => (dni ? `••••${dni.slice(-4)}` : '')

/**
 * «Mi perfil» — la pantalla del avatar del header: los datos con los que la
 * gestión te tiene fichado y TU documentación personal (el permiso de
 * conducir…), la misma que la pestaña «del conductor» de la home.
 *
 * Es de LECTURA: quien corrige el nombre, el teléfono o el permiso es la
 * gestión de flota (el back no deja al conductor editarse la ficha). Lo que
 * sí se hace desde aquí es **pedirlo**, y eso vive en el nav inferior («Mis
 * datos»): abre una petición que espera en la bandeja de `/solicitudes`, con
 * las de coche, documentos y conductor. Antes la pantalla solo decía «avisa a
 * gestión», y ese aviso salía de la herramienta: quedaba sin rastro de quién
 * pidió qué.
 *
 * Y debajo de los documentos, **lo que uno tiene pedido** (`MyRequests`):
 * pendiente y resuelto, de las cuatro bandejas a la vez. Pedir algo y no poder
 * ver en qué quedó es la mitad de un camino.
 *
 * Esas dos cosas son los **dos acordeones** de la pantalla, cada uno con su
 * recuento en el título: en un móvil, la lista de documentos y las dos de
 * peticiones seguidas eran tres pantallas de scroll para saber si había algo.
 */
export function ProfilePage() {
  const { user } = useAuth()
  const { t } = useLang()
  const copy = t.profile
  const personal = usePersonalDocuments()
  // Lo que se pide desde aquí sale por el nav («Mis datos»), que vive fuera del
  // Outlet: `dataVersion` sube al mandar algo y es lo que recarga estas listas.
  const ctx = useOutletContext<LayoutContext | null>()
  const dataVersion = ctx?.dataVersion ?? 0
  // Dos acordeones, los dos plegados de salida: lo que se lee sin abrirlos es
  // su recuento.
  const accordion = useAccordion(PROFILE_CARDS, PROFILE_CARDS)
  const docCount = personal.documents?.length ?? 0

  if (!user) return <p role="status" className="gate-checking">{t.common.loading}</p>

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username
  const initials = (
    (user.first_name?.[0] ?? user.username?.[0] ?? '?') + (user.last_name?.[0] ?? '')
  ).toUpperCase()
  const rows: Array<{ label: string; value: string }> = [
    { label: copy.email, value: user.email },
    { label: copy.phone, value: user.phone },
    { label: copy.dni, value: maskDni(user.dni) },
    { label: copy.licenseType, value: user.license_type },
    { label: copy.fuelCard, value: user.fuel_card ? t.common.yes : t.common.no },
  ]

  return (
    <div className="field-page">
      {/* Sin encabezado: el tab de arriba ya dice dónde estás, y en un móvil
          ese título se comía una pantalla de alto para repetirlo. */}
      <section className="card profile-head">
        <span className="profile-avatar" aria-hidden>
          {initials}
        </span>
        <div className="profile-id">
          <strong className="profile-name">{fullName}</strong>
          <span className="doc-sub">@{user.username}</span>
          <div className="profile-roles">
            {ROLES.filter((role) => user.roles.includes(role)).map((role) => (
              <Badge key={role} tone="info">
                {copy.roleNames[role]}
              </Badge>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="panel-title">{copy.dataTitle}</h2>
        <dl className="profile-data">
          {rows.map((row) => (
            <div className="profile-row" key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value || t.profile.empty}</dd>
            </div>
          ))}
        </dl>
        <p className="doc-sub">{copy.dataHint}</p>
      </section>

      <CollapsibleCard
        id="documents"
        headingClassName="panel-title"
        accordion={accordion}
        title={
          <>
            {t.myDocs.title}
            <span className={`acc-count${docCount === 0 ? ' is-zero' : ''}`}>{docCount}</span>
          </>
        }
      >
        <PersonalDocumentsPanel {...personal} />
      </CollapsibleCard>

      {/* Lo que uno tiene pedido, debajo de sus documentos: las cuatro
          bandejas juntas, en dos pestañas (pendientes y resueltas). */}
      <MyRequests key={dataVersion} accordion={accordion} />
    </div>
  )
}
