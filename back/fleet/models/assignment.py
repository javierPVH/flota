"""Asignaciones, reparto de uso y vínculos de sustitución.

DBML `assignments`, `vehicle_usage`, `vehicle_links`.
"""

from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from .base import DeactivatableModel, TimeStampedModel
from .enums import AssignmentStatus, LinkReason, VehicleState


def driver_assignment_clash(
    driver_id,
    *,
    is_substitute: bool,
    start_date=None,
    end_date=None,
    exclude_pk=None,
    exclude_vehicle_id=None,
):
    """Asignación ACEPTADA del conductor que choca con una nueva (o ``None``).

    Regla de negocio: **un conductor lleva UN coche a la vez** y, si el suyo se
    avería, puede sumar SOLO el de sustitución. Se compara por clase
    (`Vehicle.is_substitute`): principal + sustituto conviven; dos principales
    (o dos sustitutos) a la vez, no.

    El solape es por fechas con el criterio del dominio: fin NULL = en curso, y
    fin == inicio de la siguiente es un relevo válido (así cierra la gestión la
    vigente al aceptar la nueva). El mismo vehículo se excluye: el relevo
    dentro de un coche ya lo gobiernan `accept`/`set_driver` y la constraint
    `unique_active_assignment_per_vehicle`.
    """
    # Un coche que ya salió de la flota (BAJA) no «ocupa» al conductor: si una
    # asignación quedó colgada de una baja mal cerrada, no debe bloquear la
    # siguiente. La baja cierra sus asignaciones (services.returns), pero esto lo
    # cubre también frente a datos heredados. (El ciclo de vida del vehículo es
    # `state`, no `is_active` — su terminal es BAJA.)
    qs = (
        Assignment.objects.filter(
            driver_id=driver_id,
            status=AssignmentStatus.ACCEPTED,
            is_active=True,
            vehicle__is_substitute=is_substitute,
        )
        .exclude(vehicle__state=VehicleState.BAJA)
        .select_related("vehicle")
    )
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    if exclude_vehicle_id is not None:
        qs = qs.exclude(vehicle_id=exclude_vehicle_id)
    # Sin inicio explícito, la nueva empieza "ya" (mismo default que accept).
    if start_date is not None:
        qs = qs.filter(models.Q(end_date__isnull=True) | models.Q(end_date__gt=start_date))
    if end_date is not None:
        qs = qs.filter(models.Q(start_date__isnull=True) | models.Q(start_date__lt=end_date))
    return qs.first()


def driver_clash_message(clash) -> str:
    """Mensaje único para la regla, allá donde se valide."""
    kind = "el sustituto" if clash.vehicle.is_substitute else "el"
    return (
        f"El conductor ya lleva {kind} {clash.vehicle.plate} en ese periodo: "
        "un coche por conductor a la vez (más el de sustitución si el suyo está parado)."
    )


def vehicle_assignment_overlap(
    vehicle_id,
    *,
    start_date=None,
    end_date=None,
    exclude_pk=None,
):
    """Asignación ACEPTADA del mismo coche que pisa el rango (o ``None``).

    Un coche lleva UN conductor a la vez, también en el histórico: dos
    periodos aceptados del mismo vehículo no pueden solaparse. Fin NULL = en
    curso (llega hasta el infinito) e inicio NULL = viene de siempre; fin ==
    inicio del siguiente es un relevo válido, no un solape.
    """
    # Cuentan los tramos REALES: la vigente (aceptada) y las ya cerradas
    # (finalizadas). Una propuesta o un rechazo no ocupan al coche.
    qs = Assignment.objects.filter(
        vehicle_id=vehicle_id,
        status__in=(AssignmentStatus.ACCEPTED, AssignmentStatus.FINISHED),
        is_active=True,
    ).select_related("driver")
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    if start_date is not None:
        qs = qs.filter(models.Q(end_date__isnull=True) | models.Q(end_date__gt=start_date))
    if end_date is not None:
        qs = qs.filter(models.Q(start_date__isnull=True) | models.Q(start_date__lt=end_date))
    return qs.order_by("start_date").first()


def periodo_texto(start_date, end_date) -> str:
    """«del 2026-01-01 al 2026-06-30» / «desde el …» para los mensajes."""
    if start_date and end_date:
        return f"del {start_date} al {end_date}"
    if start_date:
        return f"desde el {start_date}"
    if end_date:
        return f"hasta el {end_date}"
    return "sin fechas"


