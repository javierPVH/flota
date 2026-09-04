"""R3-34 — Recibo de idempotencia de las escrituras de campo (cola offline M7).

La PWA de conductores reenvía las escrituras que fallaron por red. Si la red se
corta DESPUÉS de que el servidor procese el POST (la respuesta se pierde por el
camino), el cliente no puede distinguirlo de un fallo real y lo reenvía: sin
protección quedaban dos lecturas de km, dos documentos, dos eventos de ITV — y,
desde GAP-2, litros e importe DOBLADOS (`fuel-consumptions/add/` SUMA al mes).

El cliente genera una referencia única (`client_ref`) al capturar el dato y la
repite en cada reintento; el primer procesado deja aquí su respuesta y los
reenvíos la devuelven tal cual, sin repetir el efecto. Es un recibo técnico,
no un dato de negocio: no se audita, no pasa por erratas (N7) y caduca solo
(`fleet.idempotency.RETENTION`).
"""

from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.db import models


class IdempotencyRecord(models.Model):
    """Respuesta ya emitida para un `client_ref` de un usuario."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="idempotency_records",
        verbose_name="Usuario",
    )
    #: La referencia que generó el cliente al capturar el dato (UUID en la PWA).
    key = models.CharField("Referencia del cliente", max_length=64)
    response_status = models.PositiveSmallIntegerField("Código de la respuesta")
    # DjangoJSONEncoder: si una respuesta trae Decimal/fechas crudos, se
    # serializan en vez de reventar el guardado del recibo.
    response_data = models.JSONField(
        "Cuerpo de la respuesta", null=True, blank=True, encoder=DjangoJSONEncoder
    )
    # Indexado: la purga por antigüedad barre por esta columna.
    created_at = models.DateTimeField("Creado", auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "recibo de idempotencia"
        verbose_name_plural = "recibos de idempotencia"
        constraints = [
            # La unicidad es POR USUARIO: dos clientes no pueden pisarse la
            # referencia, y es lo que convierte el reenvío en una relectura.
            models.UniqueConstraint(fields=["user", "key"], name="uniq_idempotency_user_key"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.key} → {self.response_status}"
