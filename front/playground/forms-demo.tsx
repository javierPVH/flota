import { useState } from 'react'
import { CreateFormPanel, CatalogEntityCreateForm } from '@/forms'
import type { CatalogCreateFieldDefinition, CatalogCreateSubmit } from '@/forms'

const fields: CatalogCreateFieldDefinition[] = [
  { key: 'name', label: 'Nombre', required: true, placeholder: 'Ej. Acme S.L.' },
  { key: 'email', label: 'Email', kind: 'email', placeholder: 'contacto@acme.com' },
  { key: 'website', label: 'Web', kind: 'url', placeholder: 'https://acme.com' },
  {
    key: 'country',
    label: 'País',
    kind: 'select',
    required: true,
    options: [
      { value: 'es', label: 'España' },
      { value: 'fr', label: 'Francia' },
      { value: 'pt', label: 'Portugal' },
    ],
  },
  { key: 'notes', label: 'Notas', kind: 'textarea', rows: 2, fullWidth: true },
]

export function FormsDemo() {
  const [created, setCreated] = useState<string[]>([])

  // Submit inyectado: en una app real llamaría a la API; aquí es en memoria.
  const submit: CatalogCreateSubmit = async ({ data }) => {
    await new Promise((r) => setTimeout(r, 300))
    return { id: created.length + 1, name: data.name, label: `${data.name} (${data.country})` }
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <CreateFormPanel title="Alta de empresa">
        <CatalogEntityCreateForm
          entity="company"
          title="Nueva empresa"
          description="Formulario generado a partir de definiciones declarativas."
          fields={fields}
          submit={submit}
          resetOnSuccess
          onCreated={(p) => setCreated((c) => [...c, String(p.label ?? p.id)])}
        />
      </CreateFormPanel>
      {created.length > 0 && (
        <div style={{ fontSize: '.85rem', marginTop: '.5rem', color: '#166534' }}>
          Creados: {created.join(' · ')}
        </div>
      )}
    </div>
  )
}
