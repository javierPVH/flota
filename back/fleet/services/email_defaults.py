"""Versión genérica de cada tipo de correo.

Hasta ahora, un tipo de correo sin plantilla en Ajustes caía a un «texto de
emergencia» escrito en el código (una línea con la matrícula y el mensaje de
la alerta), y las pestañas de Ajustes lo decían: «sin definir». Ahora **cada
tipo tiene su versión genérica**: un asunto y un cuerpo en castellano e
inglés, con las variables que ese tipo trae, dentro de la misma caja
corporativa que el resto (`email_layout.wrap`). Es lo que sale mientras la
administración no redacte la suya —la **personalizada**, que es la fila de
`EmailTemplate`— y lo que vuelve a salir si la retira (N7: la fila se
desactiva y el tipo vuelve a la genérica).

Viven aquí y no en un seed porque no son datos: son el valor por defecto del
sistema, igual en todas las instalaciones y sin migración para cambiarlo.
`template_for` las devuelve como un `EmailTemplate` **sin guardar**, para que
quien las use (`mailer`, la vista previa) no distinga entre una y otra: mismo
`parts(lang)`, mismo `has_en`, y sin firma.
"""

from __future__ import annotations

from fleet.models import EmailTemplate, EmailTemplateKey

_FIRMA = "<p>Gestión de flota</p>"
_SIGN = "<p>Fleet management</p>"

#: El enlace a la app de campo: `{{enlace_app}}` es `FLEET_DRIVERS_APP_URL`
#: y, sin configurar, `mailer.render` deja solo el texto.
_ENLACE = '<p><a href="{{enlace_app}}">Abrir la app</a></p>'
_LINK = '<p><a href="{{enlace_app}}">Open the field app</a></p>'


def _acordeon(titulo: str, pasos: list[str], nota: str = "") -> str:
    """Instrucciones plegadas (`<details>`): quien ya sabe no las lee, y el
    cliente de correo que no entiende el acordeón las enseña desplegadas."""
    lista = "".join(f"<li>{p}</li>" for p in pasos)
    cola = f"<p>{nota}</p>" if nota else ""
    return f"<details><summary>{titulo}</summary><ol>{lista}</ol>{cola}</details>"


