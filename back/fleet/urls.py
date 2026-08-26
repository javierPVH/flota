from django.urls import path
from rest_framework.routers import DefaultRouter

from .erratas import ErratasItemsView, ErratasPurgeView, ErratasRestoreView, ErratasView
from .views import (
    AlertViewSet,
    AssignmentViewSet,
    BrandViewSet,
    BusinessUnitViewSet,
    CatalogsBundleView,
    CompanyViewSet,
    ContractViewSet,
    CountryViewSet,
    DocumentViewSet,
    EmailLogViewSet,
    EmailSignatureViewSet,
    EmailTemplateViewSet,
    EventViewSet,
    FleetSummaryView,
    FuelConsumptionViewSet,
    FuelTypeViewSet,
    IncidentViewSet,
    InvoiceAllocationViewSet,
    InvoiceViewSet,
    KmReadingViewSet,
    MaintenancePlanViewSet,
    NotificationScheduleViewSet,
    PepViewSet,
    ProjectViewSet,
    RentingViewSet,
    ReportsView,
    SiteViewSet,
    VehicleLinkViewSet,
    VehicleModelViewSet,
    VehicleRequestViewSet,
    VehicleSummariesView,
    VehicleUsageViewSet,
    VehicleViewSet,
    WorkshopViewSet,
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
# GAP-2/GAP-8: consumo mensual de combustible y mantenimiento preventivo.
router.register("fuel-consumptions", FuelConsumptionViewSet, basename="fuelconsumption")
router.register("maintenance-plans", MaintenancePlanViewSet, basename="maintenanceplan")
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
# GAP-1/GAP-4: combustibles (lista HSE) y sedes/oficinas.
router.register("fuel-types", FuelTypeViewSet, basename="fueltype")
router.register("sites", SiteViewSet, basename="site")
# Talleres y estaciones de ITV: dónde se cita el vehículo.
router.register("workshops", WorkshopViewSet, basename="workshop")
# N10: gestor maestro de correo (plantillas, firmas y traza de envíos).
router.register("email-templates", EmailTemplateViewSet, basename="emailtemplate")
router.register("email-signatures", EmailSignatureViewSet, basename="emailsignature")
router.register("email-logs", EmailLogViewSet, basename="emaillog")
router.register(
    "notification-schedules", NotificationScheduleViewSet, basename="notificationschedule"
)

urlpatterns = [
    path("reports/", ReportsView.as_view(), name="reports"),
    # N7: espacio de erratas (desactivados) — restaurar (admin) / purgar (superusuario).
    path("erratas/", ErratasView.as_view(), name="erratas"),
    # M5: los registros de un tipo, paginados (el índice solo trae recuentos).
    path("erratas/items/", ErratasItemsView.as_view(), name="erratas-items"),
    path("erratas/restore/", ErratasRestoreView.as_view(), name="erratas-restore"),
    path("erratas/purge/", ErratasPurgeView.as_view(), name="erratas-purge"),
    # Agregados del dashboard (Fase A1); acotado por rol.
    path("summary/", FleetSummaryView.as_view(), name="fleet-summary"),
    # Summaries de todo el ámbito en una respuesta (O2): evita el N+1 de campo.
    path("summary/vehicles/", VehicleSummariesView.as_view(), name="vehicle-summaries"),
    # Los catálogos del alta de vehículo juntos: 7 peticiones → 1.
    path("catalogs/", CatalogsBundleView.as_view(), name="catalogs-bundle"),
    *router.urls,
]
