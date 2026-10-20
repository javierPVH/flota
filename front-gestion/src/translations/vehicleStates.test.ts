import { describe, expect, it } from 'vitest'

import { en as domainEn, es as domainEs } from './domain.ts'
import { en as detalleEn, es as detalleEs } from './vehicleDetail.ts'
import { en as vehiculosEn, es as vehiculosEs } from './vehicles.ts'

/**
 * Los NUEVE estados del vehículo y, sobre todo, cuáles se ofrecen para
 * elegir.
 *
 * La deriva que esto evita es la de siempre: se añade un estado al enumerado
 * del back y se queda sin etiqueta en una de las cuatro tablas de copia, así
 * que la chapa cae al `state_display` castellano del back y con la app en
 * inglés se lee mezclado. Y al revés: una SALIDA de la flota colada en un
 * desplegable deja ponerla a mano, saltándose el flujo que cierra el
 * contrato, las asignaciones y las alertas.
 */
const TODOS = [
  'active',
  'maintenance',
  'itv',
  'broken',
  'accidente',
  'non_active',
  'pending_return',
  'returned',
  'retired',
] as const

/** Las dos salidas de la flota: tienen su flujo y NO se eligen a mano. */
const SALIDAS = ['returned', 'retired']

describe('Estados del vehículo: copia y desplegables', () => {
  const tablas = {
    'domain.es': domainEs.vehicleState,
    'domain.en': domainEn.vehicleState,
    'vehicleDetail.es': detalleEs.stateLabel,
    'vehicleDetail.en': detalleEn.stateLabel,
  }

  for (const [nombre, tabla] of Object.entries(tablas)) {
    it(`${nombre} nombra los nueve estados`, () => {
      for (const estado of TODOS) {
        expect(tabla[estado], `falta «${estado}» en ${nombre}`).toBeTruthy()
      }
    })
  }

  it('«Devuelto» y «Baja» son cosas distintas, y en los dos idiomas', () => {
    // Antes `retired` era «Devuelto (baja)» y significaba las dos; si alguien
    // vuelve a juntarlas, esto lo dice.
    expect(domainEs.vehicleState.returned).toBe('Devuelto')
    expect(domainEs.vehicleState.retired).toBe('Baja')
    expect(domainEs.vehicleState.returned).not.toBe(domainEs.vehicleState.retired)
    expect(domainEn.vehicleState.returned).not.toBe(domainEn.vehicleState.retired)
  })

  const listas = {
    'vehicles.es': vehiculosEs.stateOptions,
    'vehicles.en': vehiculosEn.stateOptions,
    'vehicleDetail.es': detalleEs.stateOptions,
    'vehicleDetail.en': detalleEn.stateOptions,
  }

  for (const [nombre, opciones] of Object.entries(listas)) {
    it(`${nombre} ofrece «pendiente de devolución» y NINGUNA de las dos salidas`, () => {
      const valores = opciones.map((o) => o.value)
      // Se elige a mano porque es una decisión, no la consecuencia de nada.
      expect(valores).toContain('pending_return')
      // Devolver y dar de baja van por su flujo («Devolver» / «Dar de baja»).
      for (const salida of SALIDAS) {
        expect(valores, `«${salida}» no se elige a mano en ${nombre}`).not.toContain(salida)
      }
    })

    it(`${nombre} no ofrece nada que no sea un estado real`, () => {
      for (const { value } of opciones) {
        expect(TODOS, `«${value}» no está en el enumerado`).toContain(value)
      }
    })
  }
})