DEFAULT_TEMPLATES: dict[str, dict[str, str]] = {
    EmailTemplateKey.INSURANCE_DUE: {
        "subject": "Renovación del seguro · {{matricula}}",
        "body_html": (
            "<p>Estimado equipo de {{empresa}}:</p>"
            "<p>La póliza del vehículo <strong>{{matricula}}</strong> vence el "
            "<strong>{{fecha_vencimiento}}</strong>. {{mensaje}}</p>"
            "<p>Os pedimos que gestionéis su renovación y nos hagáis llegar la "
            "nueva póliza para dejarla archivada en la ficha del vehículo.</p>"
            "<p>Gracias por vuestra colaboración.</p>" + _FIRMA
        ),
        "subject_en": "Insurance renewal · {{matricula}}",
        "body_html_en": (
            "<p>Dear {{empresa}} team,</p>"
            "<p>The policy of vehicle <strong>{{matricula}}</strong> expires on "
            "<strong>{{fecha_vencimiento}}</strong>. {{mensaje}}</p>"
            "<p>Please arrange its renewal and send us the new policy so we can "
            "file it with the vehicle.</p><p>Thank you for your help.</p>" + _SIGN
        ),
    },
    EmailTemplateKey.ITV_DUE: {
        "subject": "ITV próxima · {{matricula}}",
        "body_html": (
            "<p>Hola {{conductor}}:</p>"
            "<p>La ITV del vehículo <strong>{{matricula}}</strong> vence el "
            "<strong>{{fecha_vencimiento}}</strong>. {{mensaje}}</p>"
            "<p>Acude a la cita programada y registra el resultado desde la app "
            "de campo; si no tienes cita, avisa a la gestión de flota.</p>"
            + _ENLACE
            + _acordeon(
                "Cómo registrar la ITV",
                [
                    "Entra en la app de campo con tu usuario.",
                    "En «Mi vehículo», pulsa «ITV» (se activa desde 30 días antes de la cita).",
                    "Indica la fecha y el resultado, adjunta el informe y guarda.",
                ],
            )
            + _FIRMA
        ),
        "subject_en": "Upcoming roadworthiness test · {{matricula}}",
        "body_html_en": (
            "<p>Hello {{conductor}},</p>"
            "<p>The roadworthiness test (ITV) of vehicle <strong>{{matricula}}</strong> "
            "is due on <strong>{{fecha_vencimiento}}</strong>. {{mensaje}}</p>"
            "<p>Attend the scheduled appointment and record the result in the field "
            "app; if there is no appointment, contact fleet management.</p>"
            + _LINK
            + _acordeon(
                "How to record the test",
                [
                    "Sign in to the field app with your user.",
                    'In "My vehicle", tap "ITV" (available from 30 days before the appointment).',
                    "Enter the date and the result, attach the report and save.",
                ],
            )
            + _SIGN
        ),
    },
    EmailTemplateKey.STATE_NOTICE: {
        "subject": "Comunicado sobre el vehículo {{matricula}}",
        "body_html": (
            "<p>Hola {{conductor}}:</p>"
            "<p>Te informamos de lo siguiente sobre el vehículo "
            "<strong>{{matricula}}</strong>:</p><p>{{mensaje}}</p>"
            "<p>Si tienes cualquier duda, contacta con la gestión de flota.</p>" + _FIRMA
        ),
        "subject_en": "Notice about vehicle {{matricula}}",
        "body_html_en": (
            "<p>Hello {{conductor}},</p>"
            "<p>Please note the following about vehicle "
            "<strong>{{matricula}}</strong>:</p><p>{{mensaje}}</p>"
            "<p>If you have any questions, contact fleet management.</p>" + _SIGN
        ),
    },
    EmailTemplateKey.KM_OVERAGE: {
        "subject": "Aviso de kilometraje · {{matricula}}",
        "body_html": (
            "<p>Hola {{conductor}}:</p>"
            "<p>Al ritmo actual, el vehículo <strong>{{matricula}}</strong> superará "
            "los kilómetros contratados: la proyección es de "
            "<strong>{{km_exceso}} km</strong> de exceso. {{mensaje}}</p>"
            "<p>Te pedimos que moderes el uso del vehículo o que lo comentes con "
            "tu responsable para buscar una alternativa.</p>" + _FIRMA
        ),
        "subject_en": "Mileage notice · {{matricula}}",
        "body_html_en": (
            "<p>Hello {{conductor}},</p>"
            "<p>At the current pace, vehicle <strong>{{matricula}}</strong> will exceed "
            "the contracted mileage: the projection is <strong>{{km_exceso}} km</strong> "
            "over. {{mensaje}}</p>"
            "<p>Please moderate the use of the vehicle or discuss it with your "
            "manager to find an alternative.</p>" + _SIGN
        ),
    },
    EmailTemplateKey.KM_READING_PENDING: {
        "subject": "Falta tu lectura de km de {{periodo}} · {{matricula}}",
        "body_html": (
            "<p>Hola {{conductor}}:</p>"
            "<p>Todavía no tenemos la lectura de kilómetros de <strong>{{periodo}}</strong> "
            "del vehículo <strong>{{matricula}}</strong>. Lleva "
            "<strong>{{dias_sin_lectura}} días</strong> sin lectura; la última que "
            "consta es del {{ultima_lectura}}.</p>"
            "<p><strong>Mientras no la registres, seguirás recibiendo este "
            "correo.</strong> Solo tienes que anotar lo que marca el "
            "cuentakilómetros: te lleva un minuto.</p>"
            + _ENLACE
            + _acordeon(
                "Cómo registrar la lectura",
                [
                    "Entra en la app de campo con tu usuario.",
                    "En «Mi vehículo», pulsa «Kilómetros».",
                    "Escribe lo que marca el cuentakilómetros y guarda.",
                ],
                "Si el coche ya no es el tuyo o no puedes registrarla, avisa a la "
                "gestión de flota.",
            )
            + _FIRMA
        ),
        "subject_en": "Your {{periodo}} mileage reading is missing · {{matricula}}",
        "body_html_en": (
            "<p>Hello {{conductor}},</p>"
            "<p>We still do not have the <strong>{{periodo}}</strong> mileage reading of "
            "vehicle <strong>{{matricula}}</strong>. It has gone "
            "<strong>{{dias_sin_lectura}} days</strong> without a reading; the last one "
            "on record is from {{ultima_lectura}}.</p>"
            "<p><strong>You will keep receiving this email until you record "
            "it.</strong> Just note what the odometer shows: it takes a minute.</p>"
            + _LINK
            + _acordeon(
                "How to record the reading",
                [
                    "Sign in to the field app with your user.",
                    'In "My vehicle", tap "Mileage".',
                    "Type what the odometer shows and save.",
                ],
                "If the vehicle is no longer yours or you cannot record it, contact "
                "fleet management.",
            )
            + _SIGN
        ),
    },
    EmailTemplateKey.GENERIC: {
        "subject": "Aviso de la flota · {{matricula}}",
        "body_html": (
            "<p>Hola {{conductor}}:</p>"
            "<p>Aviso sobre el vehículo <strong>{{matricula}}</strong>:</p>"
            "<p>{{mensaje}}</p>"
            "<p>Si tienes cualquier duda, contacta con la gestión de flota.</p>" + _FIRMA
        ),
        "subject_en": "Fleet notice · {{matricula}}",
        "body_html_en": (
            "<p>Hello {{conductor}},</p>"
            "<p>Notice about vehicle <strong>{{matricula}}</strong>:</p>"
            "<p>{{mensaje}}</p>"
            "<p>If you have any questions, contact fleet management.</p>" + _SIGN
        ),
    },
}


def template_for(key: str) -> EmailTemplate:
    """La versión genérica de ese tipo, como `EmailTemplate` SIN guardar.

    Un tipo desconocido cae a la genérica de todo (`GENERIC`), que es el
    último recurso para cualquier aviso.
    """
    datos = DEFAULT_TEMPLATES.get(key) or DEFAULT_TEMPLATES[EmailTemplateKey.GENERIC]
    return EmailTemplate(
        key=key if key in DEFAULT_TEMPLATES else EmailTemplateKey.GENERIC,
        subject=datos["subject"],
        body_html=datos["body_html"],
        subject_en=datos["subject_en"],
        body_html_en=datos["body_html_en"],
    )


def as_rows() -> list[dict[str, str]]:
    """Las seis genéricas, para la API (`/email-templates/defaults/`)."""
    return [
        {
            "key": key,
            "key_display": EmailTemplateKey(key).label,
            **datos,
        }
        for key, datos in DEFAULT_TEMPLATES.items()
    ]
