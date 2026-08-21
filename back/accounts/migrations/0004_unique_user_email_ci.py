"""A5 — el email pasa a ser único (ignorando mayúsculas) cuando está informado.

El email es clave de identidad en el login por email, en el login con Google y
en la resolución del solicitante de Jira, y los tres resuelven con
`filter(email__iexact=...).first()`: con dos cuentas del mismo email se entraba
en una arbitraria.

Antes de crear la constraint se comprueba que no haya duplicados y, si los hay,
se ABORTA con la lista concreta: es una decisión de negocio (qué cuenta es la
buena) que no puede tomar una migración.
"""

import django.db.models.functions.text
from django.db import migrations, models
from django.db.models import Count
from django.db.models.functions import Lower


def check_no_duplicate_emails(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    duplicates = (
        User.objects.exclude(email="")
        .annotate(lowered=Lower("email"))
        .values("lowered")
        .annotate(total=Count("id"))
        .filter(total__gt=1)
        .order_by("-total")
    )
    if not duplicates:
        return
    detalle = ", ".join(f"{row['lowered']} ({row['total']} cuentas)" for row in duplicates)
    raise RuntimeError(
        "A5: hay emails repetidos y no se puede aplicar la unicidad. "
        "Decide qué cuenta conserva cada email (y vacía el resto) antes de "
        f"migrar. Duplicados: {detalle}"
    )


def noop(apps, schema_editor):
    """Nada que deshacer: la comprobación no modifica datos."""


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0003_pushsubscription"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.RunPython(check_no_duplicate_emails, noop),
        migrations.AddConstraint(
            model_name="user",
            constraint=models.UniqueConstraint(
                django.db.models.functions.text.Lower("email"),
                condition=models.Q(("email", ""), _negated=True),
                name="unique_user_email_ci",
            ),
        ),
    ]
