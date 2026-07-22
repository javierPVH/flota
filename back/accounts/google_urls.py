"""Rutas de Google Drive/Picker (Fase A3): montadas en /api/v1/google/."""

from django.urls import path

from .google_views import (
    DriveFolderFilesView,
    GooglePickerConfigView,
    google_oauth_callback,
    google_oauth_login,
)

urlpatterns = [
    path("oauth/login/", google_oauth_login, name="google-oauth-login"),
    path("oauth/callback/", google_oauth_callback, name="google-oauth-callback"),
    path("picker-config/", GooglePickerConfigView.as_view(), name="google-picker-config"),
    path("drive/folder-files/", DriveFolderFilesView.as_view(), name="google-drive-folder-files"),
]
