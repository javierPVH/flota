import { describe, expect, it } from 'vitest'

import { documentExpires, incidentTypeRequiredBy, linkableIncidents } from './documentRules.ts'
import type { Incident } from './types.ts'

const incident = (id: number, type: Incident['type'], status: Incident['status']) =>
  ({ id, type, status }) as Incident

describe('documentRules', () => {
  it('solo caducan póliza, contrato, informe de ITV y permiso de conducir', () => {
    expect(['insurance', 'contract', 'itv_report', 'driving_license'].every(documentExpires)).toBe(true)
    expect(
      ['technical_datasheet', 'registration_certificate', 'delivery_report', 'damage_photos', 'other'].some(
        documentExpires,
      ),
    ).toBe(false)
  })

  it('el parte de accidente va ligado a un accidente; el resto a lo que sea', () => {
    expect(incidentTypeRequiredBy('accident_report')).toBe('accident')
    expect(incidentTypeRequiredBy('damage_photos')).toBeNull()
    expect(incidentTypeRequiredBy('insurance')).toBeNull()
  })

  it('ofrece solo incidencias sin cerrar y, para el parte, solo accidentes', () => {
    const rows = [
      incident(1, 'breakdown', 'open'),
      incident(2, 'accident', 'on_going'),
      incident(3, 'accident', 'closed'),
      incident(4, 'tires', 'closed'),
    ]
    expect(linkableIncidents(rows, 'damage_photos').map((i) => i.id)).toEqual([1, 2])
    expect(linkableIncidents(rows, 'accident_report').map((i) => i.id)).toEqual([2])
  })
})
