"""Vehículo — entidad central del dominio (DBML `vehicles`)."""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from .base import TimeStampedModel
from .enums import (
    Fuel,
    MarketSegment,
    PropertyType,
    UseType,
    VehicleSize,
    VehicleState,
    VehicleType,
    VehUse,
)


class VehicleQuerySet(models.QuerySet):
    """QuerySet de vehículos con helper de *soft-delete*."""

    def active(self):
        """Excluye los vehículos dados de baja (estado terminal)."""
        return self.exclude(state=VehicleState.BAJA)


class Vehicle(TimeStampedModel):
    """Vehículo de la flota.

    El conductor se relaciona a través de `Assignment` / `VehicleUsage` (no hay
    un campo de conductor directo). `supervisor` es el responsable opcional.
    """

    # Manager por defecto: sigue devolviendo TODA la flota (el scoping y el
    # filtro de `baja` se aplican donde corresponde). `active()` excluye baja.
    objects = VehicleQuerySet.as_manager()

    plate = models.CharField("Matrícula", max_length=15, unique=True)
    business_unit = models.ForeignKey(
        "fleet.BusinessUnit",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="vehicles",
        verbose_name="Unidad de negocio",
    )
    state = models.CharField("Estado", max_length=20, choices=VehicleState.choices, blank=True)
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="supervised_vehicles",
        verbose_name="Supervisor",
        help_text="Opcional: responsable del vehículo.",
    )
    is_substitute = models.BooleanField("¿Es vehículo de sustitución?", default=False)
    # N5: marca/modelo por catálogo (FKs) + sociedad titular. Los CharField
    # `brand`/`model` quedan como legado denormalizado (se rellenan desde las
    # FKs en el serializer) hasta retirarlos en una migración posterior.
    brand = models.CharField("Marca", max_length=50)
    model = models.CharField("Modelo", max_length=50)
    brand_ref = models.ForeignKey(
        "fleet.Brand",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="vehicles",
        verbose_name="Marca (catálogo)",
    )
    model_ref = models.ForeignKey(
        "fleet.VehicleModel",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="vehicles",
        verbose_name="Modelo (catálogo)",
    )
    company = models.ForeignKey(
        "fleet.Company",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="vehicles",
        verbose_name="Sociedad",
    )
    year = models.PositiveIntegerField("Año", null=True, blank=True)
    vin = models.CharField("Bastidor (VIN)", max_length=32, blank=True)
    registration_date = models.DateField("Fecha de matriculación", null=True, blank=True)
    country = models.ForeignKey(
        "fleet.Country",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="vehicles",
        verbose_name="País",
    )
    fuel = models.CharField("Combustible", max_length=40, choices=Fuel.choices, blank=True)
    type = models.CharField("Tipo", max_length=20, choices=VehicleType.choices, blank=True)
    size = models.CharField("Tamaño", max_length=20, choices=VehicleSize.choices, blank=True)
    market_segment = models.CharField(
        "Segmento de mercado", max_length=30, choices=MarketSegment.choices, blank=True
    )
    veh_use = models.CharField(
        "Uso (pasajeros/mercancía)", max_length=20, choices=VehUse.choices, blank=True
    )
    version = models.CharField("Versión", max_length=100, blank=True)
    consumption = models.PositiveIntegerField("Consumo", null=True, blank=True)
    km_start = models.PositiveIntegerField("Km inicial", null=True, blank=True)
    km_end = models.PositiveIntegerField("Km final", null=True, blank=True)
    property = models.CharField(
        "Propiedad", max_length=20, choices=PropertyType.choices, blank=True
    )
    business_use = models.CharField(
        "Uso empresarial", max_length=20, choices=UseType.choices, blank=True
    )
    project = models.ForeignKey(
        "fleet.Project",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="vehicles",
        verbose_name="Proyecto",
        help_text="Obligatorio si el uso empresarial es 'Proyecto'.",
    )
    cost_center = models.ForeignKey(
        "fleet.Pep",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="vehicles",
        verbose_name="CECO de imputación",
        help_text="Centro de coste (PEP) al que se imputa el vehículo.",
    )
    unlimited_km = models.BooleanField(
        "Km ilimitados",
        default=False,
        help_text=(
            "N3: sin proyección de km ni alertas de exceso; el contrato puede "
            "no llevar km contratados."
        ),
    )
    insurance_expiry_date = models.DateField(
        "Vencimiento del seguro",
        null=True,
        blank=True,
        db_index=True,
        help_text=(
            "N2: editable en ficha y sincronizado al subir un documento de seguro "
            "con caducidad más reciente; alimenta la alerta de seguro (30/15/7)."
        ),
    )
    next_itv_date = models.DateField(
        "Próxima ITV",
        null=True,
        blank=True,
        db_index=True,
        help_text=(
            "Denormalizado del último `EventItv.next_due`; lo refresca el job "
            "`refresh_next_itv` y alimenta la alerta de ITV escalonada (HU-5.1)."
        ),
    )
    drive_folder_url = models.URLField(
        "Carpeta de Drive",
        blank=True,
        help_text="Carpeta del vehículo en el repositorio documental (HU-4.2). "
        "La crea el archivador la primera vez que se archiva un documento.",
    )
    drive_folder_id = models.CharField(
        "ID de carpeta en Drive",
        max_length=100,
        blank=True,
        help_text="ID de la carpeta del vehículo en Google Drive (Fase A3): lo usa "
        "el archivador para subir y el Picker para listar (`folder-files`).",
    )

    class Meta:
        verbose_name = "vehículo"
        verbose_name_plural = "vehículos"
        ordering = ["plate"]
        indexes = [
            # `state` se filtra/excluye en casi todos los listados (baja, activos…).
            models.Index(fields=["state"]),
        ]

    def __str__(self) -> str:
        return f"{self.plate} — {self.brand} {self.model}"

    def clean(self):
        # HU-1.3: si el uso empresarial es "proyecto", el proyecto es obligatorio.
        # (⚠️ confirmar terminología obra/proyecto — ver MEJORAS.md §1.4.)
        if self.business_use == UseType.ON_PROJECT and self.project_id is None:
            raise ValidationError(
                {"project": "El proyecto es obligatorio cuando el uso es 'Proyecto'."}
            )
