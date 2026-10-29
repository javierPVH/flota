import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  listAll,
  listDocumentTypeAccess,
  listDocuments,
  listUsers,
  listVehicles,
  type DocumentTypeAccess,
} from '../api.ts'
import { ALL_DOCUMENT_TYPES } from '../documentRules.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { useDocumentsCopy } from '../translations/documents.ts'
import { DocumentAccessSettings } from '../components/DocumentAccessSettings.tsx'
import { DocumentsReport } from '../components/DocumentsReport.tsx'
import { SettingsSubtabs, type SettingsSubtabItem } from '../components/SettingsSubtabs.tsx'
import type { FlotaDocument, Vehicle } from '../types.ts'

/** Parámetros de la URL: la pestaña (`?tab=ajustes`) y el tipo elegido en
 * el listado (`/documentos?tipo=insurance`). */
const TAB_PARAM = 'tab'
const TYPE_PARAM = 'tipo'

const MAIN_TABS = ['ajustes', 'documentos'] as const
type MainTab = (typeof MAIN_TABS)[number]

/**
 * Documentos (`/documentos`), en dos pestañas, en este orden:
 *
 * - **Ajustes** (la de salida): quién lee cada TIPO de documento
 *   (`DocumentTypeAccess`): la administración siempre, la supervisión sí o
 *   no y, para el conductor, solo lo que subió él o también lo de los demás.
 *   La misma regla se lee en el listado, en su columna «Acceso».
 * - **Documentos** (`?tab=documentos`, o directamente `?tipo=<tipo>`): todos
 *   los documentos de la flota y de las personas en un único listado, con el
 *   tipo como sub-pestaña —«Todos» y uno por tipo, cada uno con su
 *   recuento— sobre una sola carga.
 *
 * Era una pestaña de Informes, al lado de Descargas y Facturas, y no es un
 * informe: es donde se consultan y se dan de alta los documentos, así que
 * tiene su página, su entrada en el menú y su atajo («g d»). Los enlaces
 * antiguos (`/informes?tab=documentos` y `?tab=<tipo>`) llegan aquí
 * redirigidos desde Informes.
 */
