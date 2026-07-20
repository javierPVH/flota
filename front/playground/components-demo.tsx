import { useState } from 'react'
import { Pencil, Trash2, Plus } from 'lucide-react'
import {
  Button,
  IconButton,
  ButtonGroup,
  TabButton,
  TextInputField,
  TextAreaField,
  SelectField,
  DateRangeField,
} from '@/ui'
import type { ButtonVariant } from '@/ui'

const variants: ButtonVariant[] = ['primary', 'secondary', 'navy', 'warning', 'danger', 'default']

export function ComponentsDemo() {
  const [tab, setTab] = useState('a')
  const [text, setText] = useState('')
  const [area, setArea] = useState('')
  const [sel, setSel] = useState('')
  const [range, setRange] = useState('—')

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
        {variants.map((v) => (
          <Button key={v} variant={v} counterValue={3}>
            {v}
          </Button>
        ))}
      </div>

      <ButtonGroup>
        <IconButton variant="default"><Pencil size={16} /></IconButton>
        <IconButton variant="warning"><Plus size={16} /></IconButton>
        <IconButton variant="danger"><Trash2 size={16} /></IconButton>
      </ButtonGroup>

      <div style={{ display: 'flex', gap: '.4rem' }}>
        <TabButton active={tab === 'a'} onClick={() => setTab('a')}>Pestaña A</TabButton>
        <TabButton active={tab === 'b'} onClick={() => setTab('b')} counterValue={5}>Pestaña B</TabButton>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem' }}>
        <TextInputField
          label="Texto"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escribe algo…"
          requiredVisual
        />
        <SelectField
          label="Selección"
          options={[
            { value: '1', label: 'Uno' },
            { value: '2', label: 'Dos' },
            { value: '3', label: 'Tres' },
          ]}
          value={sel}
          onValueChange={setSel}
          includeSelectFlag
          enableSearchFilter
        />
      </div>

      <TextAreaField
        label="Área de texto"
        value={area}
        onChange={(e) => setArea(e.target.value)}
        warningMessage={area.length > 20 ? 'Texto muy largo' : undefined}
        warningClosable
      />

      <DateRangeField
        label={`Rango de fechas (${range})`}
        onRangeChange={(v) => setRange(`${v.startDate || '—'} → ${v.endDate || '—'}`)}
      />
    </div>
  )
}
