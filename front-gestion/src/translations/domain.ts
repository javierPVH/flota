/**
 * **Las etiquetas del dominio, por código.**
 *
 * El back manda cada fila con la suya ya escrita (`type_display`,
 * `state_display`, `status_display`, `level_display`…), y son los `choices` de
 * sus enumerados: llegan **siempre en castellano**. Con la app en inglés, una
 * tabla de documentos decía «Seguro · Vigente» y el detalle de una incidencia,
 * «Avería · Abierta», dentro de una pantalla por lo demás traducida.
 *
 * Aquí están las mismas por su **código**, que es lo estable del contrato de la
 * API; lo que llega del back queda de reserva por si aparece un valor nuevo
 * (`src/domainLabels.ts`, que es quien las aplica).
 *
 * Va en un módulo propio y no en el diccionario del shell porque lo leen
 * páginas y paneles de varios chunks, y es lo bastante pequeño para viajar con
 * todos ellos. **`translations/vehicles.ts` toma de aquí sus estados**: dos
 * tablas del mismo enumerado acaban diciendo cosas distintas.
 *
 * Fuera quedan a propósito los `*_display` que NO son un enumerado sino un
 * dato —empresa, sede, CECO, marca, el nombre de quien se propone—: eso no se
 * traduce, se enseña.
 */
import { useAppLang } from '@flota/ui/i18n'