export function DocumentsPage() {
  const t = useDocumentsCopy()
  const docCopy = usePanelsCopy().documents
  const [searchParams, setSearchParams] = useSearchParams()

  // La pestaña y el tipo viven en la URL: un enlace a «los seguros» o a los
  // ajustes se puede compartir, y volver atrás devuelve lo que se miraba.
  const requestedTab = searchParams.get(TAB_PARAM) ?? ''
  const requested = searchParams.get(TYPE_PARAM) ?? ''
  const docType = (ALL_DOCUMENT_TYPES as readonly string[]).includes(requested) ? requested : ''
  // Un tipo en la URL es ya el listado (así llegan los enlaces de Informes).
  const tab: MainTab = (MAIN_TABS as readonly string[]).includes(requestedTab)
    ? (requestedTab as MainTab)
    : docType
      ? 'documentos'
      : 'ajustes'
  const setTab = (next: MainTab) =>
    setSearchParams(next === 'ajustes' ? {} : { [TAB_PARAM]: next }, { replace: true })
  const setDocType = (type: string) =>
    setSearchParams(type ? { [TYPE_PARAM]: type } : { [TAB_PARAM]: 'documentos' }, { replace: true })

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [docs, setDocs] = useState<FlotaDocument[]>([])
  const [docsLoaded, setDocsLoaded] = useState(false)
  const [docsError, setDocsError] = useState('')

  // Vehículos: matrícula por id para la columna «Titular» y filtro por vehículo.
  useEffect(() => {
    listAll(listVehicles({ include_baja: 1 }))
      .then(setVehicles)
      .catch(() => {})
  }, [])

  // Usuarios: filtro por titular persona y alta de documento personal.
  const [users, setUsers] = useState<Array<{ id: number; label: string }>>([])
  useEffect(() => {
    listAll(listUsers())
      .then((rows) => setUsers(rows.map((u) => ({ id: u.id, label: u.name || u.username }))))
      .catch(() => setUsers([]))
  }, [])

  // Documentos: una sola petición para TODOS los tipos. Cambiar de tipo es
  // un filtro en cliente —instantáneo— y permite enseñar el recuento real en
  // cada sub-pestaña. Tras un alta se vuelve a pedir (`docsLoaded` a false).
  useEffect(() => {
    if (docsLoaded) return
    let alive = true
    listAll(listDocuments({}))
      .then((rows) => {
        if (!alive) return
        setDocs(rows)
        setDocsError('')
        setDocsLoaded(true)
      })
      .catch((err) => {
        if (alive) setDocsError(asErrorMessage(err, t.loadError))
      })
    return () => {
      alive = false
    }
  }, [docsLoaded, t.loadError])

  // Quién lee cada tipo: lo pinta la columna «Acceso» del listado y lo edita
  // la pestaña de ajustes, así que se carga una vez para las dos y se
  // recarga al guardar.
  const [rules, setRules] = useState<DocumentTypeAccess[]>([])
  const [rulesLoaded, setRulesLoaded] = useState(false)
  const [rulesError, setRulesError] = useState('')
  const loadRules = useCallback(() => {
    let alive = true
    listDocumentTypeAccess()
      .then((rows) => {
        if (!alive) return
        setRules(rows)
        setRulesError('')
        setRulesLoaded(true)
      })
      .catch((err) => {
        if (alive) setRulesError(asErrorMessage(err, t.settings.loadError))
      })
    return () => {
      alive = false
    }
  }, [t.settings.loadError])
  useEffect(() => loadRules(), [loadRules])

  // «Cargando» se deduce del propio estado en vez de guardarse aparte: así el
  // efecto no llama a setState en el render que lo dispara.
  const docsLoading = !docsLoaded && !docsError

  const plateById = useMemo(() => new Map(vehicles.map((v) => [v.id, v.plate])), [vehicles])
  const accessByType = useMemo(() => new Map(rules.map((r) => [r.type, r])), [rules])

  const countByType = useMemo(() => {
    const counts = new Map<string, number>()
    for (const doc of docs) counts.set(doc.type, (counts.get(doc.type) ?? 0) + 1)
    return counts
  }, [docs])

  const docItems: SettingsSubtabItem[] = [
    { key: '', label: t.allTypes, badge: docs.length },
    ...ALL_DOCUMENT_TYPES.map((dt) => ({
      key: dt,
      label: docCopy.typeOptions[dt],
      badge: countByType.get(dt) ?? 0,
    })),
  ]

  const tabs: Array<{ key: MainTab; label: string }> = [
    { key: 'ajustes', label: t.tabs.settings },
    { key: 'documentos', label: t.tabs.documents },
  ]

  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />

      {/* Pestañas principales (mismo patrón que Ajustes/Informes). */}
      <div className="veh-tabs settings-tabs" role="tablist" aria-label={t.title}>
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`veh-tab${tab === item.key ? ' is-active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="settings-body">
        {tab === 'documentos' && (
          <>
            <p className="reports-hint">{t.hint}</p>
            <SettingsSubtabs
              items={docItems}
              active={docType}
              onChange={setDocType}
              ariaLabel={t.typeTabs}
            />
            <DocumentsReport
              type={docType}
              docs={docs}
              loading={docsLoading}
              error={docsError}
              vehicleLabel={t.vehicleColumn}
              plateById={plateById}
              vehicles={vehicles}
              users={users}
              accessByType={accessByType}
              onCreated={() => setDocsLoaded(false)}
            />
          </>
        )}
        {tab === 'ajustes' && (
          <DocumentAccessSettings
            rules={rules}
            loading={!rulesLoaded && !rulesError}
            error={rulesError}
            onSaved={loadRules}
          />
        )}
      </div>
    </div>
  )
}
