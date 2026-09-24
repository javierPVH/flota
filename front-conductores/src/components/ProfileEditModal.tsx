import { useState, type FormEvent } from 'react'
import { CheckCircle2, Info } from 'lucide-react'
import { Button, Modal } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { requestProfileChange, type ProfileChanges } from '../api.ts'
import { useLang } from '../i18n.tsx'
import type { FlotaUser } from '../types.ts'
import {
  PersonalDocumentsPanel,
  usePersonalDocuments,
  type PersonalDocumentsState,
} from './PersonalDocuments.tsx'

/** Los tipos de permiso del back (`accounts.LicenseType`), en el orden en que
 * se ofrecen. Las **etiquetas** están en el diccionario: «B (turismos)» no se
 * lee igual en inglés, y escritas aquí salían en castellano. */
const LICENSE_TYPES = ['B', 'C1', 'C', 'C+E', 'D1', 'D'] as const

/** Los campos de texto de la ficha, en el orden en que se leen. */
const TEXT_FIELDS = ['first_name', 'last_name', 'email', 'dni', 'phone', 'license_type'] as const

/**
 * Los tres pasos, en el orden de las preguntas: **tus datos**, **tus
 * documentos** y **enviar**. Los documentos van ANTES del envío a propósito:
 * al llegar al botón ya se ha visto todo lo que se puede pedir desde aquí.
 */
const PROFILE_STEPS = ['data', 'docs', 'send'] as const
type ProfileStep = (typeof PROFILE_STEPS)[number]

/**
 * **Mis datos y mis documentos**: todo lo que se pide corregir de uno mismo, en
 * una ventana. «Mi perfil» es de lectura —nadie se edita su ficha, que es lo
 * que sostiene que el teléfono o el permiso de una flota sean un dato fiable—,
 * así que aquí **nada se guarda**: lo que sale son peticiones a la misma
 * bandeja de `/solicitudes` que el coche de sustitución, el borrado de un
 * documento y el cambio de conductor. Eso lo dice el **aviso de arriba**, que
 * no se va en ningún paso: es lo que enmarca la ventana entera.
 *
 * Va **por pasos, como subir un documento** (`UploadDocumentModal`): la misma
 * tira de `flow-steps`, el mismo pane que entra deslizándose y el mismo pie con
 * «Atrás / Siguiente», porque en un móvil una ventana con siete campos, una
 * lista de documentos y un botón de enviar se recorre a ciegas. Son dos cosas
 * distintas y salen por caminos distintos:
 *
 * 1. **tus datos**, los siete campos, que viajan enteros en UNA petición (solo
 *    lo que cambia);
 * 2. **tus documentos**, donde cada uno se corrige o se pide borrar por su
 *    cuenta — la misma lista y las mismas acciones que en la tarjeta de la
 *    pantalla, para que no haya dos maneras de hacer lo mismo—;
 * 3. **enviar**, que enseña lo que se va a pedir (campo a campo, de lo que hay
 *    a lo que se propone) y la nota para la gestión.
 *
 * La ventana **no se cierra al enviar**: enseña el acuse y ofrece volver a los
 * documentos, porque quien viene a corregir su ficha suele traer también algo
 * de ahí.
 */
