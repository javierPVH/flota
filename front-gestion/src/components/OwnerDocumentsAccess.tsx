import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Badge, Button, SelectField } from '@flota/ui/ui'
import type { BadgeTone } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { useAppLang } from '@flota/ui/i18n'
import { ArrowLeft, Check, Layers, ShieldCheck } from 'lucide-react'

import {
  grantDocumentAccess,
  listAll,
  listDocuments,
  listDocumentTypeAccess,
  updateDocument,
  type DocumentTypeAccess,
} from '../api.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { ALL_DOCUMENT_TYPES } from '../documentRules.ts'
import { fmtDate } from '../format.ts'
import { useDocumentsCopy } from '../translations/documents.ts'
import { useRequestsCopy } from '../translations/requests.ts'
import type { DocumentAccessOverrides, DocumentEffectiveAccess, FlotaDocument } from '../types.ts'
import { EMPTY_PICK, overridesFromPick, pickFromDoc, type AccessPick } from './accessPick.ts'
import { useAccessOptions } from './accessOptions.tsx'
import { AccessLegend, SegSwitch, type AccessOption } from './AccessSwitch.tsx'
import { useAccessParts } from './useAccessParts.ts'

/** El titular cuya documentación se lista: el coche o la persona. */
export type DocumentOwner = { vehicle: number } | { user: number }

/** A quién se le está decidiendo el acceso. */
export interface Requester {
  id: number
  name: string
}

type AccessKind = 'view' | 'download'

/**
 * Cómo le va a esa persona ESE documento, para una acción (verlo o
 * bajárselo): el listado se trae «visto como» ella (`access_for`), así que
 * `can_*` y `*_request` ya hablan de la persona y no de quien mira.
 */
type State = 'direct' | 'granted' | 'pending' | 'request' | 'denied'
function stateOf(doc: FlotaDocument, kind: AccessKind): State {
  const puede = kind === 'view' ? doc.can_view : doc.can_download
  const peticion = kind === 'view' ? doc.view_request : doc.download_request
  if (peticion === 'denied') return 'denied'
  if (puede) return peticion === 'granted' ? 'granted' : 'direct'
  return peticion === 'pending' ? 'pending' : 'request'
}
const STATE_TONE: Record<State, BadgeTone> = {
  direct: 'success',
  granted: 'success',
  pending: 'warning',
  request: 'neutral',
  denied: 'danger',
}
/** Se puede conceder cuando le hace falta (con solicitud) y no está ya. */
const grantable = (state: State) => state === 'request' || state === 'pending'

/**
 * Cómo le va a quien pide ESE documento, en chapas: si le sale en su lista
 * y, si le sale, cómo lo ve y cómo se lo baja. Lo pinta la lista y, fuera de
 * ella, la tarjeta «usar uno que ya existe» de la petición de documento con
 * lo elegido en la ventana.
 */
export function RequesterAccess({ doc }: { doc: FlotaDocument }) {
  const copy = useRequestsCopy().ownerDocs
  if (doc.subject_lists === false) {
    return (
      <Badge tone="danger" size="sm">
        {copy.notListed}
      </Badge>
    )
  }
  const label: Record<AccessKind, Record<State, string>> = {
    view: {
      direct: copy.viewDirect,
      granted: copy.viewGranted,
      pending: copy.viewPending,
      request: copy.viewOnRequest,
      denied: copy.viewDenied,
    },
    download: {
      direct: copy.downloadDirect,
      granted: copy.downloadGranted,
      pending: copy.downloadPending,
      request: copy.downloadOnRequest,
      denied: copy.downloadDenied,
    },
  }
  const view = stateOf(doc, 'view')
  const download = stateOf(doc, 'download')
  return (
    <span className="doc-access-cell">
      <Badge tone={STATE_TONE[view]} size="sm">
        {label.view[view]}
      </Badge>
      <Badge tone={STATE_TONE[download]} size="sm">
        {label.download[download]}
      </Badge>
    </span>
  )
}

/** Solo los cuatro mandos del CONDUCTOR viajan (PATCH): el de la supervisión
 * no se toca desde aquí, y un cuerpo con los cinco lo pisaría en cada
 * documento. */
function driverFields(pick: AccessPick): Partial<DocumentAccessOverrides> {
  const all = overridesFromPick(pick)
  return {
    driver_read_override: all.driver_read_override,
    driver_view_override: all.driver_view_override,
    driver_download_override: all.driver_download_override,
    driver_delete_override: all.driver_delete_override,
  }
}

