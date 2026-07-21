"""Catálogos maestros (tablas de referencia del DBML)."""
from django.db import models

from .base import TimeStampedModel


class Country(TimeStampedModel):
    """DBML `country`."""

    name = models.CharField("Nombre", max_length=100)

    class Meta:
        verbose_name = "país"
        verbose_name_plural = "países"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class BusinessUnit(TimeStampedModel):
    """DBML `business_unit` (unidad de negocio)."""

    code = models.CharField("Código", max_length=30, blank=True)
    name = models.CharField("Nombre", max_length=150)

    class Meta:
        verbose_name = "unidad de negocio"
        verbose_name_plural = "unidades de negocio"
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.code} · {self.name}" if self.code else self.name


class Project(TimeStampedModel):
    """DBML `projects`."""

    project_name = models.CharField("Nombre del proyecto", max_length=150)

    class Meta:
        verbose_name = "proyecto"
        verbose_name_plural = "proyectos"
        ordering = ["project_name"]

    def __str__(self) -> str:
        return self.project_name


class Pep(TimeStampedModel):
    """DBML `pep` (elemento PEP / centro de coste — CECO)."""

    code = models.CharField("Código", max_length=30, blank=True)
    name = models.CharField("Nombre", max_length=150)

    class Meta:
        verbose_name = "PEP / CECO"
        verbose_name_plural = "PEP / CECO"
        ordering = ["code", "name"]

    def __str__(self) -> str:
        return f"{self.code} · {self.name}" if self.code else self.name


class Renting(TimeStampedModel):
    """DBML `renting` (compañía / producto de renting)."""

    name = models.CharField("Nombre", max_length=150)

    class Meta:
        verbose_name = "renting"
        verbose_name_plural = "rentings"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name
