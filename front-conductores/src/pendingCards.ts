/** Las tres tarjetas de lo que un vehículo tiene abierto, en el orden en que
 * se leen: **alertas**, **incidencias** y **accidentes**.
 *
 * Son los ids del acordeón (`useAccordion`), así que viven fuera del componente
 * que las pinta (`VehiclePendingCards`): las dos pantallas que lo montan —el
 * tablero y la ficha de campo— tienen que decir las mismas, y las tres arrancan
 * **plegadas** (el recuento va en el título: se ve sin abrir nada).
 */
export const PENDING_CARDS = ['alerts', 'incidents', 'accidents'] as const

export type PendingCard = (typeof PENDING_CARDS)[number]
