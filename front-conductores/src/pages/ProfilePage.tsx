import { PageHeader, Badge } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'
import { PersonalDocumentsPanel, usePersonalDocuments } from '../components/PersonalDocuments.tsx'
import { useLang } from '../i18n.tsx'
import type { Role } from '../types.ts'

const ROLES: Role[] = ['driver', 'supervisor', 'admin']

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
 * gestión de flota (el back no deja al conductor editarse la ficha), así que
 * aquí se dice a quién avisar en vez de ofrecer un formulario que daría 403.
 */
export function ProfilePage() {
  const { user } = useAuth()
  const { t } = useLang()
  const copy = t.profile
  const personal = usePersonalDocuments()

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
      <PageHeader title={copy.title} />

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

      <section className="card">
        <h2 className="panel-title">{t.myDocs.title}</h2>
        <PersonalDocumentsPanel {...personal} />
      </section>
    </div>
  )
}
