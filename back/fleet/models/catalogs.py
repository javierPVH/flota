"""Catálogos maestros (tablas de referencia del DBML).

Todos llevan una unicidad que NO distingue mayúsculas (`Lower(...)`): son los
maestros que alimentan los selects de la aplicación, y «Seat», «SEAT» y «seat»
como tres marcas distintas ensuciaban el alta de vehículo. Cinco de ellos
(país, unidad de negocio, proyecto, CECO y renting) no tenían restricción
alguna y admitían duplicados exactos.

La restricción cuenta también las filas desactivadas (aquí nada se borra, N7),
así que el alta de un nombre ya usado por un registro dado de baja se responde
con un 409 que ofrece restaurarlo — ver `CatalogUniqueMixin` en `serializers`.
"""

from django.db import models
from django.db.models.functions import Lower

from .base import DeactivatableModel, TimeStampedModel


class Country(DeactivatableModel, TimeStampedModel):
    """DBML `country`."""

    name = models.CharField("Nombre", max_length=100)

    class Meta:
        verbose_name = "país"
        verbose_name_plural = "países"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(Lower("name"), name="uniq_country_name_ci"),
        ]

    def __str__(self) -> str:
        return self.name


class BusinessUnit(DeactivatableModel, TimeStampedModel):
    """DBML `business_unit` (unidad de negocio)."""

    code = models.CharField("Código", max_length=30, blank=True)
    name = models.CharField("Nombre", max_length=150)

    class Meta:
        verbose_name = "unidad de negocio"
        verbose_name_plural = "unidades de negocio"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(Lower("name"), name="uniq_business_unit_name_ci"),
        ]

    def __str__(self) -> str:
        return f"{self.code} · {self.name}" if self.code else self.name


class Project(DeactivatableModel, TimeStampedModel):
    """DBML `projects`."""

    project_name = models.CharField("Nombre del proyecto", max_length=150)
    # Todo proyecto imputa a un CECO. Nullable en BD por las filas legacy
    # (la API lo exige en altas: ver ProjectSerializer); PROTECT para que no
    # se pueda borrar un CECO con proyectos colgando.
    cost_center = models.ForeignKey(
        "fleet.Pep",
        verbose_name="Centro de coste (CECO)",
        on_delete=models.PROTECT,
        related_name="projects",
        null=True,
        blank=True,
        help_text="Centro de coste (PEP/CECO) al que se asocia el proyecto.",
    )

    class Meta:
        verbose_name = "proyecto"
        verbose_name_plural = "proyectos"
        ordering = ["project_name"]
        constraints = [
            models.UniqueConstraint(Lower("project_name"), name="uniq_project_name_ci"),
        ]

    def __str__(self) -> str:
        return self.project_name


class Pep(DeactivatableModel, TimeStampedModel):
    """DBML `pep` (elemento PEP / centro de coste — CECO)."""

    code = models.CharField("Código", max_length=30, blank=True)
    name = models.CharField("Nombre", max_length=150)

    class Meta:
        verbose_name = "PEP / CECO"
        verbose_name_plural = "PEP / CECO"
        ordering = ["code", "name"]
        constraints = [
            models.UniqueConstraint(Lower("name"), name="uniq_pep_name_ci"),
        ]

    def __str__(self) -> str:
        return f"{self.code} · {self.name}" if self.code else self.name


class Renting(DeactivatableModel, TimeStampedModel):
    """DBML `renting` (compañía / producto de renting)."""

    name = models.CharField("Nombre", max_length=150)
    # N10a: destinatario de los avisos de seguro (alerta insurance_due).
    email = models.EmailField("Email de contacto", blank=True)
    contact_name = models.CharField("Persona de contacto", max_length=150, blank=True)

    class Meta:
        verbose_name = "renting"
        verbose_name_plural = "rentings"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(Lower("name"), name="uniq_renting_name_ci"),
        ]

    def __str__(self) -> str:
        return self.name


class Brand(DeactivatableModel, TimeStampedModel):
    """N5: marca del vehículo (catálogo; antes texto libre en `Vehicle.brand`)."""

    name = models.CharField("Nombre", max_length=50)

    class Meta:
        verbose_name = "marca"
        verbose_name_plural = "marcas"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(Lower("name"), name="uniq_brand_name_ci"),
        ]

    def __str__(self) -> str:
        return self.name


class VehicleModel(DeactivatableModel, TimeStampedModel):
    """N5: modelo del vehículo — DEPENDE de la marca (no hay modelo sin marca)."""

    brand = models.ForeignKey(
        Brand,
        on_delete=models.PROTECT,
        related_name="models",
        verbose_name="Marca",
    )
    name = models.CharField("Nombre", max_length=50)

    class Meta:
        verbose_name = "modelo"
        verbose_name_plural = "modelos"
        ordering = ["brand__name", "name"]
        constraints = [
            models.UniqueConstraint("brand", Lower("name"), name="uniq_model_per_brand_ci"),
        ]

    def __str__(self) -> str:
        return f"{self.brand.name} {self.name}"


class Company(DeactivatableModel, TimeStampedModel):
    """N5: sociedad titular (código, nombre y descripción)."""

    code = models.CharField("Código", max_length=30)
    name = models.CharField("Nombre", max_length=150)
    description = models.TextField("Descripción", blank=True)

    class Meta:
        verbose_name = "sociedad"
        verbose_name_plural = "sociedades"
        ordering = ["code", "name"]
        constraints = [
            models.UniqueConstraint(Lower("code"), name="uniq_company_code_ci"),
        ]

    def __str__(self) -> str:
        return f"{self.code} · {self.name}"
