from django.urls import path

from .views import health, ready

urlpatterns = [
    path("health/", health, name="health"),  # liveness
    path("ready/", ready, name="ready"),  # readiness (BD + cache)
]