/** Lo que valdrá para el CONDUCTOR en un documento con unos mandos: cada
 * uno pisa lo del tipo si se ha fijado, y si no manda el tipo (o la regla de
 * fábrica, como en el back). El de la supervisión se queda como está. */
function projectedAccess(
  doc: FlotaDocument,
  pick: AccessPick,
  rule: DocumentTypeAccess | undefined,
): DocumentEffectiveAccess {
  // «Según el tipo» es la regla del tipo; si no se ha cargado, lo que el
  // documento dice hoy vale como regla mientras no tenga ese mando pisado.
  const eff = doc.effective_access
  return {
    supervisor_read: eff?.supervisor_read ?? rule?.supervisor_read ?? true,
    driver_read:
      pick.list ||
      rule?.driver_read ||
      (doc.driver_read_override == null ? eff?.driver_read : undefined) ||
      'all',
    driver_view:
      pick.view ||
      rule?.driver_view ||
      (doc.driver_view_override == null ? eff?.driver_view : undefined) ||
      'allow',
    driver_download:
      pick.download ||
      rule?.driver_download ||
      (doc.driver_download_override == null ? eff?.driver_download : undefined) ||
      'allow',
    driver_delete:
      pick.remove ||
      rule?.driver_delete ||
      (doc.driver_delete_override == null ? eff?.driver_delete : undefined) ||
      'request',
  }
}

/** Los cuatro mandos del conductor, como columnas de la tabla del paso. */
type ControlKey = 'list' | 'view' | 'download' | 'remove'
const CONTROL_KEYS: ControlKey[] = ['list', 'view', 'download', 'remove']
const CONTROL_FIELD: Record<ControlKey, keyof DocumentEffectiveAccess> = {
  list: 'driver_read',
  view: 'driver_view',
  download: 'driver_download',
  remove: 'driver_delete',
}

/** El paso en el que está la lista: marcar documentos o decidir su acceso. */
type Step = 'pick' | 'access'
/** Cómo se decide el acceso de los marcados: el mismo para todos o uno propio
 * por documento. */
type Mode = 'same' | 'each'

/**
 * La documentación que YA HAY del titular, para decidir **cómo la leen los
 * conductores** del coche —y nada más: la supervisión y la administración no
 * se tocan desde aquí—, en **dos pasos**. Primero se **marcan** los
 * documentos (una fila por documento con cómo lo leen hoy los conductores
 * —lo de su tipo o su ajuste— y **cómo le va a la persona que pide**: si le
 * sale en su lista, y si lo ve y se lo baja directo, con solicitud, pedido,
 * concedido o no permitido). Después se decide el acceso de los marcados:
 * **el mismo para todos** (unos mandos que se escriben en cada uno) o **uno
 * propio por documento** (cada uno con los suyos, abiertos con lo que ya
 * tiene), con los cuatro mandos del conductor y solo esos (`driverFields`).
 * Y, de paso, **concederle a quien pide** lo que, con el acceso que ha
 * quedado, le siga yendo con solicitud (la misma fila concedida que una
 * petición: `POST /documents/{id}/grant/`, mirando la lista otra vez «vista
 * como» esa persona después de guardar). Con `onPick`, cada fila ofrece
 * además elegir ese documento (atender con él una petición de documento).
 *
 * Lo pintan las dos bandejas de documentos de `/solicitudes`: la de
 * peticiones sobre un documento y la del papel que falta.
 */
