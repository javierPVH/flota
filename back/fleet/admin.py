from django.contrib import admin

from .models import Vehicle


@admin.register(Vehicle)
class VehicleAdmin(admin.ModelAdmin):
    list_display = ("plate", "brand", "model", "status", "assigned_driver")
    list_filter = ("status",)
    search_fields = ("plate", "brand", "model")
    autocomplete_fields = ("assigned_driver",)