class Assignment(DeactivatableModel, TimeStampedModel):
    """DBML `assignments` — conductor asignado a un vehículo en un periodo.

    `end_date` NULL = asignación en curso. `status` sigue el ciclo
    propuesta → aceptada/rechazada → finalizada.
    """

    vehicle = models.ForeignKey(
        "fleet.Vehicle", on_delete=models.CASCADE, related_name="assignments"
    )
    driver = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="assignments"
    )
    start_date = models.DateField("Inicio", null=True, blank=True)
    end_date = models.DateField("Fin", null=True, blank=True, help_text="NULL = en curso.")
    status = models.CharField(
        "Estado",
        max_length=20,
        choices=AssignmentStatus.choices,
        default=AssignmentStatus.PROPOSED,
    )
    usage_percent = models.DecimalField(
        "% de uso", max_digits=5, decimal_places=2, null=True, blank=True
    )

    class Meta:
        verbose_name = "asignación"
        verbose_name_plural = "asignaciones"
        ordering = ["-created_at"]
        indexes = [
            # Búsqueda del conductor en curso (end_date NULL, status) por vehículo.
            models.Index(fields=["vehicle", "end_date", "status"]),
            models.Index(fields=["driver", "end_date"]),
        ]
        constraints = [
            # HU-2.1/2.2: una sola asignación ACEPTADA en curso por vehículo.
            # (Las propuestas pueden coexistir con la vigente.)
            # N7: una asignación DESACTIVADA no puede seguir bloqueando el
            # hueco de "aceptada en curso" (si no, desactivarla dejaría el
            # vehículo sin conductor y sin poder asignar otro).
            models.UniqueConstraint(
                fields=["vehicle"],
                condition=models.Q(
                    status=AssignmentStatus.ACCEPTED, end_date__isnull=True, is_active=True
                ),
                name="unique_active_assignment_per_vehicle",
            )
        ]

    def __str__(self) -> str:
        return f"{self.vehicle.plate} → {self.driver} ({self.get_status_display()})"

    def clean(self):
        # HU-2.1: no se puede asignar un conductor a un vehículo en baja.
        if self.vehicle_id and self.vehicle.state == VehicleState.BAJA:
            raise ValidationError("No se puede asignar un conductor a un vehículo en baja.")
        # Un coche por conductor a la vez (+ el sustituto aparte). También en
        # el admin: DRF no llama a clean(), así que los serializers y las
        # acciones repiten esta misma comprobación vía driver_assignment_clash.
        if self.driver_id and self.vehicle_id and self.is_active:
            if self.status == AssignmentStatus.ACCEPTED:
                clash = driver_assignment_clash(
                    self.driver_id,
                    is_substitute=self.vehicle.is_substitute,
                    start_date=self.start_date,
                    end_date=self.end_date,
                    exclude_pk=self.pk,
                    exclude_vehicle_id=self.vehicle_id,
                )
                if clash:
                    raise ValidationError({"driver": driver_clash_message(clash)})


class VehicleUsage(DeactivatableModel, TimeStampedModel):
    """DBML `vehicle_usage` — reparto de uso por porcentaje.

    La suma por vehículo y periodo debería ser 100 (se valida en el endpoint de
    edición del reparto, no fila a fila). Lo fija admin o supervisor.
    """

    vehicle = models.ForeignKey("fleet.Vehicle", on_delete=models.CASCADE, related_name="usages")
    driver = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="vehicle_usages"
    )
    usage_percent = models.DecimalField(
        "% de uso", max_digits=5, decimal_places=2, null=True, blank=True
    )
    start_date = models.DateField("Inicio", null=True, blank=True)
    end_date = models.DateField("Fin", null=True, blank=True)

    class Meta:
        verbose_name = "reparto de uso"
        verbose_name_plural = "repartos de uso"
        ordering = ["-start_date", "-pk"]  # R3-23: desempate estable

    def __str__(self) -> str:
        return f"{self.vehicle.plate} · {self.driver}: {self.usage_percent}%"

    def clean(self):
        # HU-2.5: cada porcentaje individual está entre 0 y 100.
        if self.usage_percent is not None and not (
            Decimal("0") <= self.usage_percent <= Decimal("100")
        ):
            raise ValidationError({"usage_percent": "El porcentaje debe estar entre 0 y 100."})