export function OwnerDocumentsAccess({
  owner,
  ownerLabel,
  requester,
  highlight,
  onPick,
  onChanged,
  onDone,
  onLoaded,
  refreshKey = 0,
}: {
  owner: DocumentOwner
  ownerLabel: string
  requester: Requester | null
  /** El documento del que habla la petición abierta: se marca en la lista. */
  highlight?: number
  /** Ofrece elegir un documento (atender la petición con él). */
  onPick?: (doc: FlotaDocument) => void
  /** Algo cambió (una concesión, un ajuste): quien monta la lista recarga. */
  onChanged?: () => void
  /** Guardado el acceso: quien monta la lista se la lleva (cierra su modal)
   * y enseña él el acuse, con los documentos marcados tal y como quedan
   * «vistos como» quien pide. Sin esto, la lista vuelve al primer paso con
   * el acuse dentro. */
  onDone?: (notice: string, docs: FlotaDocument[]) => void
  /** Cuántos documentos hay, cada vez que se cargan (la pestaña lo enseña). */
  onLoaded?: (count: number) => void
  /** Súbelo para que la lista se vuelva a pedir. */
  refreshKey?: number
}) {
  const t = useRequestsCopy()
  const copy = t.ownerDocs
  const bulk = copy.bulk
  const tDocs = useDocumentsCopy()
  const etiqueta = useDomainLabels()
  const lang = useAppLang()
  const options = useAccessOptions()
  const [docs, setDocs] = useState<FlotaDocument[] | null>(null)
  const [rules, setRules] = useState<DocumentTypeAccess[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Los dos filtros de la tabla —el tipo y quién lo subió—, que no tocan lo
  // marcado: se cambia de tipo y lo marcado se queda, que es lo que permite
  // marcar de varios.
  const [typeFilter, setTypeFilter] = useState('')
  const [uploader, setUploader] = useState<'' | 'requester' | 'others'>('')
  // Las filas marcadas y el paso.
  const [selected, setSelected] = useState<number[]>([])
  const [step, setStep] = useState<Step>('pick')
  const [mode, setMode] = useState<Mode>('same')
  const [samePick, setSamePick] = useState<AccessPick>(EMPTY_PICK)
  const [eachPick, setEachPick] = useState<Record<number, AccessPick>>({})
  const [grantToo, setGrantToo] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // R3-30: la copia por ref — solo pinta el error de carga. Y el aviso de
  // cuántos hay, también: no es un motivo para volver a pedir la lista.
  const copyRef = useRef(copy)
  const onLoadedRef = useRef(onLoaded)
  useEffect(() => {
    copyRef.current = copy
    onLoadedRef.current = onLoaded
  })

  const ownerKey = 'vehicle' in owner ? `v${owner.vehicle}` : `u${owner.user}`
  const requesterId = requester?.id ?? null
  /** La lista, «vista como» quien pide. */
  const fetchDocs = useCallback(() => {
    const filtros = {
      ...('vehicle' in owner ? { vehicle: owner.vehicle } : { user: owner.user }),
      ...(requesterId ? { access_for: requesterId } : {}),
    }
    return listAll(listDocuments(filtros))
    // `ownerKey` resume al titular: el objeto se recrea en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey, requesterId])
  const load = useCallback(() => {
    Promise.all([fetchDocs(), listDocumentTypeAccess().catch(() => [])])
      .then(([loaded, reglas]) => {
        setDocs(loaded)
        setRules(reglas)
        setError('')
        // Lo marcado sobrevive a la recarga solo si sigue en la lista.
        setSelected((current) => current.filter((id) => loaded.some((d) => d.id === id)))
        onLoadedRef.current?.(loaded.length)
      })
      .catch((err) => {
        setDocs([])
        setError(asErrorMessage(err, copyRef.current.loadError))
        onLoadedRef.current?.(0)
      })
  }, [fetchDocs])
  useEffect(load, [load, refreshKey])

  const accessByType = useMemo(() => new Map(rules.map((r) => [r.type, r])), [rules])
  const accessParts = useAccessParts(accessByType)

  const chosen = useMemo(
    () => (docs ?? []).filter((d) => selected.includes(d.id)),
    [docs, selected],
  )
  // Quién subió cada uno, respecto a quien pide; y cuántos hay de cada tipo
  // (dentro de lo que deja pasar el otro filtro, para que los números no
  // prometan filas que luego no salen). «Marcar todos» marca y desmarca LAS
  // QUE SE VEN.
  const byUploader = (d: FlotaDocument) =>
    uploader === '' ||
    (requesterId !== null &&
      (uploader === 'requester' ? d.uploaded_by === requesterId : d.uploaded_by !== requesterId))
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of (docs ?? []).filter(byUploader)) counts.set(d.type, (counts.get(d.type) ?? 0) + 1)
    return counts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, uploader, requesterId])
  const uploaderCounts = useMemo(() => {
    const base = (docs ?? []).filter((d) => typeFilter === '' || d.type === typeFilter)
    return {
      all: base.length,
      requester: base.filter((d) => d.uploaded_by === requesterId).length,
      others: base.filter((d) => d.uploaded_by !== requesterId).length,
    }
  }, [docs, typeFilter, requesterId])
  const visible = useMemo(
    () => (docs ?? []).filter((d) => (typeFilter === '' || d.type === typeFilter) && byUploader(d)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docs, typeFilter, uploader, requesterId],
  )
  const filtered = typeFilter !== '' || uploader !== ''
  const allChecked = visible.length > 0 && visible.every((d) => selected.includes(d.id))
  const toggleAll = () =>
    setSelected((current) =>
      allChecked
        ? current.filter((id) => !visible.some((d) => d.id === id))
        : [...current, ...visible.filter((d) => !current.includes(d.id)).map((d) => d.id)],
    )
  const toggleOne = (id: number) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    )
  // Para «el mismo para todos»: la regla del tipo si todas las marcadas son
  // del mismo, y «de cada documento» si se mezclan tipos.
  const chosenTypes = new Set(chosen.map((d) => d.type))
  const sameRule = chosenTypes.size === 1 ? accessByType.get(chosen[0].type) : undefined

  /** Al paso del acceso: el mismo para todos en limpio, y cada uno abierto
   * con los mandos que ya tiene. */
  function openAccess() {
    setMode('same')
    setSamePick(EMPTY_PICK)
    setEachPick(Object.fromEntries(chosen.map((d) => [d.id, pickFromDoc(d)])))
    setGrantToo(true)
    setSaveError('')
    setNotice('')
    setStep('access')
  }

  /** Guardar: un PATCH por documento con los mandos del conductor; después,
   * si se pidió, se mira la lista otra vez como quien pide y se le concede
   * lo que le siga yendo con solicitud en los marcados. */
  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setSaveError('')
    let ok = 0
    let failed = 0
    for (const doc of chosen) {
      const pick = mode === 'same' ? samePick : (eachPick[doc.id] ?? pickFromDoc(doc))
      try {
        await updateDocument(doc.id, driverFields(pick))
        ok += 1
      } catch {
        failed += 1
      }
    }
    if (ok === 0 && failed > 0) {
      setSaving(false)
      setSaveError(bulk.saveError(failed))
      return
    }
    let granted = 0
    let grantFailed = false
    if (requester && grantToo && ok > 0) {
      try {
        const fresh = await fetchDocs()
        for (const doc of fresh) {
          if (!selected.includes(doc.id) || doc.subject_lists === false) continue
          for (const kind of ['view', 'download'] as const) {
            if (!grantable(stateOf(doc, kind))) continue
            await grantDocumentAccess(doc.id, { user: requester.id, kind })
            granted += 1
          }
        }
      } catch {
        grantFailed = true
      }
    }
    setSaving(false)
    const acuse = [
      bulk.saved(ok),
      failed > 0 ? bulk.saveError(failed) : '',
      requester && granted > 0 ? bulk.granted(granted, requester.name) : '',
      grantFailed ? copy.grantError : '',
    ]
      .filter(Boolean)
      .join(' ')
    onChanged?.()
    // Resuelta la ventana, se cierra: el acuse lo enseña quien la montó, con
    // los marcados como han quedado (se vuelven a mirar como quien pide,
    // ya con lo concedido).
    if (onDone) {
      const final = await fetchDocs().catch(() => docs ?? [])
      onDone(
        acuse,
        final.filter((d) => selected.includes(d.id)),
      )
      return
    }
    setNotice(acuse)
    setStep('pick')
    load()
  }

  const modalCopy = tDocs.access.modal
  const controlLabel: Record<ControlKey, string> = {
    list: modalCopy.list,
    view: modalCopy.view,
    download: modalCopy.download,
    remove: modalCopy.remove,
  }
  const controlOptions = (key: ControlKey): Array<AccessOption<string>> =>
    key === 'list' ? options.list : key === 'remove' ? options.remove : options.action
  const findOption = (key: ControlKey, value: string) =>
    controlOptions(key).find((o) => o.value === value) ?? controlOptions(key)[0]

  /** Los cuatro conmutadores de una fila, solo con iconos: «según el tipo»
   * (capas) delante de las posiciones propias. Con `rule` dice en el `title`
   * qué es hoy; sin ella (tipos mezclados), que es el de cada documento. */
  function switchCells(
    pick: AccessPick,
    onChange: (next: AccessPick) => void,
    rule: DocumentTypeAccess | undefined,
    mixed: boolean,
  ) {
    const listSays = rule?.driver_read ?? 'all'
    const notListed = (pick.list || listSays) === 'none'
    return CONTROL_KEYS.map((key) => {
      const field = CONTROL_FIELD[key]
      const typeSays = findOption(key, (rule?.[field] as string | undefined) ?? '')
      const inherited: AccessOption<string> = {
        value: '',
        label: mixed ? modalCopy.inheritMixed : modalCopy.inherit(typeSays.label),
        icon: <Layers size={14} aria-hidden />,
      }
      const moot = key !== 'list' && notListed
      return (
        <td key={key} className="owner-docs-switch">
          <SegSwitch
            label={controlLabel[key]}
            value={pick[key]}
            options={[inherited, ...controlOptions(key)]}
            onChange={(v) => onChange({ ...pick, [key]: v })}
            iconsOnly
            disabled={moot}
            disabledHint={tDocs.settings.notListedHint}
          />
        </td>
      )
    })
  }

  /** Lo que valdrá en un documento, mando a mando, como icono quieto: es
   * donde «según el tipo» de la fila de arriba se vuelve concreto. */
  function staticCells(after: DocumentEffectiveAccess, pick: AccessPick) {
    return CONTROL_KEYS.map((key) => {
      const opt = findOption(key, after[CONTROL_FIELD[key]] as string)
      return (
        <td key={key} className="owner-docs-switch">
          <span
            className={`access-static${pick[key] ? ' is-adjusted' : ''}`}
            role="img"
            aria-label={opt.label}
            title={`${controlLabel[key]}: ${opt.label}`}
          >
            {opt.icon}
          </span>
        </td>
      )
    })
  }

  /** Qué podrá hacer quien pide con un documento con el acceso proyectado:
   * si le saldrá (lo que lista el conductor y quién lo subió) y, de lo que
   * le salga, si lo verá y se lo bajará directo, con solicitud —o concedido
   * ahora, si la casilla está marcada— o nunca. Una estimación honesta: si
   * el listar no cambia, vale lo que el back dice hoy. */
  function outcomeFor(doc: FlotaDocument, after: DocumentEffectiveAccess) {
    const todayRead = doc.effective_access?.driver_read ?? accessByType.get(doc.type)?.driver_read ?? 'all'
    const lists =
      after.driver_read === todayRead && doc.subject_lists !== undefined
        ? doc.subject_lists !== false
        : after.driver_read === 'none'
          ? false
          : after.driver_read === 'own'
            ? doc.uploaded_by === requesterId
            : true
    const one = (kind: AccessKind, mode: string): { label: string; tone: BadgeTone } => {
      const sum = bulk.summary
      const already = stateOf(doc, kind) === 'granted'
      if (mode === 'deny') return { label: kind === 'view' ? sum.viewDenied : sum.downloadDenied, tone: 'danger' }
      if (mode === 'allow' || already) return { label: kind === 'view' ? sum.view : sum.download, tone: 'success' }
      if (grantToo) return { label: kind === 'view' ? sum.viewGranted : sum.downloadGranted, tone: 'success' }
      return { label: kind === 'view' ? sum.viewRequest : sum.downloadRequest, tone: 'warning' }
    }
    return {
      lists,
      view: one('view', after.driver_view),
      download: one('download', after.driver_download),
    }
  }

  return (
    <section className="owner-docs" aria-label={copy.title(ownerLabel)}>
      {notice && (
        <div role="status" className="notice-ok">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}
      {docs === null ? (
        <p className="loading-state" role="status">
          {t.loading}
        </p>
      ) : docs.length === 0 ? (
        <p className="muted">{copy.empty}</p>
      ) : step === 'pick' ? (
        <>
          <h4 className="owner-docs-title">{copy.title(ownerLabel)}</h4>
          <p className="muted owner-docs-intro">{copy.intro}</p>
          {/* La barra de lo marcado: «marcar todos», cuántas van y el paso
              siguiente, que es decidir su acceso. */}
          <div className="owner-docs-bulk" role="group" aria-label={bulk.label}>
            {/* Los dos filtros: el TIPO —todos los del enumerado, también los
                que no tienen nada, con cuántos hay de cada uno— y quién lo
                subió, quien pide u otros. Ninguno toca lo marcado. */}
            <span className="owner-docs-bulk-filter">
              <span className="ops-checks-label">{copy.typeFilter.label}</span>
              <SelectField
                aria-label={copy.typeFilter.label}
                containerClassName="role-filter"
                required
                options={[
                  { value: '', label: `${copy.typeFilter.all} (${docs.filter(byUploader).length})` },
                  ...ALL_DOCUMENT_TYPES.map((value) => ({
                    value,
                    label: `${etiqueta.docType({ type: value, type_display: value })} (${typeCounts.get(value) ?? 0})`,
                  })),
                ]}
                value={typeFilter}
                onValueChange={setTypeFilter}
              />
            </span>
            {requester && (
              <span className="owner-docs-bulk-filter">
                <span className="ops-checks-label">{copy.uploader.label}</span>
                <SelectField
                  aria-label={copy.uploader.label}
                  containerClassName="role-filter"
                  required
                  options={[
                    { value: '', label: `${copy.uploader.all} (${uploaderCounts.all})` },
                    {
                      value: 'requester',
                      label: `${copy.uploader.requester(requester.name)} (${uploaderCounts.requester})`,
                    },
                    { value: 'others', label: `${copy.uploader.others} (${uploaderCounts.others})` },
                  ]}
                  value={uploader}
                  onValueChange={(value) => setUploader(value as '' | 'requester' | 'others')}
                />
              </span>
            )}
            <label className="baja-toggle">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                aria-label={filtered ? bulk.selectAllOf : bulk.selectAll}
              />
              {filtered ? bulk.selectAllOf : bulk.selectAll}
            </label>
            <span className="muted owner-docs-bulk-count">
              {selected.length === 0 ? bulk.none : bulk.count(selected.length)}
            </span>
            <span className="owner-docs-bulk-next">
              <Button
                size="sm"
                variant="primary"
                disabled={selected.length === 0}
                onClick={openAccess}
              >
                <ShieldCheck size={14} aria-hidden /> {bulk.next(selected.length)}
              </Button>
            </span>
          </div>
          <table className="data owner-docs-table">
            <thead>
              <tr>
                <th className="owner-docs-check" />
                <th>{copy.columns.document}</th>
                <th>{copy.columns.access}</th>
                {requester && <th>{copy.columns.forPerson(requester.name)}</th>}
                {onPick && <th className="owner-docs-actions-head">{copy.columns.actions}</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((doc) => {
                const parts = accessParts(doc)
                const name = etiqueta.docType(doc)
                return (
                  <tr
                    key={doc.id}
                    className={[
                      doc.id === highlight ? 'row-pending' : '',
                      selected.includes(doc.id) ? 'row-checked' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <td className="owner-docs-check">
                      <input
                        type="checkbox"
                        aria-label={bulk.selectOne(name)}
                        checked={selected.includes(doc.id)}
                        onChange={() => toggleOne(doc.id)}
                      />
                    </td>
                    <td>
                      <strong>{name}</strong>
                      {doc.id === highlight && (
                        <>
                          {' '}
                          <Badge tone="brand" size="sm">
                            {copy.thisOne}
                          </Badge>
                        </>
                      )}
                      <div className="muted">
                        {fmtDate(doc.created_at, lang)}
                        {doc.uploaded_by_name && ` · ${doc.uploaded_by_name}`}
                      </div>
                      {doc.notes && (
                        <div className="muted cell-truncate" title={doc.notes}>
                          {doc.notes}
                        </div>
                      )}
                    </td>
                    <td>
                      {/* Solo lo del conductor: es de lo que se decide aquí. */}
                      <span className="doc-access-cell">
                        {parts.driver.map((part) => (
                          <Badge key={part} tone="neutral" size="sm">
                            {part}
                          </Badge>
                        ))}
                      </span>
                    </td>
                    {requester && (
                      <td>
                        <RequesterAccess doc={doc} />
                      </td>
                    )}
                    {onPick && (
                      <td>
                        <div className="row-actions owner-docs-actions">
                          <Button size="sm" variant="secondary" onClick={() => onPick(doc)}>
                            <Check size={14} aria-hidden /> {copy.pick}
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      ) : (
        /* El paso del acceso: los mandos del conductor para los marcados,
           los mismos para todos o unos por documento. */
        <form className="owner-docs-step" onSubmit={save}>
          <h4 className="owner-docs-title">{bulk.stepTitle(chosen.length)}</h4>
          <p className="muted owner-docs-intro">{bulk.stepIntro}</p>
          <div className="choice-access">
            <span className="ops-checks-label">{bulk.modeLabel}</span>
            <div className="seg-switch" role="radiogroup" aria-label={bulk.modeLabel}>
              {(['same', 'each'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  className={mode === value ? 'is-active' : ''}
                  onClick={() => setMode(value)}
                >
                  {value === 'same' ? bulk.modeSame : bulk.modeEach}
                </button>
              ))}
            </div>
          </div>
          {requester && (
            <label className="baja-toggle choice-grant">
              <input
                type="checkbox"
                checked={grantToo}
                onChange={(event) => setGrantToo(event.target.checked)}
              />
              <span>
                {bulk.grantToo(requester.name)}
                <span className="muted">{bulk.grantTooHint}</span>
              </span>
            </label>
          )}
          {/* La tabla del paso: una fila por documento con los cuatro mandos
              del conductor como iconos —o la fila «Todos los marcados» cuando
              es el mismo para todos, y entonces cada documento enseña en qué
              se le resuelve— y qué podrá hacer quien pide. */}
          <section className="owner-docs-summary" aria-label={bulk.summary.title}>
            <AccessLegend title={tDocs.settings.legend} options={options.legend} />
            <p className="muted owner-docs-summary-note">{bulk.summary.note}</p>
            <table className="data owner-docs-table owner-docs-step-table">
              <thead>
                <tr>
                  <th>{copy.columns.document}</th>
                  {CONTROL_KEYS.map((key) => (
                    <th key={key} className="owner-docs-switch" title={controlLabel[key]}>
                      {bulk.summary.columns[key]}
                    </th>
                  ))}
                  {requester && <th>{bulk.summary.forPerson(requester.name)}</th>}
                </tr>
              </thead>
              <tbody>
                {mode === 'same' && (
                  <tr className="owner-docs-all-row" aria-label={bulk.summary.allRow(chosen.length)}>
                    <td>
                      <strong>{bulk.summary.allRow(chosen.length)}</strong>
                    </td>
                    {switchCells(samePick, setSamePick, sameRule, chosenTypes.size > 1)}
                    {requester && <td />}
                  </tr>
                )}
                {chosen.map((doc) => {
                  const name = etiqueta.docType(doc)
                  const pick = mode === 'same' ? samePick : (eachPick[doc.id] ?? pickFromDoc(doc))
                  const rule = accessByType.get(doc.type)
                  const after = projectedAccess(doc, pick, rule)
                  const outcome = outcomeFor(doc, after)
                  return (
                    <tr key={doc.id} aria-label={name}>
                      <td>
                        <strong>{name}</strong>
                        <div className="muted">
                          {fmtDate(doc.created_at, lang)}
                          {doc.uploaded_by_name && ` · ${doc.uploaded_by_name}`}
                        </div>
                        {/* Cómo lo leen hoy, en pequeño, para comparar. */}
                        <span className="doc-access-cell">
                          {accessParts(doc).driver.map((part) => (
                            <Badge key={part} tone="neutral" size="sm">
                              {part}
                            </Badge>
                          ))}
                        </span>
                      </td>
                      {mode === 'each'
                        ? switchCells(
                            pick,
                            (next) => setEachPick((current) => ({ ...current, [doc.id]: next })),
                            rule,
                            false,
                          )
                        : staticCells(after, pick)}
                      {requester && (
                        <td>
                          {!outcome.lists ? (
                            <Badge tone="danger" size="sm">
                              {bulk.summary.notListed}
                            </Badge>
                          ) : (
                            <span className="doc-access-cell">
                              <Badge tone={outcome.view.tone} size="sm">
                                {outcome.view.label}
                              </Badge>
                              <Badge tone={outcome.download.tone} size="sm">
                                {outcome.download.label}
                              </Badge>
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
          {saveError && (
            <div role="alert" className="form-error">
              {saveError}
            </div>
          )}
          <div className="owner-docs-step-foot">
            <Button type="button" variant="secondary" onClick={() => setStep('pick')}>
              <ArrowLeft size={14} aria-hidden /> {bulk.back}
            </Button>
            <Button type="submit" variant="primary" disabled={saving || chosen.length === 0}>
              {saving ? bulk.saving : bulk.save(chosen.length)}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
