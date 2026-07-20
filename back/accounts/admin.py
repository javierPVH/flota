from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class FlotaUserAdmin(UserAdmin):
    """Admin de usuario con el rol de flota visible y editable.

    Los usuarios de gestión (administrador / administrador de flota) se
    aprovisionan desde aquí; el self-registro del front público crea siempre
    conductores (rol por defecto del modelo).
    """

    list_display = ("username", "email", "role", "is_staff", "is_active")
    list_filter = ("role", "is_staff", "is_superuser", "is_active")
    # Añade la sección de rol a los fieldsets heredados de UserAdmin.
    fieldsets = UserAdmin.fieldsets + (("Flota", {"fields": ("role",)}),)
    add_fieldsets = UserAdmin.add_fieldsets + (("Flota", {"fields": ("role",)}),)
