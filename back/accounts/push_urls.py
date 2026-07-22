"""Rutas de push (M8), montadas en /api/v1/push/."""

from django.urls import path

from .push_views import PushConfigView, PushSubscriptionView

urlpatterns = [
    path("config/", PushConfigView.as_view(), name="push-config"),
    path("subscriptions/", PushSubscriptionView.as_view(), name="push-subscriptions"),
]
