from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from . import sessions
from .forms import RateLimitedAdminAuthenticationForm
from .models import User, UserRole, UserSession

# R6-04: la entrada al /admin/ con el mismo anti fuerza bruta que la API.
admin.site.login_form = RateLimitedAdminAuthenticationForm


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


@admin.register(UserSession)
class UserSessionAdmin(admin.ModelAdmin):
    """Quién tiene sesión abierta y desde cuándo (una por persona), y la forma
    de CERRARLA desde administración: borrar la fila destruye también la
    sesión de Django, así que en la siguiente petición ese navegador vuelve al
    login. La clave de sesión no se enseña nunca: con ella en la mano se
    entra como esa persona (es la cookie), y no hace falta verla para nada."""

    list_display = ("user", "created_at", "user_agent")
    search_fields = ("user__username", "user__email")
    fields = ("user", "user_agent", "created_at")
    readonly_fields = ("user", "user_agent", "created_at")
    ordering = ("-created_at",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def delete_model(self, request, obj):
        sessions.close_session(obj)

    def delete_queryset(self, request, queryset):
        for row in queryset:
            sessions.close_session(row)
