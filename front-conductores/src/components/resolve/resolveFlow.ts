/**
 * Qué formulario cierra cada incidencia, según su TIPO. Lógica pura, sin JSX,
 * como el reparto de gestión (`front-gestion/src/components/resolve/
 * resolveFlow.ts`) — y con los mismos nombres de flujo, porque es el mismo
 * reparto: lo que en el escritorio se cierra con el formulario de neumáticos
 * no puede cerrarse en el móvil con un cajón de observaciones.
 *
 * Aquí solo están los cuatro tipos que la app de campo deja abrir y resolver
 * (`format.isOpenFieldIncident`). La ITV y el mantenimiento programado son
 * ALERTAS y se cierran haciendo lo suyo, y el seguro es de administración.
 */

import type { Incident } from '../../types.ts'

export type ResolveFlow = 'breakdown' | 'tires' | 'accident' | 'maintenance' | 'general'

export function flowFor(incident: Incident): ResolveFlow {
  switch (incident.type) {
    case 'tires':
      return 'tires'
    case 'accident':
      return 'accident'
    case 'maintenance':
      return 'maintenance'
    case 'general':
      // Comparte formulario con la avería, pero no lo que pregunta: una
      // petición general puede no ir del coche, así que lo del taller solo se
      // pide si lo hubo. Es un flujo propio porque también se llama distinto.
      return 'general'
    default:
      return 'breakdown'
  }
}
