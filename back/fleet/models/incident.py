"""Incidencias / mantenimiento del vehículo (Épica 6).

Recurso al que se ligan documentos (acta, parte, fotos) — ver `Document`.
"""

from django.db import models

from .base import DeactivatableModel, TimeStampedModel
from .enums import IncidentStatus, IncidentType


class Incident(DeactivatableModel, TimeStampedModel):
    """Incidencia o mantenimiento de un vehículo."""

    vehicle = models.ForeignKey("fleet.Vehicle", on_delete=models.CASCADE, related_name="incidents")
    type = models.CharField("Tipo", max_length=20, choices=IncidentType.choices)
    date = models.DateField("Fecha", null=True, blank=True)
    description = models.TextField("Descripción", blank=True)
    mileage = models.PositiveIntegerField("Kilometraje", null=True, blank=True)
    workshop_postal_code = models.CharField("CP del taller", max_length=12, blank=True)
    details = models.JSONField(
        "Datos del parte",
        default=dict,
        blank=True,
        help_text="Campos estructurados específicos de neumáticos, avería o accidente.",
    )
    status = models.CharField(
        "Estado", max_length=20, choices=IncidentStatus.choices, default=IncidentStatus.OPEN
    )
    cost = models.DecimalField("Coste", max_digits=10, decimal_places=2, null=True, blank=True)

    class Meta:
        verbose_name = "incidencia"
        verbose_name_plural = "incidencias"
        ordering = ["-date"]

    def __str__(self) -> str:
        return f"{self.vehicle.plate} · {self.get_type_display()} ({self.date})"


class AccidentReport(TimeStampedModel):
    """Parte de la comunicación de accidente, 1-a-1 con su incidencia.

    Las TABLAS del parte: el dato canónico sigue viajando en `Incident.details`
    (`report_version = 1`, el mismo parte guiado de la PWA y de gestión) y una
    señal lo materializa aquí de forma idempotente (`services/accidents.py`).
    Los daños viajan en `Incident.description` y el CP del taller en su campo;
    terceros y lesionados cuelgan de aquí (líneas repetibles). El ciclo
    (gestión → solución) es el de la incidencia; N7 lo cubre ella.
    """

    incident = models.OneToOneField(
        "fleet.Incident", on_delete=models.CASCADE, related_name="accident_report"
    )
    street = models.CharField("Calle", max_length=200)
    street_number = models.CharField("Número", max_length=20, blank=True)
    postal_code = models.CharField("Código postal", max_length=12, blank=True)
    locality = models.CharField("Localidad", max_length=120)
    province = models.CharField("Provincia", max_length=120, blank=True)
    occurred_at = models.DateTimeField("Fecha y hora")
    phone = models.CharField("Teléfono", max_length=30, blank=True)
    police_report_ref = models.CharField("Referencia del atestado", max_length=120, blank=True)

    class Meta:
        verbose_name = "parte de accidente"
        verbose_name_plural = "partes de accidente"

    def __str__(self) -> str:
        return f"Accidente {self.incident.vehicle.plate} · {self.occurred_at:%Y-%m-%d %H:%M}"


class AccidentThirdParty(TimeStampedModel):
    """Tercero implicado en un accidente (los datos del parte amistoso).

    Los campos calcan el parte de la PWA; todos opcionales — en el lugar del
    accidente se apunta lo que se pueda.
    """

    report = models.ForeignKey(
        AccidentReport, on_delete=models.CASCADE, related_name="third_parties"
    )
    name = models.CharField("Nombre", max_length=150, blank=True)
    plate = models.CharField("Matrícula", max_length=20, blank=True)
    brand = models.CharField("Marca", max_length=100, blank=True)
    model = models.CharField("Modelo", max_length=100, blank=True)
    phone = models.CharField("Teléfono", max_length=30, blank=True)
    insurance_company = models.CharField("Aseguradora", max_length=150, blank=True)
    policy_number = models.CharField("Nº de póliza", max_length=100, blank=True)
    damage_description = models.TextField("Daños", blank=True)

    class Meta:
        verbose_name = "tercero implicado"
        verbose_name_plural = "terceros implicados"

    def __str__(self) -> str:
        return self.name or self.plate or f"Tercero #{self.pk}"


class AccidentInjured(TimeStampedModel):
    """Lesionado en un accidente (mismos campos que el parte de la PWA)."""

    class Seat(models.TextChoices):
        DRIVER = "driver", "Conductor"
        PASSENGER = "passenger", "Pasajero"

    report = models.ForeignKey(AccidentReport, on_delete=models.CASCADE, related_name="injured")
    name = models.CharField("Nombre", max_length=150, blank=True)
    phone = models.CharField("Teléfono", max_length=30, blank=True)
    email = models.EmailField("Email", blank=True)
    plate = models.CharField("Matrícula del vehículo", max_length=20, blank=True)
    seat = models.CharField("Posición", max_length=20, choices=Seat.choices, default=Seat.DRIVER)

    class Meta:
        verbose_name = "lesionado"
        verbose_name_plural = "lesionados"

    def __str__(self) -> str:
        return self.name or f"Lesionado #{self.pk}"
