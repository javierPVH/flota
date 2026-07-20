export type Role = 'admin' | 'admin_flota' | 'conductor'

export interface FlotaUser {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
  role: Role
  is_staff: boolean
  is_superuser: boolean
}

export interface Driver {
  id: number
  username: string
  name: string
}

export type VehicleStatus = 'active' | 'maintenance' | 'retired'

export interface Vehicle {
  id: number
  plate: string
  brand: string
  model: string
  year: number | null
  status: VehicleStatus
  status_display: string
  assigned_driver: number | null
  assigned_driver_name: string
  notes: string
  created_at: string
  updated_at: string
}

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}
