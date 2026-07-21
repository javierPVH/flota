from rest_framework.routers import DefaultRouter

from .views import (
    AssignmentViewSet,
    BusinessUnitViewSet,
    ContractViewSet,
    CountryViewSet,
    DocumentViewSet,
    EventViewSet,
    IncidentViewSet,
    InvoiceAllocationViewSet,
    InvoiceViewSet,
    KmReadingViewSet,
    PepViewSet,
    ProjectViewSet,
    RentingViewSet,
    VehicleLinkViewSet,
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
# Catálogos
router.register("countries", CountryViewSet, basename="country")
router.register("business-units", BusinessUnitViewSet, basename="businessunit")
router.register("projects", ProjectViewSet, basename="project")
router.register("peps", PepViewSet, basename="pep")
router.register("rentings", RentingViewSet, basename="renting")

urlpatterns = router.urls
