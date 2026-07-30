from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AlertViewSet,
    AssignmentViewSet,
    BrandViewSet,
    BusinessUnitViewSet,
    CompanyViewSet,
    ContractViewSet,
    CountryViewSet,
    DocumentViewSet,
    EventViewSet,
    FleetSummaryView,
    IncidentViewSet,
    InvoiceAllocationViewSet,
    InvoiceViewSet,
    KmReadingViewSet,
    PepViewSet,
    ProjectViewSet,
    RentingViewSet,
    ReportsView,
    VehicleLinkViewSet,
    VehicleModelViewSet,
    VehicleRequestViewSet,
    VehicleSummariesView,
    VehicleUsageViewSet,
    VehicleViewSet,
)

router = DefaultRouter()
router.register("vehicles", VehicleViewSet, basename="vehicle")
router.register("contracts", ContractViewSet, basename="contract")
router.register("km-readings", KmReadingViewSet, basename="kmreading")
router.register("assignments", AssignmentViewSet, basename="assignment")
router.register("vehicle-usages", VehicleUsageViewSet, basename="vehicleusage")
router.register("vehicle-links", VehicleLinkViewSet, basename="vehiclelink")
router.register("events", EventViewSet, basename="event")
router.register("invoices", InvoiceViewSet, basename="invoice")
router.register("invoice-allocations", InvoiceAllocationViewSet, basename="invoiceallocation")
router.register("incidents", IncidentViewSet, basename="incident")
router.register("documents", DocumentViewSet, basename="document")
router.register("alerts", AlertViewSet, basename="alert")
router.register("vehicle-requests", VehicleRequestViewSet, basename="vehiclerequest")
# Catálogos
router.register("countries", CountryViewSet, basename="country")
router.register("business-units", BusinessUnitViewSet, basename="businessunit")
router.register("projects", ProjectViewSet, basename="project")
router.register("peps", PepViewSet, basename="pep")
router.register("rentings", RentingViewSet, basename="renting")
# N5: marca, modelo (dependiente, `?brand=<id>`) y sociedad.
router.register("brands", BrandViewSet, basename="brand")
router.register("vehicle-models", VehicleModelViewSet, basename="vehiclemodel")
router.register("companies", CompanyViewSet, basename="company")

urlpatterns = [
    path("reports/", ReportsView.as_view(), name="reports"),
    # Agregados del dashboard (Fase A1); acotado por rol.
    path("summary/", FleetSummaryView.as_view(), name="fleet-summary"),
    # Summaries de todo el ámbito en una respuesta (O2): evita el N+1 de campo.
    path("summary/vehicles/", VehicleSummariesView.as_view(), name="vehicle-summaries"),
    *router.urls,
]
