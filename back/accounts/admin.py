from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User, UserRole


class UserRoleInline(admin.TabularInline):
    """Roles del usuario, editables inline (admin/supervisor/driver)."""

    model = UserRole
    extra = 1


@admin.register(User)
class FlotaUserAdmin(UserAdmin):
    """Admin de usuario (=persona/driver) con sus roles inline y `fuel_card`.

    Aquí se aprovisionan los usuarios de gestión (dándoles rol admin/supervisor);
    el self-registro del front público crea siempre conductores.
    """

    inlines = [UserRoleInline]
    list_display = ("username", "email", "roles_display", "license_type", "fuel_card", "is_active")
    list_filter = (
        "roles__role",
        "license_type",
        "is_staff",
        "is_superuser",
        "is_active",
        "fuel_card",
    )
    fieldsets = UserAdmin.fieldsets + (
        ("Flota", {"fields": ("dni", "phone", "license_type", "fuel_card")}),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ("Flota", {"fields": ("dni", "phone", "license_type", "fuel_card")}),
    )

    @admin.display(description="Roles")
    def roles_display(self, obj) -> str:
        return ", ".join(sorted(obj.roles.values_list("role", flat=True))) or "—"
