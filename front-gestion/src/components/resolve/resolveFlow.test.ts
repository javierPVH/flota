import { describe, expect, it } from 'vitest'

import type { Alert, Incident, Vehicle } from '../../types.ts'
import {
  FLOW_STATE,
  alertTarget,
  flowFor,
  incidentTarget,
  plateOf,
  vehicleStateOf,
} from './resolveFlow.ts'

const alert = (type: string, over: Partial<Alert> = {}) =>
  ({ id: 1, type, vehicle: 21, vehicle_plate: '1234KLM', ...over }) as unknown as Alert
const incident = (type: string, over: Partial<Incident> = {}) =>
  ({ id: 4, type, vehicle: 21, ...over }) as unknown as Incident
const VEHICLES = [{ id: 21, plate: '1234KLM', state: 'broken' }] as unknown as Vehicle[]

describe('flowFor — cada tipo abre su modal', () => {
  it('alertas', () => {
    expect(flowFor(alertTarget(alert('itv_due')))).toBe('itv')
    expect(flowFor(alertTarget(alert('insurance_due')))).toBe('insurance')
    expect(flowFor(alertTarget(alert('maintenance_due')))).toBe('maintenance')
    // Km pendiente, exceso y sin conductor van al genérico de alertas.
    expect(flowFor(alertTarget(alert('km_reading_pending')))).toBe('alert')
    expect(flowFor(alertTarget(alert('km_overage')))).toBe('alert')
    expect(flowFor(alertTarget(alert('no_driver')))).toBe('alert')
  })

  it('incidencias', () => {
    expect(flowFor(incidentTarget(incident('inspection')))).toBe('itv')
    expect(flowFor(incidentTarget(incident('maintenance')))).toBe('maintenance')
    expect(flowFor(incidentTarget(incident('tires')))).toBe('tires')
    expect(flowFor(incidentTarget(incident('accident')))).toBe('accident')
    expect(flowFor(incidentTarget(incident('breakdown')))).toBe('breakdown')
    // «General» (el tipo por defecto de la app de campo) cierra como una avería.
    expect(flowFor(incidentTarget(incident('general')))).toBe('breakdown')
  })
})

describe('contexto del vehículo', () => {
  it('la matrícula sale del objeto o, si no la trae, del índice', () => {
    expect(plateOf(alertTarget(alert('itv_due')), [])).toBe('1234KLM')
    expect(plateOf(incidentTarget(incident('breakdown')), VEHICLES)).toBe('1234KLM')
    expect(plateOf(incidentTarget(incident('breakdown')), [])).toBe('')
  })

  it('el estado sale del objeto o del índice', () => {
    expect(vehicleStateOf(incidentTarget(incident('breakdown')), VEHICLES)).toBe('broken')
    expect(
      vehicleStateOf(incidentTarget(incident('breakdown', { vehicle_state: 'itv' })), VEHICLES),
    ).toBe('itv')
    expect(vehicleStateOf(incidentTarget(incident('breakdown')), [])).toBeUndefined()
  })

  it('cada flujo «libera» su estado; neumáticos y alertas genéricas, ninguno', () => {
    expect(FLOW_STATE.breakdown).toBe('broken')
    expect(FLOW_STATE.accident).toBe('accidente')
    expect(FLOW_STATE.maintenance).toBe('maintenance')
    expect(FLOW_STATE.itv).toBe('itv')
    expect(FLOW_STATE.tires).toBeUndefined()
    expect(FLOW_STATE.alert).toBeUndefined()
  })
})