export function ProfileEditModal({
  user,
  documents,
  onClose,
  onSent,
  onDocsChanged,
}: {
  user: FlotaUser
  /** La lista de documentos personales, ya cargada por la pantalla: así el
   * modal no vuelve a pedirla y las dos ven lo mismo. */
  documents: PersonalDocumentsState
  onClose: () => void
  /** Enviada la de la ficha: quien enmarca recarga lo que enseñe de ellas. */
  onSent: () => void
  /** Subido un documento en el paso 2: la pantalla de atrás cuenta los suyos
   * por su cuenta y tiene que enterarse. */
  onDocsChanged?: () => void
}) {
  const { t } = useLang()
  const copy = t.profile
  const edit = copy.edit

  const [values, setValues] = useState({
    first_name: user.first_name ?? '',
    last_name: user.last_name ?? '',
    email: user.email ?? '',
    dni: user.dni ?? '',
    phone: user.phone ?? '',
    license_type: user.license_type ?? '',
    fuel_card: user.fuel_card,
  })
  const [note, setNote] = useState('')
  const [step, setStep] = useState<ProfileStep>('data')
  const [cameBack, setCameBack] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Enviada: el acuse sustituye al paso, como en subir documento.
  const [done, setDone] = useState('')

  const set = (patch: Partial<typeof values>) => setValues((prev) => ({ ...prev, ...patch }))

  /** Solo lo que CAMBIA: pedir lo que ya está puesto no es pedir nada (y el
   * back lo descartaría igual). */
  function changes(): ProfileChanges {
    const out: ProfileChanges = {}
    if (values.fuel_card !== user.fuel_card) out.fuel_card = values.fuel_card
    TEXT_FIELDS.forEach((field) => {
      const valor = values[field].trim()
      if (valor !== ((user[field] as string | null) ?? '')) out[field] = valor
    })
    return out
  }

  const etiquetas: Record<string, string> = {
    first_name: edit.firstName,
    last_name: edit.lastName,
    email: copy.email,
    dni: copy.dni,
    phone: copy.phone,
    license_type: copy.licenseType,
    fuel_card: copy.fuelCard,
  }
  /** Un sí/no se lee; un booleano crudo, no. Y un campo vacío lo dice. */
  const legible = (valor: string | boolean | undefined): string =>
    typeof valor === 'boolean' ? (valor ? t.common.yes : t.common.no) : valor || copy.empty

  /** Lo que se va a pedir, campo a campo: de lo que hay a lo que se propone.
   * Enviar no puede ser un salto a ciegas («¿mandé el teléfono o no?»). */
  const resumen = Object.entries(changes()).map(([field, propuesto]) => ({
    field,
    label: etiquetas[field] ?? field,
    before: legible(
      field === 'fuel_card' ? user.fuel_card : ((user[field as keyof FlotaUser] as string) ?? ''),
    ),
    after: legible(propuesto),
  }))

  const current = PROFILE_STEPS.indexOf(step)
  const nextStep = PROFILE_STEPS[current + 1]
  const previousStep = PROFILE_STEPS[current - 1]
  const stepLabels: Record<ProfileStep, string> = {
    data: edit.stepData,
    docs: edit.stepDocs,
    send: edit.stepSend,
  }

  function goTo(next: ProfileStep) {
    setCameBack(PROFILE_STEPS.indexOf(next) < current)
    setStep(next)
    setError('')
  }

  /** Intro: antes del último paso avanza, no envía. */
  function onFormSubmit(event: FormEvent) {
    event.preventDefault()
    if (nextStep !== undefined) {
      goTo(nextStep)
      return
    }
    void submit(event)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const pedido = changes()
    if (Object.keys(pedido).length === 0 && !note.trim()) {
      setError(edit.nothing)
      return
    }
    setSaving(true)
    setError('')
    try {
      await requestProfileChange({ changes: pedido, note: note.trim() })
      setDone(edit.ok)
      setNote('')
      onSent()
    } catch (caught) {
      setError(asErrorMessage(caught, edit.error))
    } finally {
      setSaving(false)
    }
  }

  return (
    // Modal a secas y no `SupervisorModal`: su aviso dice que lo que se
    // registre queda a nombre de quien supervisa, y aquí se habla de la ficha
    // de uno mismo, nunca en nombre de otra persona.
    <Modal
      open
      wide
      title={edit.title}
      onClose={onClose}
      footer={
        done ? (
          <>
            {/* Enviada la ficha, lo que queda por hacer aquí son los
                documentos: se ofrece volver a ellos, no solo cerrar. */}
            <Button type="button" variant="secondary" onClick={() => { setDone(''); goTo('docs') }}>
              {edit.backToDocs}
            </Button>
            <Button type="button" onClick={onClose}>
              {t.carUpdate.close}
            </Button>
          </>
        ) : (
          <>
            {previousStep === undefined ? (
              <Button type="button" variant="secondary" onClick={onClose}>
                {t.common.cancel}
              </Button>
            ) : (
              <Button type="button" onClick={() => goTo(previousStep)}>
                {t.breakdown.back}
              </Button>
            )}
            {nextStep === undefined ? (
              <Button type="button" disabled={saving} onClick={(event) => void submit(event)}>
                {saving ? edit.submitting : edit.submit}
              </Button>
            ) : (
              <Button type="button" onClick={() => goTo(nextStep)}>
                {t.breakdown.next}
              </Button>
            )}
          </>
        )
      }
    >
      {done ? (
        <div className="km-saved">
          <CheckCircle2 size={52} aria-hidden className="km-saved-icon" />
          <h2>{edit.savedTitle}</h2>
          <p className="km-saved-detail" role="status">
            {done}
          </p>
        </div>
      ) : (
        <div className="profile-edit">
          {/* Lo primero de todo y en todos los pasos: qué es esta ventana.
              Nada de lo que se toque aquí cambia la ficha por sí solo. */}
          <div className="profile-edit-intro">
            <Info size={20} aria-hidden />
            <div>
              <strong>{edit.introTitle}</strong>
              <p>{edit.intro}</p>
            </div>
          </div>

          <div className="flow-steps" aria-hidden>
            {PROFILE_STEPS.map((key, index) => (
              <span
                key={key}
                className={`flow-step${
                  index === current ? ' is-current' : index < current ? ' is-done' : ''
                }`}
              >
                {stepLabels[key]}
              </span>
            ))}
          </div>

          <div key={step} className={`step-pane${cameBack ? ' from-left' : ''}`}>
            {step === 'data' && (
              <form className="update-action-form" onSubmit={onFormSubmit}>
                <h3 className="profile-edit-step">{edit.dataTitle}</h3>
                <p className="update-hint">{edit.dataHint}</p>
                {/* Siete campos apilados no caben en una pantalla de móvil y
                    el paso se recorría a ciegas: van en rejilla —dos columnas
                    en cuanto hay sitio—, con la etiqueta pequeña encima y la
                    pista de cada uno pegada a su campo, no suelta entre dos. */}
                <div className="profile-fields">
                  <div className="profile-field">
                    <label className="reminder-check">
                      {edit.firstName}
                      <input
                        type="text"
                        className="update-input"
                        value={values.first_name}
                        onChange={(event) => set({ first_name: event.target.value })}
                      />
                    </label>
                  </div>
                  <div className="profile-field">
                    <label className="reminder-check">
                      {edit.lastName}
                      <input
                        type="text"
                        className="update-input"
                        value={values.last_name}
                        onChange={(event) => set({ last_name: event.target.value })}
                      />
                    </label>
                  </div>
                  <div className="profile-field">
                    <label className="reminder-check">
                      {copy.email}
                      <input
                        type="email"
                        inputMode="email"
                        className="update-input"
                        value={values.email}
                        onChange={(event) => set({ email: event.target.value })}
                      />
                    </label>
                    <p className="update-hint">{edit.emailHint}</p>
                  </div>
                  <div className="profile-field">
                    <label className="reminder-check">
                      {copy.dni}
                      <input
                        type="text"
                        className="update-input"
                        value={values.dni}
                        onChange={(event) => set({ dni: event.target.value })}
                      />
                    </label>
                    <p className="update-hint">{edit.dniHint}</p>
                  </div>
                  <div className="profile-field">
                    <label className="reminder-check">
                      {copy.phone}
                      <input
                        type="tel"
                        inputMode="tel"
                        className="update-input"
                        value={values.phone}
                        onChange={(event) => set({ phone: event.target.value })}
                      />
                    </label>
                  </div>
                  <div className="profile-field">
                    <label className="reminder-check">
                      {copy.licenseType}
                      <select
                        className="update-input"
                        value={values.license_type}
                        onChange={(event) => set({ license_type: event.target.value })}
                      >
                        {/* Vacío = SIN permiso en la ficha. Elegirlo teniendo
                            uno pide borrarlo, y gestión lo lee como «B → —». */}
                        <option value="">{edit.licenseNone}</option>
                        {LICENSE_TYPES.map((value) => (
                          <option key={value} value={value}>
                            {edit.licenseTypes[value] ?? value}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="profile-field profile-field-full">
                    <label className="resolve-workshop">
                      <input
                        type="checkbox"
                        checked={values.fuel_card}
                        onChange={(event) => set({ fuel_card: event.target.checked })}
                      />
                      {copy.fuelCard}
                    </label>
                  </div>
                </div>
              </form>
            )}

            {step === 'docs' && (
              <>
                <h3 className="profile-edit-step">{edit.docsTitle}</h3>
                <p className="update-hint">{edit.docsHint}</p>
                {/* El panel viene con SU formulario (subir), así que este paso
                    no va dentro de ninguno: los documentos no se mandan con el
                    botón del pie, se piden uno a uno desde su fila. */}
                <PersonalDocumentsPanel {...documents} hideHint onChanged={onDocsChanged} />
              </>
            )}

            {step === 'send' && (
              <form className="update-action-form" onSubmit={onFormSubmit}>
                <h3 className="profile-edit-step">{edit.reviewTitle}</h3>
                {resumen.length > 0 ? (
                  <ul className="profile-review">
                    {resumen.map((row) => (
                      <li key={row.field}>
                        <span className="profile-review-label">{row.label}</span>
                        <span className="profile-review-values">
                          <s>{row.before}</s> → <strong>{row.after}</strong>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="update-hint">{edit.reviewEmpty}</p>
                )}
                <label className="reminder-check">
                  {edit.note}
                  <textarea
                    className="reminder-message"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
                <p className="update-hint">{edit.noteHint}</p>
                <p className="update-hint">{edit.submitHint}</p>
              </form>
            )}

            {error && (
              <div role="alert" className="form-error">
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

/**
 * El mismo modal, cargando él los documentos. Lo monta el **nav inferior** del
 * perfil, que vive fuera del `Outlet` y no tiene esa lista a mano; y como solo
 * existe mientras está abierto, la petición sale al abrirlo y no en cada
 * pantalla de la app.
 */
export function ProfileEditSheet({
  user,
  onClose,
  onSent,
}: {
  user: FlotaUser
  onClose: () => void
  onSent: () => void
}) {
  const documents = usePersonalDocuments()
  // El mismo contador del shell para las dos cosas que se hacen aquí: pedir
  // la corrección de la ficha y subir un documento.
  return (
    <ProfileEditModal
      user={user}
      documents={documents}
      onClose={onClose}
      onSent={onSent}
      onDocsChanged={onSent}
    />
  )
}
