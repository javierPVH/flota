from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import (
    AuthConfigView,
    CsrfView,
    DevLoginView,
    DriversView,
    GoogleLoginView,
    LoginView,
    LogoutView,
    MeView,
    RegisterView,
    UserViewSet,
)

router = SimpleRouter()
# Gestión de usuarios/conductores (solo admin) — HU-2.6, Fase A1.
router.register("users", UserViewSet, basename="user")

urlpatterns = [
    path("config/", AuthConfigView.as_view(), name="auth-config"),
    path("csrf/", CsrfView.as_view(), name="csrf"),
    path("login/", LoginView.as_view(), name="login"),
    path("register/", RegisterView.as_view(), name="register"),
    path("google/", GoogleLoginView.as_view(), name="google-login"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("me/", MeView.as_view(), name="me"),
    path("drivers/", DriversView.as_view(), name="drivers"),
    # SOLO desarrollo (DEBUG + FLEET_SEED_DATA); fuera de eso responde 404.
    path("dev-login/", DevLoginView.as_view(), name="dev-login"),
    *router.urls,
]
