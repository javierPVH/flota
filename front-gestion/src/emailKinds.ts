/**
 * Con qué plantilla de correo se abre un aviso.
 *
 * El asunto y el cuerpo los compone el back con la plantilla de correo (10b,
 * `fleet/services/mailer.py`); aquí solo vive la correspondencia entre lo que se
 * está mirando —una alerta, una incidencia— y la plantilla con la que arranca el
 * modal de correo. Está fuera de `VehicleEmailModal.tsx` para que lo importe
 * cualquier página sin arrastrar el componente al grafo eager.
 */

import type { AlertType } from './types.ts'

export type EmailKind = 'state_notice' | 'itv_due' | 'insurance_due' | 'km_reading_pending'

/** Tipo de alerta → tipo de correo. Los tres avisos que ya tienen plantilla
 * propia abren directos en ella; el resto (exceso de km, mantenimiento, sin
 * conductor) cae en el comunicado de estado. */
export const ALERT_EMAIL_KIND: Record<AlertType, EmailKind> = {
  itv_due: 'itv_due',
  insurance_due: 'insurance_due',
  km_reading_pending: 'km_reading_pending',
  km_overage: 'state_notice',
  maintenance_due: 'state_notice',
  no_driver: 'state_notice',
}

/** Una incidencia no tiene plantilla propia: se avisa con el comunicado de
 * estado, que es el que habla del coche y de por qué está como está. */
export const INCIDENT_EMAIL_KIND: EmailKind = 'state_notice'
