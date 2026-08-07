/** Catálogo de campos importables por entidad (IMPORTACION_MASIVA.md §8).
 * El ORDEN es el de pintado en el paso de mapeo (obligatorios primero). */

import type { ImportEntity } from '../../api.ts'
import type { ImportField } from './types.ts'

export const VEHICLE_IMPORT_FIELDS: ImportField[] = [
  { key: 'plate', required: true },
  { key: 'brand' },
  { key: 'model' },
  { key: 'year' },
  { key: 'vin' },
  { key: 'state' },
  { key: 'business_use' },
  { key: 'project' },
  { key: 'company' },
  { key: 'cost_center' },
  { key: 'fuel' },
  { key: 'type' },
  { key: 'size' },
  { key: 'veh_use' },
  { key: 'market_segment' },
  { key: 'property' },
  { key: 'unlimited_km' },
  { key: 'insurance_expiry_date' },
  { key: 'registration_date' },
  { key: 'km_start' },
  { key: 'is_substitute' },
  { key: 'supervisor' },
  { key: 'driver' },
]

export const USER_IMPORT_FIELDS: ImportField[] = [
  { key: 'email', required: true },
  { key: 'first_name', required: true },
  { key: 'last_name', required: true },
  { key: 'username' },
  { key: 'dni' },
  { key: 'phone' },
  { key: 'license_type' },
  { key: 'fuel_card' },
  { key: 'roles' },
]

export const IMPORT_FIELDS: Record<ImportEntity, ImportField[]> = {
  vehicles: VEHICLE_IMPORT_FIELDS,
  users: USER_IMPORT_FIELDS,
}
