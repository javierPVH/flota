"""Quita el DNI de la ficha de usuario.

Deja de ser un dato que la aplicación tenga que reflejar, así que se elimina por
**minimización** (art. 5.1.c del RGPD): el dato que no se guarda no se filtra,
no hay que custodiarlo y no hay que borrarlo después.

**Esto borra datos y no tiene vuelta atrás.** El `reverse` de un `RemoveField`
recrea la columna, pero vacía: los valores no vuelven. Tras aplicarla, el DNI
solo existirá en las copias de seguridad de Postgres, hasta que caduquen por su
propia política.

Va DESPUÉS de `fleet/0077`, que limpia las copias del DNI que vivían fuera de
esta columna (las peticiones de corregir ficha, el histórico de auditoría y el
rastro de exportaciones). El orden no es funcional —aquel barrido no lee esta
columna— pero sí tiene que ser determinista.
"""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0007_usersession"),
        ("fleet", "0077_limpiar_copias_del_dni"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="user",
            name="dni",
        ),
    ]
