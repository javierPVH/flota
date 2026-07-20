import { Boxes } from 'lucide-react'
import { normalizeFechaForDb, isValidEmail } from '@/utils'
import { useLang } from './demo-i18n.ts'
import { useAuth } from './demo-auth.ts'
import { ComponentsDemo } from './components-demo.tsx'
import { Phase5Demo } from './phase5-demo.tsx'
import { TableDemo } from './table-demo.tsx'
import { FormsDemo } from './forms-demo.tsx'
import s from './tokens-demo.module.sass'

const dateSamples = ['07/03/2025', '2025-03-07T14:30:00Z', '45000', '31/02/2025']
const emailSamples = ['ada@x.io', 'a@b']

function I18nAuthDemo() {
  const { language, setLanguage, t } = useLang()
  const { status, user, logout } = useAuth()

  return (
    <div style={{ display: 'grid', gap: '.6rem', fontSize: '.9rem' }}>
      <div>
        <b>{t.greeting}</b>
      </div>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
        <span style={{ color: '#666' }}>{t.langLabel}:</span>
        <button onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}>
          {language.toUpperCase()} ⇄ {(language === 'es' ? 'en' : 'es').toUpperCase()}
        </button>
      </div>
      <div>
        Auth:{' '}
        {status === 'loading' && <span>{t.authLoading}</span>}
        {status === 'authenticated' && (
          <>
            <b>{user?.name}</b>{' '}
            <button onClick={logout}>logout</button>
          </>
        )}
        {status === 'anonymous' && <span>{t.authAnon}</span>}
      </div>
    </div>
  )
}

// Showcase de @gs/base. Cada fase añade su sección de demo.
//  Fase 1 → tokens/estilos ✓ · Fase 2 → utils · Fase 3 → http/auth/i18n · Fase 4+ → UI.
const phases = [
  { id: 0, name: 'Andamiaje', status: 'hecho', detail: 'Repo levantable + build de librería' },
  { id: 1, name: 'Design tokens y estilos', status: 'hecho', detail: 'colores, tipografía, z-index' },
  { id: 2, name: 'Utils puros + tests', status: 'pendiente', detail: 'cx, date-normalize, excel-to-csv…' },
  { id: 3, name: 'HTTP + Auth + i18n', status: 'hecho', detail: 'http-client, createAuth, createI18n' },
  { id: 4, name: 'Botones y campos', status: 'hecho', detail: 'Button, IconButton, TextInput, Select…' },
  { id: 5, name: 'Overlays, panels, layout, excel', status: 'hecho', detail: 'Modal, Panel, StatCard, useExcelConverter…' },
  { id: 6, name: 'TableWithPanel', status: 'hecho', detail: 'data-grid: sort, filtro fecha, expand, paginación' },
  { id: 7, name: 'Motores de formularios', status: 'hecho', detail: 'CatalogEntityCreateForm, CreateFormPanel (submit inyectado)' },
]

const semantic = [
  { cls: s.primary, name: 'primary', value: '#1f63b8' },
  { cls: s.primarySoft, name: 'primary-soft', value: '#e9f2ff' },
  { cls: s.danger, name: 'danger', value: '#c63434' },
  { cls: s.success, name: 'success', value: '#1f9f67' },
  { cls: s.warning, name: 'warning', value: '#c17a11' },
  { cls: s.info, name: 'info', value: '#1d5ea8' },
]

const corp = [
  { cls: s.corpBlack, name: 'black-corp', value: '#575756' },
  { cls: s.corpRed, name: 'red-corp', value: '#862633' },
  { cls: s.corpOrange, name: 'orange-corp', value: '#FF8200' },
  { cls: s.corpBlue, name: 'blue-corp', value: '#34657F' },
  { cls: s.corpNavy, name: 'navy-corp', value: '#002855' },
  { cls: s.corpLightBlue, name: 'light-blue-corp', value: '#6CAEC6' },
  { cls: s.corpTeal, name: 'teal-corp', value: '#009491' },
]

function Swatches({ items }: { items: { cls: string; name: string; value: string }[] }) {
  return (
    <div className={s.grid}>
      {items.map((it) => (
        <div key={it.name} className={s.swatch}>
          <div className={`${s.swatchChip} ${it.cls}`} />
          <div className={s.swatchBody}>
            <div className={s.swatchName}>{it.name}</div>
            <div className={s.swatchValue}>{it.value}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function App() {
  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
        <Boxes size={32} />
        <h1 className={s.title}>@gs/base</h1>
      </header>
      <p className={s.subtitle}>
        Design-system / librería base compartida. Repo autónomo y levantable por sí solo.
      </p>

      <div className={s.sectionLabel}>Fases</div>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {phases.map((p) => (
          <li
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.75rem',
              padding: '0.6rem 1rem',
              border: '1px solid #e5e5e5',
              borderRadius: 8,
              marginBottom: '0.4rem',
            }}
          >
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '0.1rem 0.5rem',
                borderRadius: 999,
                background: p.status === 'hecho' ? '#16a34a' : '#e5e5e5',
                color: p.status === 'hecho' ? '#fff' : '#666',
              }}
            >
              Fase {p.id}
            </span>
            <span style={{ fontWeight: 600 }}>{p.name}</span>
            <span style={{ color: '#888', fontSize: '0.9rem', marginLeft: 'auto' }}>{p.detail}</span>
          </li>
        ))}
      </ol>

      <div className={s.sectionLabel}>Componentes: botones y campos (Fase 4)</div>
      <ComponentsDemo />

      <div className={s.sectionLabel}>Overlays, panels, layout, excel (Fase 5)</div>
      <Phase5Demo />

      <div className={s.sectionLabel}>TableWithPanel (Fase 6)</div>
      <TableDemo />

      <div className={s.sectionLabel}>Motor de formularios (Fase 7)</div>
      <FormsDemo />

      <div className={s.sectionLabel}>i18n + Auth (Fase 3)</div>
      <I18nAuthDemo />

      <div className={s.sectionLabel}>Utils (Fase 2)</div>
      <div style={{ fontSize: '.85rem', fontFamily: 'ui-monospace, monospace', color: '#334' }}>
        {dateSamples.map((d) => {
          const r = normalizeFechaForDb(d)
          return (
            <div key={d}>
              normalizeFechaForDb(<b>{d}</b>) → {r.valid ? r.value : `inválida (${r.raw})`}
            </div>
          )
        })}
        {emailSamples.map((e) => (
          <div key={e}>
            isValidEmail(<b>{e}</b>) → {String(isValidEmail(e))}
          </div>
        ))}
      </div>

      <div className={s.sectionLabel}>Tokens semánticos (marca-neutros)</div>
      <Swatches items={semantic} />

      <div className={s.sectionLabel}>Paleta corporativa (Gransolar · capa sustituible)</div>
      <Swatches items={corp} />
    </main>
  )
}
