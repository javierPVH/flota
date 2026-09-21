import { useResolveCopy } from '../translations/resolve.ts'
import type { Incident } from '../types.ts'
import { ResolveAccidentForm } from './resolve/ResolveAccidentForm.tsx'
import { ResolveBreakdownForm } from './resolve/ResolveBreakdownForm.tsx'
import { ResolveTiresForm } from './resolve/ResolveTiresForm.tsx'
import { flowFor } from './resolve/resolveFlow.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

/**
 * **Solucionar una incidencia es UN gesto y el formulario lo decide su TIPO**,
 * igual que en gestión (`components/resolve/ResolveDispatcher`): un parte de
 * neumáticos se cierra diciendo qué se montó, un accidente con su expediente y
 * quién asume el coste, y una avería o una petición general con lo que se hizo.
 *
 * Antes esta app cerraba **los cuatro tipos con el mismo cajón** —fecha y
 * observaciones—, así que lo que en el escritorio era un dato estructurado
 * (las ruedas, la medida, el expediente, la responsabilidad) se perdía o
 * acababa escrito a mano dentro de un texto libre. Ahora el reparto es el
 * mismo a los dos lados y lo dice un solo sitio (`resolve/resolveFlow.ts`).
 *
 * Lo común vive una vez (`useResolutionCommon` + `ResolutionCommonFields`), y
 * lo que en campo NO se decide no se pregunta: ni el taller del catálogo (aquí
 * se sabe el CP) ni la vuelta a Activo, que es de administración.
 *
 * El despachador pone la ventana y el título; los formularios son el cuerpo.
 */
export function IncidentResolveModal({
  incident,
  plate = '',
  vehicleKm = null,
  onClose,
  onResolved,
}: {
  incident: Incident
  /** Matrícula para el título, si quien abre la conoce: la incidencia solo
   * trae el id del coche. */
  plate?: string
  /** Última lectura del coche, si quien abre la tiene a mano (el resumen del
   * vehículo): es lo que carga el botón del kilometraje. */
  vehicleKm?: number | null
  onClose: () => void
  /** Cerrada: la página avisa, recarga sus datos y cierra este modal. El aviso
   * opcional dice qué pasó con la factura (se encoló, o no subió). */
  onResolved: (notice?: string) => void
}) {
  const t = useResolveCopy()
  const flow = flowFor(incident)
  // El mantenimiento puntual comparte formulario con la avería —no hay nada
  // más que preguntar—, pero no comparte título: dice lo que se cierra.
  const titulo = t.titleOf[flow]

  return (
    <SupervisorModal
      open
      title={t.title(titulo, plate)}
      onClose={onClose}
    >
      {flow === 'tires' ? (
        <ResolveTiresForm
          incident={incident}
          vehicleKm={vehicleKm}
          onClose={onClose}
          onResolved={onResolved}
        />
      ) : flow === 'accident' ? (
        <ResolveAccidentForm
          incident={incident}
          vehicleKm={vehicleKm}
          onClose={onClose}
          onResolved={onResolved}
        />
      ) : (
        // Avería, mantenimiento puntual y petición general: el mismo
        // formulario, y él reparte lo que pregunta cada uno.
        <ResolveBreakdownForm
          incident={incident}
          vehicleKm={vehicleKm}
          onClose={onClose}
          onResolved={onResolved}
        />
      )}
    </SupervisorModal>
  )
}
