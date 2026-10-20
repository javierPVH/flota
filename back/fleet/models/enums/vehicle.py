"""Enumerados del vehículo (DBML `*_enum`).

Valores ASCII estables (persisten en BD) con etiquetas legibles en español. No
cambies los valores sin una migración de datos.
"""

from django.db import models


class VehicleState(models.TextChoices):
    """Estado técnico del vehículo: **nueve** valores en tres familias.

    O el coche **rueda** (`active`), o está **parado** y entonces la etiqueta
    dice POR QUÉ —«- Mantenimiento», «- ITV», «- Averiado», «- Accidentado»,
    «- Pendiente de devolución», o «sin justificación» cuando no hay una causa
    con estado propio (una petición general, o una parada decidida a mano)—, o
    ya **no es de la flota** (`returned` / `retired`, ver `OUT_OF_FLEET`).

    Los parados los escribe el ciclo de incidencias (`services/incidents.py`),
    la ITV (`services/itv.py`), el mantenimiento y el parte de accidente;
    `pending_return` se elige a mano, que es lo que lo distingue: no lo provoca
    una avería sino una decisión.

    **Devolver y dar de baja no son lo mismo, aunque las dos saquen el coche de
    la flota.** `returned` es el final del renting (lo escribe el flujo de
    `services/returns.py::return_vehicle`, que cierra el contrato y calcula el
    exceso de km) y `retired` es cualquier otra salida —siniestro total, venta,
    error de alta— (lo escribe `retire_vehicle`, o sea el `DELETE`). Antes eran
    un único valor, «Devuelto (baja)», y el histórico no podía distinguirlas.
    Ninguno de los dos se elige de un desplegable: tienen su propio flujo.

    Las etiquetas son solo presentación; los valores persisten en BD y no se
    cambian sin migración de datos.
    """

    ACTIVE = "active", "Activo"
    MAINTENANCE = "maintenance", "No activo - Mantenimiento"
    ITV = "itv", "No activo - ITV"
    BROKEN = "broken", "No activo - Averiado"
    ACCIDENT = "accidente", "No activo - Accidentado"
    # «Sin justificación»: parado sin una causa con estado propio. El nombre
    # lo pide el filtro de campo, donde «No activos» es el corte que los
    # agrupa a TODOS y hacía falta distinguir este de aquel.
    NON_ACTIVE = "non_active", "No activo sin justificación"
    # El coche ya no se usa pero TODAVÍA NO se ha entregado. Sigue siendo de la
    # flota —cuenta en listados, métricas e informes, y sigue venciendo su ITV—:
    # es justo lo que lo separa de los dos de abajo.
    PENDING_RETURN = "pending_return", "No activo - Pendiente de devolución"
    RETURNED = "returned", "Devuelto"
    BAJA = "retired", "Baja"


#: Los dos finales de trayecto: el coche ya no es de la flota.
#:
#: Es un CONJUNTO y no un valor a propósito. Media docena de querysets excluyen
#: «lo que ya no está» (listado, métricas, informes, alertas) y otras tantas
#: guardas rechazan operar sobre ello; con un solo valor cada uno lo escribía a
#: mano, y al partir la baja en dos habrían quedado la mitad mirando solo una de
#: las dos salidas. `pending_return` NO está aquí: ese coche sigue en la flota.
OUT_OF_FLEET = (VehicleState.RETURNED, VehicleState.BAJA)


class VehicleType(models.TextChoices):
    """DBML `type_enum`."""

    TURISMO = "car", "Turismo"
    FURGONETA = "van", "Furgoneta"
    CAMION = "truck", "Camión"
    MOTOCICLETA = "motorcycle", "Motocicleta"


class VehicleSize(models.TextChoices):
    """DBML `size_enum`."""

    SMALL = "small", "Pequeño"
    MEDIUM = "medium", "Mediano"
    LARGE = "big", "Grande"


class MarketSegment(models.TextChoices):
    """DBML `market_segment_enum`."""

    MINI = "mini", "Mini"
    SUPERMINI = "supermini", "Supermini"
    LOWER_MEDIUM = "med_low", "Mediano inferior"
    UPPER_MEDIUM = "med_sup", "Mediano superior"
    EXECUTIVE = "executive", "Ejecutivo"
    LUXURY = "luxury", "Lujo"
    SPORT = "sports", "Deportivo"
    DUAL_4X4 = "suv", "4x4 / Dual (SUV)"
    MPV = "MPV", "MPV"


class VehUse(models.TextChoices):
    """DBML `veh_use_enum`."""

    PASSENGERS = "passengers", "Pasajeros"
    GOODS = "freight", "Mercancía"


class PropertyType(models.TextChoices):
    """DBML `property_type_enum`."""

    OWNED = "propio", "Propio"
    RENTING = "renting", "Renting"


class UseType(models.TextChoices):
    """DBML `use_type_enum` (uso empresarial del vehículo)."""

    ON_PROJECT = "on_project", "Proyecto"
    PERSONAL = "personal", "Personal"
    WORKS = "works", "Obras"
