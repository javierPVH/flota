"""Los envíos programados van solo en CSV y solo a las direcciones escritas.

Dos cambios de comportamiento, y por eso los datos existentes se ajustan aquí:

* El formato pasa a ser CSV único (un mismo informe llegaba en Excel o en CSV
  según quién lo hubiera programado). Los que estaban en `xlsx` se reetiquetan.
* El correo del dueño ya no se añade por su cuenta al reparto. Los envíos que
  contaban con eso —campo de destinatarios vacío— se quedarían sin nadie a quien
  mandar, así que se les escribe la dirección del dueño: siguen llegando igual
  y ahora se ve en la pantalla a quién van.
"""

from django.db import migrations, models


def csv_y_destinatario_explicito(apps, schema_editor):
    NotificationSchedule = apps.get_model("fleet", "NotificationSchedule")
    NotificationSchedule.objects.filter(fmt="xlsx").update(fmt="csv")
    # `update` con F() no vale: el correo está en la tabla de usuarios.
    pendientes = NotificationSchedule.objects.filter(
        send_email=True, extra_recipients=""
    ).select_related("user")
    for schedule in pendientes:
        correo = (schedule.user.email or "").strip()
        if correo:
            schedule.extra_recipients = correo
            schedule.save(update_fields=["extra_recipients"])


def noop_reverse(apps, schema_editor):
    """Sin marcha atrás: qué envíos eran Excel o tenían el campo vacío ya no consta."""


class Migration(migrations.Migration):
    dependencies = [
        ("fleet", "0030_notificationschedule_filters_and_more"),
    ]

    operations = [
        migrations.RunPython(csv_y_destinatario_explicito, noop_reverse),
        migrations.AlterField(
            model_name="notificationschedule",
            name="extra_recipients",
            field=models.CharField(
                blank=True,
                help_text=(
                    "Direcciones separadas por comas. Son las únicas que reciben el envío: "
                    "la del usuario no se añade por su cuenta, se prellena en el formulario."
                ),
                max_length=500,
                verbose_name="Destinatarios",
            ),
        ),
        migrations.AlterField(
            model_name="notificationschedule",
            name="fmt",
            field=models.CharField(
                choices=[("csv", "CSV")],
                default="csv",
                help_text="Los informes se envían en CSV; el resumen va en el cuerpo del correo.",
                max_length=5,
                verbose_name="Formato",
            ),
        ),
    ]
