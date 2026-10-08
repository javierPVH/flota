import { useEffect, useState } from 'react'
import { Car, Gauge, Wrench } from 'lucide-react'
import { Badge, Button, SegmentedControl, SidebarNav, SidebarNavGroup, SidebarNavItem, StatCard } from '@/ui'
import type { ButtonVariant } from '@/ui'

type Brand = 'grs' | 'vam'

const BRANDS = [
  { value: 'grs', label: 'Corporativo' },
  { value: 'vam', label: 'VAM' },
] as const

/** Conmutador de tema: pone o quita `data-brand="vam"` en <html>. */
export function BrandToggle() {
  const [brand, setBrand] = useState<Brand>(() =>
    document.documentElement.dataset.brand === 'vam' ? 'vam' : 'grs',
  )
  useEffect(() => {
    if (brand === 'vam') document.documentElement.dataset.brand = 'vam'
    else delete document.documentElement.dataset.brand
  }, [brand])
  return <SegmentedControl ariaLabel="Tema de marca" options={BRANDS} value={brand} onChange={setBrand} />
}

const variants: ButtonVariant[] = ['primary', 'secondary', 'outline', 'navy', 'success', 'warning', 'danger', 'default']

type Period = 'week' | 'month' | 'year'
const PERIODS = [
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
  { value: 'year', label: 'Año', disabled: true },
] as const

/** Lo nuevo del tema: variantes, SegmentedControl, Badge mono, StatCard compact y SidebarNav. */
export function BrandDemo() {
  const [period, setPeriod] = useState<Period>('month')
  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
        {variants.map((v) => (
          <Button key={v} variant={v} counterValue={2}>
            {v}
          </Button>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.75rem' }}>
        <SegmentedControl ariaLabel="Periodo" options={PERIODS} value={period} onChange={setPeriod} />
        <Badge mono tone="brand">1234 LKM</Badge>
        <Badge mono>9876 BCD</Badge>
        <Badge tone="success">Vigente</Badge>
        <Badge tone="warning">Caduca pronto</Badge>
        <Badge tone="danger" variant="solid">Caducado</Badge>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
        <StatCard compact label="Vehículos" value={42} sub="38 activos · 4 en taller" icon={<Car size={18} />} />
        <StatCard compact label="Uso" value="30 / 12" sub="71 % personal" accent="teal" icon={<Gauge size={18} />} />
        <StatCard compact label="Taller" value={4} sub="2 esta semana" accent="warning" icon={<Wrench size={18} />} />
      </div>

      <div style={{ maxWidth: 260, border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-card-sm)' }}>
        <SidebarNav ariaLabel="Navegación de ejemplo">
          <SidebarNavGroup title="Flota">
            <SidebarNavItem to="/" end icon={<Car size={18} />} count={42}>
              Vehículos
            </SidebarNavItem>
            <SidebarNavItem to="/taller" icon={<Wrench size={18} />}>
              Taller
            </SidebarNavItem>
          </SidebarNavGroup>
        </SidebarNav>
      </div>
    </div>
  )
}
