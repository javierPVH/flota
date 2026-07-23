/**
 * Página de QA visual del design system (@flota/ui).
 * Ruta pública `/ui-kit` (no requiere login ni backend). Sirve para validar
 * componentes y tokens durante el rediseño; no forma parte de la app de gestión.
 */
import { useState, type ReactNode } from 'react'
import {
  Badge,
  Button,
  Chip,
  IconButton,
  Modal,
  PageHeader,
  Panel,
  SelectField,
  StatCard,
  TabButton,
  TextAreaField,
  TextInputField,
} from '@flota/ui/ui'
import { AlertTriangle, Bell, Car, Gauge, Pencil, Plus, Trash2 } from 'lucide-react'

const BADGE_TONES = ['neutral', 'brand', 'primary', 'info', 'success', 'warning', 'danger'] as const
const BADGE_VARIANTS = ['soft', 'solid', 'outline'] as const
const PANEL_TONES = ['info', 'success', 'warning', 'danger'] as const
const STAT_ACCENTS = ['primary', 'info', 'success', 'warning', 'danger', 'navy', 'teal'] as const
const BUTTON_VARIANTS = ['primary', 'secondary', 'navy', 'success', 'warning', 'danger', 'default'] as const
const BUTTON_SIZES = ['xs', 'sm', 'md', 'lg'] as const

const COLOR_TOKENS = [
  '--color-brand', '--color-brand-hover', '--color-primary', '--color-primary-hover', '--color-primary-soft',
  '--color-ink', '--color-text', '--color-text-muted', '--color-surface', '--color-app-bg', '--color-surface-soft',
  '--color-border', '--color-border-strong',
  '--color-danger', '--color-danger-soft', '--color-danger-bg',
  '--color-success', '--color-success-soft', '--color-success-border',
  '--color-warning', '--color-warning-soft', '--color-warning-border',
  '--color-info', '--color-info-soft', '--color-info-border',
]
const RADIUS_TOKENS = ['--radius-xs', '--radius-sm', '--radius-field', '--radius-md', '--radius-lg', '--radius-xl', '--radius-frame']
const SHADOW_TOKENS = ['--shadow-card', '--shadow-card-hover', '--shadow-pop', '--shadow-modal', '--shadow-frame']

// Mapeo estado de flota → tono de Badge (referencia para la Fase 5).
const FLOTA_BADGES: Array<{ label: string; tone: (typeof BADGE_TONES)[number] }> = [
  { label: 'Activo', tone: 'success' },
  { label: 'En taller', tone: 'warning' },
  { label: 'Baja', tone: 'neutral' },
  { label: 'ITV próxima', tone: 'warning' },
  { label: 'ITV vencida', tone: 'danger' },
  { label: 'Km en exceso', tone: 'danger' },
  { label: 'Dentro de contrato', tone: 'success' },
  { label: 'Sin conductor', tone: 'neutral' },
  { label: 'Propuesta', tone: 'primary' },
  { label: 'Aceptada', tone: 'success' },
  { label: 'Rechazada', tone: 'danger' },
  { label: 'Sustitución', tone: 'info' },
]

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: '2.4rem' }}>
      <h2
        style={{
          fontSize: '.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.09em',
          color: 'var(--color-text-muted)', margin: '0 0 .2rem',
        }}
      >
        {title}
      </h2>
      {description && (
        <p style={{ margin: '0 0 .8rem', color: 'var(--color-text-muted)', fontSize: '.85rem' }}>{description}</p>
      )}
      <div
        style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)', padding: '1.1rem', boxShadow: 'var(--shadow-card)',
        }}
      >
        {children}
      </div>
    </section>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem', alignItems: 'center' }}>{children}</div>
}

function Stack({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: '.9rem' }}>{children}</div>
}

