"""R3-34 — Idempotencia extremo a extremo para la cola offline de campo (M7).

El escenario: la PWA hace un POST, el servidor lo procesa, y la red se corta
antes de que llegue la respuesta. Para el cliente eso es indistinguible de un
fallo de red, así que encola y reenvía — y sin protección el reenvío duplicaba
la lectura de km, el documento o el evento de ITV, y desde GAP-2 **doblaba**
los litros del mes (`fuel-consumptions/add/` SUMA, no crea).

El contrato: el cliente genera un `client_ref` (UUID) al capturar el dato y lo
repite tal cual en cada reintento. El primer procesado guarda su respuesta en
`IdempotencyRecord` (unicidad por usuario+referencia) y los reenvíos devuelven
esa misma respuesta sin repetir el efecto. Sin `client_ref` no cambia nada:
el campo es opcional y los POST de siempre siguen igual.
"""

from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from .models import IdempotencyRecord

#: Nombre del campo en el body (JSON o multipart); los serializers lo ignoran.
CLIENT_REF_FIELD = "client_ref"
MAX_KEY_LENGTH = 64
#: Los reenvíos de la cola llegan en horas o días; 30 días cubre de sobra un
#: móvil que pasó semanas sin cobertura y mantiene la tabla pequeña (la purga
#: la hace cada escritura nueva, sin job aparte).
RETENTION = timedelta(days=30)


def run_idempotent(request, produce):
    """Ejecuta `produce()` (que devuelve una `Response`) UNA vez por `client_ref`.

    - Sin `client_ref` en el body: transparente, se ejecuta y ya.
    - Primera vez: el recibo se inserta ANTES de producir y EN LA MISMA
      transacción — dos reenvíos simultáneos chocan en la unicidad (el segundo
      espera al primero y relee su respuesta) y un error de validación revierte
      también el recibo, para no quemar la referencia con un 400.
    - Reenvío: se devuelve la respuesta guardada sin repetir el efecto.
    """
    key = str(request.data.get(CLIENT_REF_FIELD) or "").strip()
    if not key:
        return produce()
    if len(key) > MAX_KEY_LENGTH:
        raise ValidationError({CLIENT_REF_FIELD: "Referencia demasiado larga."})
    previous = IdempotencyRecord.objects.filter(user=request.user, key=key).first()
    if previous is not None:
        return Response(previous.response_data, status=previous.response_status)
    try:
        with transaction.atomic():
            record = IdempotencyRecord.objects.create(user=request.user, key=key, response_status=0)
            response = produce()
            record.response_status = response.status_code
            record.response_data = response.data
            record.save(update_fields=["response_status", "response_data"])
    except IntegrityError:
        # Perdimos la carrera contra otro reenvío idéntico: su recibo ya está
        # (o estará al confirmar su transacción) — releer y devolver lo suyo.
        previous = IdempotencyRecord.objects.filter(user=request.user, key=key).first()
        if previous is None:
            raise  # IntegrityError del propio produce(): no es nuestro caso.
        return Response(previous.response_data, status=previous.response_status)
    IdempotencyRecord.objects.filter(created_at__lt=timezone.now() - RETENTION).delete()
    return response


class IdempotentCreateMixin:
    """`create` idempotente por `client_ref` para los endpoints de la cola M7.

    Delante en el MRO del viewset: envuelve el `create` de DRF sin tocar
    permisos, scoping ni validación (todo eso corre dentro de `produce`).
    """

    def create(self, request, *args, **kwargs):
        parent_create = super().create
        return run_idempotent(request, lambda: parent_create(request, *args, **kwargs))
