from django.db import migrations, models


class Migration(migrations.Migration):
    """Versión inglesa (opcional) de cada plantilla de correo."""

    dependencies = [("fleet", "0020_contract_drive_url")]

    operations = [
        migrations.AddField(
            model_name="emailtemplate",
            name="subject_en",
            field=models.CharField(blank=True, max_length=200, verbose_name="Asunto (EN)"),
        ),
        migrations.AddField(
            model_name="emailtemplate",
            name="body_html_en",
            field=models.TextField(
                blank=True,
                help_text="Versión inglesa. Vacía = se usa la castellana.",
                verbose_name="Cuerpo EN (HTML)",
            ),
        ),
    ]