export const es = {
  vehicleState: {
    active: 'Activo',
    maintenance: 'No activo - Mantenimiento',
    itv: 'No activo - ITV',
    broken: 'No activo - Averiado',
    accidente: 'No activo - Accidentado',
    non_active: 'No activo sin justificación',
    retired: 'Devuelto (baja)',
  } as Record<string, string>,
  docType: {
    registration_certificate: 'Permiso de circulación',
    technical_datasheet: 'Ficha técnica',
    insurance: 'Seguro',
    contract: 'Contrato',
    delivery_report: 'Acta de entrega',
    return_report: 'Acta de devolución',
    accident_report: 'Parte de accidente',
    damage_photos: 'Fotos de daños',
    itv_report: 'Informe de ITV',
    workshop_invoice: 'Factura de taller',
    driving_license: 'Permiso de conducir',
    other: 'Otro',
  } as Record<string, string>,
  docStatus: {
    valid: 'Vigente',
    expired: 'Caducado',
    pending_archive: 'Pendiente de archivar',
  } as Record<string, string>,
  alertType: {
    itv_due: 'ITV programada',
    insurance_due: 'Seguro próximo / vencido',
    km_reading_pending: 'Lectura de km pendiente',
    km_overage: 'Exceso de km proyectado',
    no_driver: 'Vehículo sin conductor',
    maintenance_due: 'Mantenimiento programado',
  } as Record<string, string>,
  alertLevel: { info: 'Informativa', warning: 'Aviso', critical: 'Crítica' } as Record<
    string,
    string
  >,
  alertStatus: { open: 'Abierta', resolved: 'Resuelta' } as Record<string, string>,
  /**
   * La frase de un aviso. El back manda el código de la plantilla y sus
   * números (`alert_messages.py`), y se escribe aquí; los marcadores `{dato}`
   * los rellena `alertMessage` del DS, que es quien sabe juntar los dos tramos
   * del mantenimiento. Un código que no esté en esta tabla cae en la frase
   * castellana que manda el back.
   */
  alertMessage: {
    itv_overdue: 'ITV vencida hace {days} día(s) (venció el {due}).',
    itv_due: 'ITV en {days} día(s) (vence el {due}).',
    insurance_overdue: 'Seguro vencido hace {days} día(s) (venció el {due}).',
    insurance_due: 'Seguro en {days} día(s) (vence el {due}).',
    km_pending: 'Falta la lectura de km de {period}.',
    no_driver: 'Sin conductor asignado desde hace más de {days} día(s).',
    km_overage: 'Proyección {projected} km supera los {contracted} km contratados ({pct}%).',
    maintenance: '{plan}: {parts}.',
    maintenance_km_over: 'superado el objetivo de {target} km (odómetro: {current} km)',
    maintenance_km_near: 'quedan {remaining} km para el objetivo de {target} km',
    maintenance_date_overdue: 'vencido hace {days} día(s) (tocaba el {due})',
    maintenance_date_soon: 'toca en {days} día(s) (el {due})',
    maintenance_date_join: 'y, por fecha, {leg}',
    reminder_km_reading_pending: 'Recordatorio: lectura de km pendiente este mes.',
    reminder_itv_due: 'Recordatorio: ITV del vehículo.',
    reminder_maintenance_due: 'Recordatorio: mantenimiento programado.',
    reminder_due: 'Vencimiento: {due}.',
  } as Record<string, string>,
  incidentType: {
    breakdown: 'Avería',
    maintenance: 'Mantenimiento puntual',
    tires: 'Avería de neumáticos',
    inspection: 'ITV',
    accident: 'Accidente',
    general: 'Petición general',
  } as Record<string, string>,
  incidentStatus: {
    open: 'Abierta',
    on_going: 'En curso',
    closed: 'Cerrada',
  } as Record<string, string>,
  incidentPriority: {
    critical: 'Crítica',
    moderate: 'Moderada',
    functional: 'Funcional',
    informative: 'Informativa',
  } as Record<string, string>,
  eventType: {
    creation: 'Alta',
    activation: 'Activación',
    deactivation: 'Desactivación',
    invoice: 'Factura',
    immobilization: 'Inmovilización',
    reactivation: 'Reactivación',
    insurance_renewal: 'Renovación de seguro',
    penalty: 'Sanción',
    location_change: 'Cambio de ubicación',
    project_change: 'Cambio de proyecto',
    breakdown: 'Avería',
    km_reading: 'Lectura de km',
    contract_change: 'Cambio de contrato',
    fee_change: 'Cambio de cuota',
    ceco_change: 'Cambio de CECO',
    itv: 'ITV',
    maintenance: 'Mantenimiento',
    driver_change: 'Cambio de conductor',
    supervisor_change: 'Cambio de supervisor',
  } as Record<string, string>,
  /** En qué quedó cada petición. Una tabla por bandeja porque el MISMO código
   * dice cosas distintas: `done` es «Aplicada» en una ficha personal y
   * «Atendida» en una propuesta de conductor. */
  requestStatus: {
    profile: { pending: 'Pendiente', done: 'Aplicada', rejected: 'Rechazada' },
    document: {
      pending: 'Pendiente',
      deleted: 'Borrado (en erratas)',
      hidden: 'Oculto para el conductor',
      applied: 'Corrección aplicada',
      rejected: 'Rechazada',
    },
    vehicle: {
      pending: 'Pendiente de aprobación',
      approved: 'Aprobada',
      assigned: 'Vehículo asignado',
      rejected: 'Rechazada',
      closed: 'Cerrada',
    },
    driver: { pending: 'Pendiente', done: 'Atendida', rejected: 'Rechazada' },
  } as Record<string, Record<string, string>>,
  docRequestKind: { delete: 'Borrado', change: 'Corrección' } as Record<string, string>,
  /** Los campos que se piden corregir, como los nombra su formulario. */
  fieldNames: {
    first_name: 'Nombre',
    last_name: 'Apellidos',
    email: 'Correo',
    dni: 'DNI',
    phone: 'Teléfono',
    license_type: 'Tipo de permiso',
    fuel_card: 'Tarjeta de combustible',
    type: 'Tipo de documento',
    expiry_date: 'Fecha de caducidad',
    notes: 'Nota del documento',
  } as Record<string, string>,
  seat: { driver: 'Conductor', passenger: 'Pasajero' } as Record<string, string>,
  emailStatus: {
    sent: 'Enviado',
    failed: 'Fallido',
    skipped: 'Omitido (sin destinatario / deshabilitado)',
  } as Record<string, string>,
}

