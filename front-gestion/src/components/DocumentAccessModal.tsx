import { useState, type FormEvent, type ReactNode } from 'react'
import { Button, Modal } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  updateDocument,
  type DocumentTypeAccess,
  type DriverActionMode,
  type DriverDeleteMode,
  type DriverDocumentRead,
} from '../api.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { useDocumentsCopy } from '../translations/documents.ts'
import type { DocumentAccessOverrides, FlotaDocument } from '../types.ts'
import { AccessLegend, SegSwitch, type AccessOption } from './AccessSwitch.tsx'
import { useAccessOptions } from './accessOptions.tsx'

/** Valor del mando de la supervisión; `''` = según el tipo. */
type Pick3 = 'yes' | 'no'
const toPick = (v: boolean | null): '' | Pick3 => (v === null ? '' : v ? 'yes' : 'no')
const fromPick = (p: '' | Pick3): boolean | null => (p === '' ? null : p === 'yes')

/** Un conmutador con «según el tipo» delante de las posiciones propias: va
 * solo con iconos, como la tabla de Ajustes, y «según el tipo» lleva el
 * icono de lo que el tipo dice hoy más sus dos palabras (y el valor entero
 * en el `title`). */
function AccessSwitch<V extends string>({
  label,
  inherited,
  inheritedText,
  inheritedIcon,
  value,
  options,
  onChange,
  disabled,
  disabledHint,
}: {
  label: string
  /** La opción «según el tipo», ya rotulada con lo que el tipo dice. */
  inherited: string
  inheritedText: string
  inheritedIcon: ReactNode
  value: '' | V
  options: Array<AccessOption<V>>
  onChange: (v: '' | V) => void
  disabled?: boolean
  disabledHint?: string
}) {
  const all: Array<AccessOption<'' | V>> = [
    { value: '', label: inherited, text: inheritedText, icon: inheritedIcon },
    ...options,
  ]
  return (
    <div className="doc-access-row">
      <span className="doc-access-label">{label}</span>
      <SegSwitch
        label={label}
        value={value}
        options={all}
        onChange={onChange}
        iconsOnly
        disabled={disabled}
        disabledHint={disabledHint}
      />
    </div>
  )
}

/**
 * «Acceso» de UN documento: el ajuste que pisa lo de su tipo (Documentos →
 * Ajustes) solo en él, con el mismo aspecto que esa tabla: la leyenda de los
 * iconos arriba y una fila por mando, rótulo a la izquierda y conmutador de
 * iconos a la derecha. Cada mando lleva «según el tipo» —con el icono de lo
 * que el tipo dice hoy, y el valor entero en el `title`— más sus posiciones
 * propias (dos para la supervisión y lo que lista; tres para lectura y
 * descarga; dos para el borrado, que nunca es directo) y se guarda entero:
 * lo que queda en «según el tipo» viaja como nulo, que es lo que vuelve a
 * dejar mandar al tipo.
 */
export function DocumentAccessModal({
  doc,
  rule,
  onClose,
  onSaved,
}: {
  doc: FlotaDocument
  /** La regla del tipo, para decir qué vale «según el tipo». */
  rule: DocumentTypeAccess | undefined
  onClose: () => void
  onSaved: () => void
}) {
  const t = useDocumentsCopy()
  const copy = t.access.modal
  const etiqueta = useDomainLabels()
  const [supervisor, setSupervisor] = useState<'' | Pick3>(
    toPick(doc.supervisor_read_override ?? null),
  )
  const [list, setList] = useState<'' | DriverDocumentRead>(doc.driver_read_override ?? '')
  const [view, setView] = useState<'' | DriverActionMode>(doc.driver_view_override ?? '')
  const [download, setDownload] = useState<'' | DriverActionMode>(doc.driver_download_override ?? '')
  const [remove, setRemove] = useState<'' | DriverDeleteMode>(doc.driver_delete_override ?? '')
  const options = useAccessOptions()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Lo que el tipo dice hoy de cada mando: su opción (rótulo e icono).
  const pick = <V extends string>(opts: Array<AccessOption<V>>, v: V) =>
    opts.find((o) => o.value === v) ?? opts[0]
  const typeSays = {
    supervisor: pick(options.yesNo, (rule?.supervisor_read ?? true) ? 'yes' : 'no'),
    list: pick(options.list, rule?.driver_read ?? 'all'),
    view: pick(options.action, rule?.driver_view ?? 'allow'),
    download: pick(options.action, rule?.driver_download ?? 'allow'),
    remove: pick(options.remove, rule?.driver_delete ?? 'request'),
  }
  const inheritedOf = (opt: AccessOption<string>) => ({
    inherited: copy.inherit(opt.label),
    inheritedText: copy.inheritShort,
    inheritedIcon: opt.icon,
  })
  // Lo que vale para ÉL en «listar»: su ajuste o, sin él, lo del tipo. Si
  // no se lista, lectura, descarga y borrado no aplican y van apagados.
  const notListed = (list || typeSays.list.value) === 'none'
  const moot = { disabled: notListed, disabledHint: t.settings.notListedHint }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const overrides: DocumentAccessOverrides = {
      supervisor_read_override: fromPick(supervisor),
      driver_read_override: list || null,
      driver_view_override: view || null,
      driver_download_override: download || null,
      driver_delete_override: remove || null,
    }
    try {
      await updateDocument(doc.id, overrides)
      onSaved()
    } catch (err) {
      setError(asErrorMessage(err, copy.saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open wide title={copy.title(etiqueta.docType(doc))} onClose={onClose}>
      <form className="ops-modal" onSubmit={submit}>
        <p className="muted ops-note">{copy.intro}</p>
        <AccessLegend title={t.settings.legend} options={options.legend} />
        <div className="doc-access-rows">
          <AccessSwitch<Pick3>
            label={copy.supervisor}
            {...inheritedOf(typeSays.supervisor)}
            value={supervisor}
            options={options.yesNo}
            onChange={setSupervisor}
          />
          <AccessSwitch<DriverDocumentRead>
            label={copy.list}
            {...inheritedOf(typeSays.list)}
            value={list}
            options={options.list}
            onChange={setList}
          />
          <AccessSwitch<DriverActionMode>
            label={copy.view}
            {...inheritedOf(typeSays.view)}
            {...moot}
            value={view}
            options={options.action}
            onChange={setView}
          />
          <AccessSwitch<DriverActionMode>
            label={copy.download}
            {...inheritedOf(typeSays.download)}
            {...moot}
            value={download}
            options={options.action}
            onChange={setDownload}
          />
          <AccessSwitch<DriverDeleteMode>
            label={copy.remove}
            {...inheritedOf(typeSays.remove)}
            {...moot}
            value={remove}
            options={options.remove}
            onChange={setRemove}
          />
        </div>
        {error && (
          <div role="alert" className="form-error">
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? copy.saving : copy.save}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