export function UiKitPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [tab, setTab] = useState<'all' | 'itv' | 'km'>('all')
  const [chips, setChips] = useState<Record<string, boolean>>({ alerts: true })

  function toggleChip(key: string) {
    setChips((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-app-bg)', padding: '2rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <PageHeader
          title="UI Kit — Flota"
          subtitle="Galería de QA del design system @flota/ui. Valida componentes y tokens antes de aplicarlos a las vistas."
          breadcrumb={<span>Interno · /ui-kit</span>}
          stats={[
            { value: 128, label: 'Vehículos' },
            { value: 12, label: 'Alertas' },
            { value: 2, label: 'ITV vencidas' },
          ]}
          actions={
            <>
              <Button variant="secondary" size="sm">Documentación</Button>
              <Button variant="primary" size="sm"><Plus size={15} /> Acción</Button>
            </>
          }
        />

        {/* ── Tokens de color ── */}
        <Section title="Tokens · Color" description="Variables CSS de tokens.css (deben resolver a la paleta corporativa).">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '.6rem' }}>
            {COLOR_TOKENS.map((token) => (
              <div key={token} style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <span
                  style={{
                    width: 34, height: 34, flex: '0 0 auto', borderRadius: 'var(--radius-sm)',
                    background: `var(${token})`, border: '1px solid var(--color-border)',
                  }}
                />
                <code style={{ fontSize: '.68rem', color: 'var(--color-text)', wordBreak: 'break-all' }}>{token}</code>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Radios y sombras ── */}
        <Section title="Tokens · Radios y sombras">
          <Row>
            {RADIUS_TOKENS.map((token) => (
              <div key={token} style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: 64, height: 48, background: 'var(--color-primary-soft)',
                    border: '1px solid var(--color-primary)', borderRadius: `var(${token})`,
                  }}
                />
                <code style={{ fontSize: '.62rem', color: 'var(--color-text-muted)' }}>{token.replace('--radius-', '')}</code>
              </div>
            ))}
          </Row>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.4rem', marginTop: '1.2rem' }}>
            {SHADOW_TOKENS.map((token) => (
              <div key={token} style={{ textAlign: 'center' }}>
                <div style={{ width: 90, height: 54, background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', boxShadow: `var(${token})` }} />
                <code style={{ fontSize: '.62rem', color: 'var(--color-text-muted)' }}>{token.replace('--shadow-', '')}</code>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Botones ── */}
        <Section title="Button · variantes" description="7 variantes. Acción principal = teal (primary).">
          <Row>
            {BUTTON_VARIANTS.map((variant) => (
              <Button key={variant} variant={variant}>{variant}</Button>
            ))}
          </Row>
          <div style={{ marginTop: '1rem' }}>
            <Row>
              {BUTTON_SIZES.map((size) => (
                <Button key={size} variant="primary" size={size}>size {size}</Button>
              ))}
              <Button variant="primary" disabled>disabled</Button>
              <Button variant="secondary" counterValue={7}>con contador</Button>
            </Row>
          </div>
        </Section>

        {/* ── IconButton / TabButton ── */}
        <Section title="IconButton · TabButton">
          <Row>
            <IconButton aria-label="Editar"><Pencil size={16} /></IconButton>
            <IconButton variant="warning" aria-label="Aviso"><AlertTriangle size={16} /></IconButton>
            <IconButton variant="danger" aria-label="Borrar"><Trash2 size={16} /></IconButton>
          </Row>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '.2rem', flexWrap: 'wrap' }}>
            <TabButton active={tab === 'all'} onClick={() => setTab('all')} counterValue={42}>Todas</TabButton>
            <TabButton variant="status" tone="warning" active={tab === 'itv'} onClick={() => setTab('itv')} counterValue={3}>ITV</TabButton>
            <TabButton variant="status" tone="danger" active={tab === 'km'} onClick={() => setTab('km')} counterValue={1}>Km exceso</TabButton>
          </div>
        </Section>

        {/* ── Badge ── */}
        <Section title="Badge · tonos × variantes" description="Nuevo en la Fase 1. El tono fija el color; la variante el relleno.">
          <Stack>
            {BADGE_VARIANTS.map((variant) => (
              <div key={variant} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
                <code style={{ width: 60, fontSize: '.7rem', color: 'var(--color-text-muted)' }}>{variant}</code>
                {BADGE_TONES.map((tone) => (
                  <Badge key={tone} tone={tone} variant={variant}>{tone}</Badge>
                ))}
              </div>
            ))}
          </Stack>
          <div style={{ marginTop: '1rem' }}>
            <Row>
              <Badge tone="danger" icon={<AlertTriangle size={12} />}>Con icono</Badge>
              <Badge tone="success" size="sm">tamaño sm</Badge>
            </Row>
          </div>
        </Section>

        {/* ── Estados de flota (mapeo para Fase 5) ── */}
        <Section title="Badge · estados de flota" description="Mapeo de estados reales del dominio a tonos (referencia para migrar las vistas).">
          <Row>
            {FLOTA_BADGES.map((item) => (
              <Badge key={item.label} tone={item.tone}>{item.label}</Badge>
            ))}
          </Row>
          <div style={{ marginTop: '1rem' }}>
            <Row>
              <span style={{ fontSize: '.72rem', color: 'var(--color-text-muted)' }}>Roles (outline brand):</span>
              <Badge tone="brand" variant="outline">Administrador</Badge>
              <Badge tone="brand" variant="outline">Admin. de flota</Badge>
              <Badge tone="neutral" variant="outline">Conductor</Badge>
            </Row>
          </div>
        </Section>

        {/* ── Chip ── */}
        <Section title="Chip · filtros" description="Toggle de filtro rápido. Activo = teal.">
          <Row>
            <Chip active={chips.alerts} icon={<Bell size={14} />} onClick={() => toggleChip('alerts')}>Con alertas</Chip>
            <Chip active={chips.itv} onClick={() => toggleChip('itv')} count={3}>ITV próxima</Chip>
            <Chip active={chips.taller} onClick={() => toggleChip('taller')}>En taller</Chip>
            <Chip disabled>Deshabilitado</Chip>
          </Row>
        </Section>

        {/* ── Panel ── */}
        <Section title="Panel · tonos">
          <Stack>
            {PANEL_TONES.map((tone) => (
              <Panel key={tone} tone={tone} title={`Panel ${tone}`}>
                Mensaje de ejemplo para el tono <strong>{tone}</strong>.
              </Panel>
            ))}
          </Stack>
        </Section>

        {/* ── StatCard ── */}
        <Section title="StatCard · KPIs">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            {STAT_ACCENTS.map((accent, i) => (
              <StatCard
                key={accent}
                accent={accent}
                label={accent.toUpperCase()}
                value={[128, 12, 96, 5, 2, 47, 33][i]}
                sub="vs. mes anterior"
                icon={i === 0 ? <Car size={18} /> : i === 3 ? <Gauge size={18} /> : undefined}
              />
            ))}
          </div>
        </Section>

        {/* ── Campos de formulario ── */}
        <Section title="Campos de formulario">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            <TextInputField label="Matrícula" placeholder="1234 KLM" />
            <TextInputField label="Campo obligatorio" placeholder="Requerido" requiredVisual />
            <TextInputField label="Campo con aviso" defaultValue="Valor" warningMessage="Revisa este valor" />
            <TextInputField label="Deshabilitado" placeholder="No editable" disabled />
            <SelectField
              label="Estado"
              options={[
                { value: 'active', label: 'Activo' },
                { value: 'maintenance', label: 'En taller' },
                { value: 'baja', label: 'Baja' },
              ]}
            />
            <TextAreaField label="Notas" placeholder="Observaciones…" rows={3} />
          </div>
        </Section>

        {/* ── Modal ── */}
        <Section title="Modal">
          <Button variant="primary" onClick={() => setModalOpen(true)}>Abrir modal</Button>
          <Modal
            open={modalOpen}
            title="Título del modal"
            onClose={() => setModalOpen(false)}
            footer={
              <>
                <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
                <Button variant="primary" onClick={() => setModalOpen(false)}>Guardar</Button>
              </>
            }
          >
            <p style={{ margin: 0, color: 'var(--color-text)' }}>
              Contenido del modal. Se cierra con Escape o clic fuera.
            </p>
          </Modal>
        </Section>
      </div>
    </div>
  )
}