export const en: typeof es = {
  vehicleState: {
    active: 'Active',
    maintenance: 'Not active - Maintenance',
    itv: 'Not active - MOT',
    broken: 'Not active - Broken down',
    accidente: 'Not active - Crashed',
    non_active: 'Not active (no reason)',
    retired: 'Returned (retired)',
  },
  docType: {
    registration_certificate: 'Registration certificate',
    technical_datasheet: 'Technical datasheet',
    insurance: 'Insurance',
    contract: 'Contract',
    delivery_report: 'Delivery report',
    return_report: 'Return report',
    accident_report: 'Accident report',
    damage_photos: 'Damage photos',
    itv_report: 'MOT report',
    workshop_invoice: 'Workshop invoice',
    driving_license: 'Driving licence',
    other: 'Other',
  },
  docStatus: {
    valid: 'Valid',
    expired: 'Expired',
    pending_archive: 'Pending archiving',
  },
  alertType: {
    itv_due: 'Scheduled MOT',
    insurance_due: 'Insurance due / expired',
    km_reading_pending: 'Km reading pending',
    km_overage: 'Projected km overage',
    no_driver: 'Vehicle without a driver',
    maintenance_due: 'Scheduled maintenance',
  },
  alertLevel: { info: 'Informative', warning: 'Warning', critical: 'Critical' },
  alertStatus: { open: 'Open', resolved: 'Resolved' },
  alertMessage: {
    itv_overdue: 'MOT overdue by {days} day(s) (it expired on {due}).',
    itv_due: 'MOT in {days} day(s) (expires on {due}).',
    insurance_overdue: 'Insurance overdue by {days} day(s) (it expired on {due}).',
    insurance_due: 'Insurance in {days} day(s) (expires on {due}).',
    km_pending: 'The km reading for {period} is missing.',
    no_driver: 'No driver assigned for more than {days} day(s).',
    km_overage: 'Projected {projected} km exceeds the {contracted} km contracted ({pct}%).',
    maintenance: '{plan}: {parts}.',
    maintenance_km_over: 'target of {target} km passed (odometer: {current} km)',
    maintenance_km_near: '{remaining} km left to the {target} km target',
    maintenance_date_overdue: 'overdue by {days} day(s) (it was due on {due})',
    maintenance_date_soon: 'due in {days} day(s) (on {due})',
    maintenance_date_join: 'and, by date, {leg}',
    reminder_km_reading_pending: 'Reminder: km reading due this month.',
    reminder_itv_due: 'Reminder: vehicle MOT.',
    reminder_maintenance_due: 'Reminder: scheduled maintenance.',
    reminder_due: 'Due date: {due}.',
  },
  incidentType: {
    breakdown: 'Breakdown',
    maintenance: 'One-off maintenance',
    tires: 'Tyre failure',
    inspection: 'MOT',
    accident: 'Accident',
    general: 'General request',
  },
  incidentStatus: {
    open: 'Open',
    on_going: 'In progress',
    closed: 'Closed',
  },
  incidentPriority: {
    critical: 'Critical',
    moderate: 'Moderate',
    functional: 'Functional',
    informative: 'Informative',
  },
  eventType: {
    creation: 'Created',
    activation: 'Activation',
    deactivation: 'Deactivation',
    invoice: 'Invoice',
    immobilization: 'Immobilisation',
    reactivation: 'Reactivation',
    insurance_renewal: 'Insurance renewal',
    penalty: 'Penalty',
    location_change: 'Location change',
    project_change: 'Project change',
    breakdown: 'Breakdown',
    km_reading: 'Km reading',
    contract_change: 'Contract change',
    fee_change: 'Fee change',
    ceco_change: 'Cost centre change',
    itv: 'MOT',
    maintenance: 'Maintenance',
    driver_change: 'Driver change',
    supervisor_change: 'Supervisor change',
  },
  requestStatus: {
    profile: { pending: 'Pending', done: 'Applied', rejected: 'Rejected' },
    document: {
      pending: 'Pending',
      deleted: 'Deleted (in corrections)',
      hidden: 'Hidden from the driver',
      applied: 'Correction applied',
      rejected: 'Rejected',
    },
    vehicle: {
      pending: 'Pending approval',
      approved: 'Approved',
      assigned: 'Vehicle assigned',
      rejected: 'Rejected',
      closed: 'Closed',
    },
    driver: { pending: 'Pending', done: 'Handled', rejected: 'Rejected' },
  },
  docRequestKind: { delete: 'Deletion', change: 'Correction' },
  fieldNames: {
    first_name: 'First name',
    last_name: 'Surname',
    email: 'Email',
    dni: 'ID number',
    phone: 'Phone',
    license_type: 'Licence type',
    fuel_card: 'Fuel card',
    type: 'Document type',
    expiry_date: 'Expiry date',
    notes: 'Document note',
  },
  seat: { driver: 'Driver', passenger: 'Passenger' },
  emailStatus: {
    sent: 'Sent',
    failed: 'Failed',
    skipped: 'Skipped (no recipient / disabled)',
  },
}

const dict = { es, en }

/** Las tablas del dominio en el idioma activo. */
export function useDomainCopy() {
  return dict[useAppLang()]
}
