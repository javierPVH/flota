import type { Incident } from '../../types.ts'

/** Lo que recibe cada formulario de cierre. El marco (la ventana y su título)
 * lo pone el despachador: los formularios solo son el cuerpo. */
export interface ResolveFormProps {
  incident: Incident
  /** Última lectura conocida del coche: la que carga el botón de «Kilometraje».
   * `null`/ausente = no se sabe, y entonces no hay botón que ofrecer. */
  vehicleKm?: number | null
  onClose: () => void
  /** Cerrada. El aviso extra (la factura se encoló, o no subió) viaja con la
   * llamada: quien abrió el modal lo enseña junto a su «X resuelta». */
  onResolved: (notice?: string) => void
}