class VehicleLink(DeactivatableModel, TimeStampedModel):
    """DBML `vehicle_links` — vínculo entre vehículo principal y su sustituto."""

    main_vehicle = models.ForeignKey(
        "fleet.Vehicle",
        on_delete=models.CASCADE,
        related_name="substitute_links",
        verbose_name="Vehículo principal",
    )
    substitute_vehicle = models.ForeignKey(
        "fleet.Vehicle",
        on_delete=models.CASCADE,
        related_name="main_links",
        verbose_name="Vehículo de sustitución",
    )
    reason = models.CharField("Motivo", max_length=20, choices=LinkReason.choices)
    start_date = models.DateField("Inicio")
    end_date = models.DateField("Fin", null=True, blank=True, help_text="NULL = vínculo activo.")

    class Meta:
        verbose_name = "vínculo de sustitución"
        verbose_name_plural = "vínculos de sustitución"
        ordering = ["-start_date", "-pk"]  # R3-23: desempate estable
        constraints = [
            # HU-1.8: un principal solo tiene un sustituto activo a la vez.
            # N7: ídem — un vínculo desactivado no bloquea al principal.
            models.UniqueConstraint(
                fields=["main_vehicle"],
                condition=models.Q(end_date__isnull=True, is_active=True),
                name="unique_active_substitute_per_main",
            )
        ]

    def __str__(self) -> str:
        return f"{self.main_vehicle.plate} ← {self.substitute_vehicle.plate}"


class SupervisorPeriod(DeactivatableModel, TimeStampedModel):
    """Periodo en que una persona es supervisora de un vehículo.

    El supervisor VIGENTE sigue viviendo en `Vehicle.supervisor` (es lo que
    acotan los permisos y lo que leen los listados); esta tabla es su
    **histórico con fechas**, para poder corregirlo y para registrar relevos
    pasados o programados. Las dos caras se mantienen a la vez en
    `services/supervisors.py`: tocar un periodo que cubre hoy actualiza el
    vehículo, y cambiar el supervisor del vehículo cierra/abre periodos.

    Regla: un coche tiene UN supervisor a la vez, así que los periodos de un
    mismo vehículo no se solapan (fin == inicio del siguiente es un relevo).
    """

    vehicle = models.ForeignKey(
        "fleet.Vehicle", on_delete=models.CASCADE, related_name="supervisor_periods"
    )
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="supervisor_periods"
    )
    start_date = models.DateField("Inicio")
    end_date = models.DateField("Fin", null=True, blank=True, help_text="NULL = en curso.")

    class Meta:
        verbose_name = "periodo de supervisión"
        verbose_name_plural = "periodos de supervisión"
        ordering = ["-start_date", "-pk"]
        indexes = [models.Index(fields=["vehicle", "end_date"])]
        constraints = [
            # Uno en curso por vehículo (el vigente). Los cerrados conviven.
            models.UniqueConstraint(
                fields=["vehicle"],
                condition=models.Q(end_date__isnull=True, is_active=True),
                name="unique_open_supervisor_period_per_vehicle",
            )
        ]

    def __str__(self) -> str:
        cuando = periodo_texto(self.start_date, self.end_date)
        return f"{self.vehicle.plate} · {self.supervisor} ({cuando})"

    def clean(self):
        if self.supervisor_id and not self.supervisor.is_supervisor:
            raise ValidationError({"supervisor": "El usuario no tiene rol de supervisor."})
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValidationError(
                {"end_date": "La fecha de fin no puede ser anterior a la de inicio."}
            )
        if self.vehicle_id and self.start_date and self.is_active:
            otro = supervisor_period_overlap(
                self.vehicle_id,
                start_date=self.start_date,
                end_date=self.end_date,
                exclude_pk=self.pk,
            )
            if otro is not None:
                raise ValidationError({"start_date": supervisor_overlap_message(otro)})


def supervisor_period_overlap(vehicle_id, *, start_date, end_date=None, exclude_pk=None):
    """Periodo de supervisión del mismo coche que pisa el rango (o ``None``)."""
    qs = SupervisorPeriod.objects.filter(vehicle_id=vehicle_id, is_active=True).select_related(
        "supervisor"
    )
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    if start_date is not None:
        qs = qs.filter(models.Q(end_date__isnull=True) | models.Q(end_date__gt=start_date))
    if end_date is not None:
        qs = qs.filter(start_date__lt=end_date)
    return qs.order_by("start_date").first()


def supervisor_overlap_message(otro) -> str:
    """Quién ocupa el rango, para decirlo igual en el back y en la interfaz."""
    nombre = otro.supervisor.get_full_name() or otro.supervisor.get_username()
    return (
        f"Esas fechas ya las cubre {nombre} ({periodo_texto(otro.start_date, otro.end_date)}): "
        "un coche tiene un supervisor a la vez. Ajusta las fechas o cierra ese periodo antes."
    )


def assignment_overlap_message(otra) -> str:
    """Lo mismo para el conductor."""
    nombre = otra.driver.get_full_name() or otra.driver.get_username()
    return (
        f"Esas fechas ya las cubre {nombre} ({periodo_texto(otra.start_date, otra.end_date)}): "
        "un coche tiene un conductor a la vez. Ajusta las fechas o cierra esa asignación antes."
    )
