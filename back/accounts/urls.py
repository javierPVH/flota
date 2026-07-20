from django.urls import path

from .views import (
    AuthConfigView,
    CsrfView,
    DriversView,
    GoogleLoginView,
    LoginView,
    LogoutView,
    MeView,
    RegisterView,
)

urlpatterns = [
    path("config/", AuthConfigView.as_view(), name="auth-config"),
    path("csrf/", CsrfView.as_view(), name="csrf"),
    path("login/", LoginView.as_view(), name="login"),
    path("register/", RegisterView.as_view(), name="register"),
    path("google/", GoogleLoginView.as_view(), name="google-login"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("me/", MeView.as_view(), name="me"),
    path("drivers/", DriversView.as_view(), name="drivers"),
]
