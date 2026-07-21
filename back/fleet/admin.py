from django.contrib import admin

from .models import (
    Assignment,
    BusinessUnit,
    Contract,
    Country,
    Document,
    Event,
    Incident,
    EventDriverChange,
    EventFeeChange,
    EventItv,
    EventLocationChange,
    EventPenalty,
    EventPepChange,
    EventProjectChange,
    Invoice,
    InvoiceAllocation,
    KmReading,
    Pep,
    Project,
    Renting,
    Vehicle,
    VehicleLink,
    VehicleUsage,
)

# --- Catálogos ------------------------------------------------------------
@admin.register(Country)
class CountryAdmin(admin.ModelAdmin):
    list_display = ("name",)
    search_fields = ("name",)


@admin.register(Renting)
class RentingAdmin(admin.ModelAdmin):
    list_display = ("name",)
    search_fields = ("name",)


@admin.register(BusinessUnit)
class BusinessUnitAdmin(admin.ModelAdmin):
    list_display = ("code", "name")
    search_fields = ("code", "name")


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("project_name",)
    search_fields = ("project_name",)


@admin.register(Pep)
class PepAdmin(admin.ModelAdmin):
    list_display = ("code", "name")
    search_fields = ("code", "name")


# --- Vehículo y relacionados ---------------------------------------------
class ContractInline(admin.TabularInline):
    model = Contract
    extra = 0


class AssignmentInline(admin.TabularInline):
    model = Assignment
    extra = 0
    autocomplete_fields = ("driver",)


@admin.register(Vehicle)
class VehicleAdmin(admin.ModelAdmin):
    list_display = ("plate", "brand", "model", "state", "is_substitute", "supervisor")
    list_filter = ("state", "is_substitute", "type", "fuel", "property", "business_use")
    search_fields = ("plate", "brand", "model")
    autocomplete_fields = ("supervisor", "business_unit", "country", "project", "cost_center")
    inlines = [ContractInline, AssignmentInline]


@admin.register(Contract)
class ContractAdmin(admin.ModelAdmin):
    list_display = ("contract_number", "vehicle", "renting", "start_date", "planned_end_date")
    search_fields = ("contract_number", "client", "cif")
    autocomplete_fields = ("vehicle", "renting")


@admin.register(KmReading)
class KmReadingAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "reading_date", "km_reading")
    autocomplete_fields = ("vehicle",)


@admin.register(Assignment)
class AssignmentAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "driver", "status", "start_date", "end_date")
    list_filter = ("status",)
    autocomplete_fields = ("vehicle", "driver")


@admin.register(VehicleUsage)
class VehicleUsageAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "driver", "usage_percent", "start_date", "end_date")
    autocomplete_fields = ("vehicle", "driver")


@admin.register(VehicleLink)
class VehicleLinkAdmin(admin.ModelAdmin):
    list_display = ("main_vehicle", "substitute_vehicle", "reason", "start_date", "end_date")
    list_filter = ("reason",)
    autocomplete_fields = ("main_vehicle", "substitute_vehicle")


# --- Eventos --------------------------------------------------------------
@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "event_type", "event_date")
    list_filter = ("event_type",)
    autocomplete_fields = ("vehicle",)


admin.site.register(
    [
        EventPenalty,
        EventFeeChange,
        EventItv,
        EventProjectChange,
        EventLocationChange,
        EventPepChange,
        EventDriverChange,
    ]
)


# --- Facturas -------------------------------------------------------------
class InvoiceAllocationInline(admin.TabularInline):
    model = InvoiceAllocation
    extra = 0
    autocomplete_fields = ("project", "cost_center")


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ("code", "vehicle", "date", "amount")
    search_fields = ("code",)
    autocomplete_fields = ("vehicle",)
    inlines = [InvoiceAllocationInline]


# --- Incidencias y documentos --------------------------------------------
@admin.register(Incident)
class IncidentAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "type", "status", "date", "cost")
    list_filter = ("type", "status")
    search_fields = ("vehicle__plate", "description")
    autocomplete_fields = ("vehicle",)


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "type", "status", "expiry_date", "uploaded_by")
    list_filter = ("type", "status")
    search_fields = ("vehicle__plate",)
    autocomplete_fields = ("vehicle", "incident", "uploaded_by", "replaces")
