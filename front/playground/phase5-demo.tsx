import { useState } from 'react'
import { TrendingUp, Wallet, FileSpreadsheet } from 'lucide-react'
import { Modal, Panel, StatList, StatCard, Section, Footer, Button } from '@/ui'
import { useExcelConverter } from '@/excel'

export function Phase5Demo() {
  const [open, setOpen] = useState(false)
  const [csvNames, setCsvNames] = useState<string[]>([])
  const { convert, converting, SheetSelector } = useExcelConverter()

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    try {
      const csv = await convert(Array.from(files))
      setCsvNames(csv.map((f) => f.name))
    } catch {
      setCsvNames(['(cancelado)'])
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem' }}>
        <StatCard label="Ingresos" value="12.4k" sub="+8%" accent="success" icon={<TrendingUp size={18} />} />
        <StatCard label="Gastos" value="3.1k" sub="-2%" accent="danger" icon={<Wallet size={18} />} />
        <StatCard label="Balance" value="9.3k" accent="navy" />
      </div>

      <Panel tone="info" title="Panel informativo">
        Contenido de un panel con tono <b>info</b>.
      </Panel>

      <StatList
        items={[
          { key: 'a', label: 'Pendientes', value: 4, tone: 'warning' },
          { key: 'b', label: 'Completados', value: 27, tone: 'success' },
          { key: 'c', label: 'Errores', value: 1, tone: 'danger' },
        ]}
      />

      <div>
        <Button variant="primary" onClick={() => setOpen(true)}>Abrir modal</Button>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.9rem' }}>
        <FileSpreadsheet size={18} />
        <span>Convertir Excel→CSV:</span>
        <input type="file" multiple accept=".xlsx,.xls,.csv" onChange={(e) => onFiles(e.target.files)} />
        {converting && <span>convirtiendo…</span>}
      </label>
      {csvNames.length > 0 && (
        <div style={{ fontSize: '.85rem', fontFamily: 'ui-monospace, monospace' }}>
          → {csvNames.join(', ')}
        </div>
      )}

      <Modal open={open} title="Modal de ejemplo" onClose={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>Cerrar</Button>}>
        <Section section={{ title: 'Sección dentro del modal', content: <p>Layout Section + Footer de la base.</p> }} />
        <Footer />
      </Modal>

      {SheetSelector}
    </div>
  )
}
