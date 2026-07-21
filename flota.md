Introducción
Este documento recoge las historias de usuario de la aplicación de gestión de flotas, organizadas por épicas. 
Cada historia sigue el formato “Como [perfil], quiero [acción], para [beneficio]” e incluye sus criterios de aceptación.
Las historias se derivan de los procesos actuales documentados (As-Is), del diseño de pantallas y del modelo de datos definido para la aplicación.
Perfiles
Administrador / Gestor de flota: gestiona la totalidad de la flota, los vehículos, las asignaciones, los costes y las incidencias.
Supervisor de flota: responsable de un grupo de vehículos (no de toda la flota). Sobre su grupo hace lo mismo que el conductor y, además, asigna el porcentaje de uso entre personas.
Usuario / Conductor: consulta el vehículo que tiene asignado y aporta información (kilómetros mensuales, propuestas de fechas, ITV).

Los perfiles no son excluyentes: una misma persona puede acumular varios. En particular, un supervisor de flota puede ser además conductor de un vehículo.
La autorización de las solicitudes de vehículo la realiza el manager del solicitante, pero esa aprobación ocurre fuera de la aplicación (en Jira); por eso el manager no es un perfil de la aplicación. La solicitud entra en el sistema ya aprobada.
Mapa de épicas
El trabajo se organiza en diez épicas. Este documento detalla las dos primeras y la de documentación.
Épica 1 — Gestión de vehículos 
Épica 2 — Asignación y conductores
Épica 3 — Kilometraje y uso
Épica 4 — Documentación
Épica 5 — ITV
Épica 6 — Mantenimiento e incidencias
Épica 7 — Costes y facturación
Épica 8 — Solicitud de vehículo
Épica 9 — Integraciones (Jira, Drive)
Épica 10 — Alertas e informes
Conceptos de modelo relevantes
Tres atributos independientes describen cada vehículo, y no deben confundirse entre sí:
Estado técnico: condición operativa del vehículo (alta/activo, en mantenimiento, ITV, averiado, baja).
Rol de sustitución: indica si el vehículo actúa como vehículo de sustitución (sí/no), con independencia de su estado técnico.
Situación de asignación: indica si el vehículo tiene conductor asignado o no.

Además, los vehículos pueden vincularse entre sí mediante una relación principal ↔ sustitución, con un motivo (avería, mantenimiento, ITV o accidente) y un periodo de vigencia. Un vehículo principal solo puede tener un vehículo de sustitución activo a la vez.
Cada vehículo puede tener asignado, opcionalmente, un supervisor de flota responsable. Un supervisor puede ser responsable de varios vehículos, pero no todos los vehículos tienen supervisor (el campo es opcional). El supervisor puede, sobre su grupo, realizar las mismas acciones que el conductor y, además, asignar el reparto de uso entre personas.






















Épica 1 · Gestión de vehículos
Cubre el ciclo de vida del vehículo dentro de la aplicación: alta, consulta, edición, estados, vinculación y baja. Es el núcleo del trabajo del administrador.

HU-1.1  Ver el listado de la flota
Como administrador, quiero ver el listado de todos los vehículos con sus datos clave, para tener una visión general del estado de la flota.
Criterios de aceptación
El listado muestra, por vehículo: matrícula, marca/modelo, estado, uso, conductor asignado y fecha de próxima ITV.
Permite buscar por matrícula, marca o nombre de conductor.
Permite filtrar por uso (personal/obra), por estado técnico y por situación de asignación.
Cada fila da acceso a la ficha de detalle del vehículo.
Los vehículos en estado “baja” no aparecen en la vista activa por defecto, pero pueden mostrarse con un filtro.


HU-1.2  Consultar la ficha de un vehículo
Como administrador, quiero abrir la ficha completa de un vehículo, para consultar toda su información en un solo lugar.
Criterios de aceptación
La ficha muestra datos técnicos, datos de contrato, kilometraje e histórico de eventos.
Muestra métricas clave: coste mensual, kilometraje actual y fecha de próxima ITV.
Muestra el conductor asignado y, si el vehículo está vinculado, su vehículo principal o de sustitución.
Ofrece accesos directos a las acciones: editar, registrar km, refacturar y cambiar conductor.
Muestra el estado técnico, el rol de sustitución y la situación de asignación de forma diferenciada.


HU-1.3  Dar de alta un vehículo
Como administrador, quiero dar de alta un vehículo nuevo, para incorporarlo a la flota.
Criterios de aceptación
El formulario recoge datos técnicos, tipo de uso, datos de contrato y CECO de imputación.
Si el uso es “obra”, el proyecto asociado es obligatorio; en otro caso no se solicita.
Al guardar, se crea el vehículo junto con su contrato y su primera lectura de kilómetros.
El alta queda registrada como un evento en el histórico del vehículo.
El vehículo se crea con estado “alta” y situación “sin asignar” salvo que se asigne conductor en el alta.
La operación se realiza en una única transacción: si algún dato obligatorio falta, no se crea nada.


HU-1.4  Editar los datos de un vehículo
Como administrador, quiero modificar los datos de un vehículo, para mantener la información actualizada.
Criterios de aceptación
Se pueden editar los campos de gestión interna: uso, proyecto, CECO y conductor.
Cada cambio relevante (cuota, proyecto, CECO, ubicación) genera un evento en el histórico.
Antes de guardar, se muestran los cambios que quedarán registrados en el histórico.
No se permite dejar en blanco campos obligatorios.


HU-1.5  Dar de baja un vehículo
Como administrador, quiero dar de baja un vehículo, para reflejar que sale de la flota.
Criterios de aceptación
La baja solicita fecha y motivo.
El vehículo pasa a estado “baja” pero conserva íntegro su histórico.
La baja queda registrada como un evento en el histórico.
Un vehículo en baja no admite nuevas operaciones (asignaciones, km, etc.) pero es consultable.
Si el vehículo tenía conductor asignado o vínculos activos, se avisa antes de completar la baja.


HU-1.6  Gestionar el estado del vehículo
Como administrador, quiero que cada vehículo tenga un estado técnico definido, para conocer su situación operativa en todo momento.
Criterios de aceptación
El estado técnico es uno de una lista cerrada: alta/activo, en mantenimiento, ITV, averiado, baja.
El estado se muestra en el listado y en la ficha con un color distintivo.
Cada cambio de estado queda registrado en el histórico con su fecha.
Ciertos cambios de estado se disparan automáticamente desde otros procesos (p. ej. “en mantenimiento” al abrir un mantenimiento, “averiado” al registrar una avería).
El estado técnico es independiente del rol de sustitución y de la situación de asignación.


HU-1.7  Conocer la situación de asignación
Como administrador, quiero ver si un vehículo tiene conductor asignado o no, para detectar vehículos disponibles o sin uso.
Criterios de aceptación
La situación de asignación es un atributo independiente del estado técnico (asignado / sin asignar).
Se muestra en el listado y permite filtrar por ella.
Un vehículo sin conductor asignado durante un periodo configurable genera una alerta.
Al asignar o retirar un conductor, la situación se actualiza automáticamente.


HU-1.8  Vincular vehículo principal y de sustitución
Como administrador, quiero vincular un vehículo de sustitución a su vehículo principal, para saber en todo momento qué vehículo cubre a cuál y durante cuánto tiempo.
Criterios de aceptación
Se puede establecer una relación entre un vehículo principal y uno de sustitución, con fecha de inicio y de fin.
La vinculación registra el motivo: avería, mantenimiento, ITV o accidente.
Desde la ficha del vehículo principal se ve cuál es su vehículo de sustitución activo, y viceversa.
Un vehículo principal solo puede tener un vehículo de sustitución activo a la vez.
Al terminar (devolución del vehículo de sustitución), la vinculación se cierra con su fecha de fin.
El histórico conserva las vinculaciones pasadas de cada vehículo.


Épica 2 · Asignación y conductores
Cubre la relación entre vehículos y personas: asignaciones, cambios de conductor, el flujo de propuesta y confirmación de fechas, el reparto de uso y la gestión de los conductores.

HU-2.1  Asignar un conductor a un vehículo
Como administrador, quiero asignar un conductor a un vehículo, para dejar constancia de quién lo utiliza.
Criterios de aceptación
El conductor se selecciona de la lista de personas dadas de alta.
La asignación registra la fecha de inicio.
Al confirmarse, la situación del vehículo pasa a “asignado” y se cierra la asignación anterior si la había.
Queda registrado el evento de cambio de conductor en el histórico.
No se puede asignar un conductor a un vehículo en estado “baja”.


HU-2.2  Cambiar el conductor de un vehículo
Como administrador, quiero cambiar el conductor asignado, para reflejar reasignaciones.
Criterios de aceptación
Al cambiar, la asignación anterior se cierra con su fecha de fin y se abre la nueva.
El histórico conserva todas las asignaciones del vehículo.
Se registra el evento con el conductor anterior y el nuevo.
Se puede consultar el histórico completo de conductores de un vehículo.


HU-2.3  Proponer fechas de uso del vehículo
Como usuario, quiero proponer las fechas desde cuándo tengo el vehículo y hasta cuándo, para que el administrador las confirme y queden registradas.
Criterios de aceptación
El usuario introduce fecha de inicio y, opcionalmente, fecha de fin.
La fecha de fin no puede ser anterior a la de inicio.
La propuesta queda en estado “propuesta” sin alterar la asignación vigente.
El administrador recibe la propuesta en una bandeja de pendientes.
El usuario ve claramente que su propuesta está pendiente de confirmación.


HU-2.4  Confirmar o rechazar una propuesta de fechas
Como administrador, quiero revisar las propuestas de fechas de los usuarios, para confirmarlas o rechazarlas manteniendo el control de la asignación.
Criterios de aceptación
Existe una bandeja con las propuestas de fechas pendientes de revisión.
Al confirmar, las fechas pasan a la asignación oficial y se registra el evento correspondiente.
Al rechazar, la propuesta se marca como rechazada y la asignación vigente no cambia.
El usuario es informado del resultado tanto si se confirma como si se rechaza.


HU-2.5  Repartir el uso de un vehículo entre varias personas
Como administrador o supervisor de flota, quiero repartir el uso de un vehículo entre varias personas por porcentaje, para imputar correctamente su coste cuando lo comparten.
Criterios de aceptación
Se pueden añadir varias personas, cada una con un porcentaje de uso.
La suma de los porcentajes debe ser exactamente 100.
Cada reparto tiene un periodo de vigencia (fecha de inicio y de fin).
El reparto se utiliza como base para la refacturación de costes del vehículo.
El supervisor solo puede hacerlo sobre los vehículos de su grupo; el administrador sobre cualquiera.
Se conserva el histórico de repartos anteriores.


HU-2.6  Gestionar los conductores
Como administrador, quiero mantener la lista de conductores, para disponer de sus datos al asignar vehículos.
Criterios de aceptación
Se puede dar de alta, editar y desactivar conductores.
Cada conductor tiene nombre, DNI, datos de contacto, tipo de permiso y si dispone de tarjeta de combustible.
Un conductor desactivado no aparece en las listas de asignación, pero conserva su histórico.
Se puede consultar qué vehículos ha tenido asignados un conductor a lo largo del tiempo.


HU-2.7  Asignar un supervisor a los vehículos
Como administrador, quiero asignar un supervisor de flota responsable a un vehículo, para delegar la gestión de grupos de vehículos.
Criterios de aceptación
Se puede asignar, cambiar o retirar el supervisor responsable de un vehículo.
El supervisor es opcional: un vehículo puede no tener supervisor asignado.
Un mismo supervisor puede ser responsable de varios vehículos.
Al asignar un supervisor, ese vehículo pasa a formar parte de su grupo y aparece en sus vistas.
Se puede consultar el grupo de vehículos de cada supervisor.


HU-2.8  Gestionar el grupo de vehículos (supervisor)
Como supervisor de flota, quiero ver y gestionar los vehículos de los que soy responsable, para hacer el seguimiento de mi grupo sin acceder a toda la flota.
Criterios de aceptación
El supervisor ve únicamente los vehículos de su grupo, no toda la flota.
Sobre su grupo puede realizar las mismas acciones que el conductor (consultar datos, registrar km, registrar ITV, proponer fechas).
Además, puede asignar el reparto de uso por porcentaje de los vehículos de su grupo.
Ve las métricas y alertas agregadas de su grupo (ITV próximas, km, vehículos sin conductor).
No puede dar de alta ni de baja vehículos, ni acceder a vehículos fuera de su grupo.

















Épica 3 · Kilometraje y uso
Cubre el ciclo del kilometraje: la recogida mensual, el registro por parte del usuario, la validación de las lecturas, la proyección frente a los kilómetros contratados y las alertas de exceso. Se apoya en la lectura del odómetro acumulado, de la que se derivan los kilómetros de cada periodo

HU-3.1  Registrar la lectura mensual de km
Como usuario, quiero registrar la lectura de kilómetros de mi vehículo, para mantener actualizado su kilometraje.
Criterios de aceptación
Introduzco el odómetro acumulado, no los kilómetros del mes.
El sistema calcula automáticamente los kilómetros del periodo como diferencia con la lectura anterior.
La lectura debe ser mayor que la anterior: el odómetro no puede retroceder.
Veo la última lectura registrada como referencia.
Al guardar, veo la confirmación con los kilómetros recorridos en el periodo.
La validación de no retroceso se aplica también en el servidor, no solo en el formulario.



HU-3.2  Recibir la alerta mensual de km
Como usuario, quiero recibir cada mes un aviso para registrar mis kilómetros, para no olvidarme de hacerlo.
Criterios de aceptación
El sistema envía mensualmente la alerta a los usuarios con vehículo asignado.
El aviso enlaza directamente al formulario de registro de kilómetros.
Si no se registra, el vehículo aparece como “lectura pendiente”.
El usuario deja de recibir el aviso una vez registrada la lectura del mes.


HU-3.3  Ver los vehículos con lectura pendiente
Como administrador, quiero ver qué vehículos no han registrado los km del mes, para reclamar las lecturas que faltan.
Criterios de aceptación
Existe una alerta o listado de vehículos con lectura pendiente del periodo.
Se puede filtrar por supervisor o grupo de vehículos.
Muestra desde cuándo está pendiente cada lectura.
Desde el listado se accede a la ficha del vehículo.




HU-3.4  Consultar la proyección de km contratados
Como administrador o supervisor de flota, quiero ver la proyección de kilómetros frente a los contratados, para anticipar excesos o infrautilización.
Criterios de aceptación
La ficha muestra los kilómetros consumidos, los contratados y los restantes.
Calcula la media mensual de uso y el ritmo contratado.
Proyecta si el vehículo terminará por encima o por debajo del límite al fin del contrato.
Muestra el resultado en verde (dentro de lo contratado) o en rojo (exceso previsto).
El supervisor solo ve la proyección de los vehículos de su grupo.



HU-3.5  Recibir alertas de exceso de km
Como administrador, quiero que el sistema me avise cuando un vehículo vaya camino de superar los km contratados, para tomar medidas antes de incurrir en penalización.
Criterios de aceptación
El sistema recalcula la proyección con cada nueva lectura de kilómetros.
Si la proyección supera los kilómetros contratados, genera una alerta en el panel.
La alerta indica el exceso previsto en kilómetros.
La alerta enlaza a la ficha del vehículo afectado.



HU-3.6  Consultar el histórico de kilometraje
Como administrador o supervisor de flota, quiero consultar el histórico de lecturas de un vehículo, para analizar su evolución.
Criterios de aceptación
Se ven todas las lecturas con su fecha y los kilómetros del periodo.
Se puede visualizar la evolución del kilometraje a lo largo del tiempo.
Los kilómetros del periodo se derivan de las diferencias entre lecturas consecutivas.


Épica 4 · Documentación
Cubre la subida, el archivado y la consulta de la documentación de los vehículos. Los documentos pueden ir ligados a una incidencia (acta de entrega o devolución, parte de accidente, fotos de daños) o ser documentos generales del vehículo (permiso de circulación, ficha técnica, seguro, contrato). El sistema los archiva automáticamente en Google Drive y los enlaza al vehículo.

HU-4.1  Subir documentación del vehículo
Como conductor, quiero subir documentación de mi vehículo desde la aplicación, para no tener que enviarla por correo y que quede archivada automáticamente.
Criterios de aceptación
Puedo subir documentos generales del vehículo o documentos ligados a una incidencia concreta (acta, parte, fotos de daños).
Indico el tipo de documento al subirlo.
Al subirlo, el sistema lo archiva automáticamente en Drive y lo enlaza al vehículo (y a la incidencia si aplica).
Veo la confirmación de que el documento se ha subido correctamente.
Los documentos que subo quedan visibles para el gestor y el supervisor del vehículo.


HU-4.2  Archivar automáticamente en Drive
Como sistema, quiero archivar automáticamente en Drive los documentos que se suben, para mantener el repositorio organizado sin intervención manual.
Criterios de aceptación
Al subir un documento, se guarda en la carpeta del vehículo correspondiente en Drive.
Se registra la URL de Drive en el documento, enlazada al vehículo.
Si el vehículo no tiene carpeta en Drive, el sistema la crea automáticamente.
El archivado no requiere ninguna acción del gestor.
Si el archivado falla, el documento queda marcado como pendiente de archivar y se avisa.


HU-4.3  Consultar la documentación de un vehículo
Como administrador o supervisor de flota, quiero consultar todos los documentos de un vehículo, para acceder a su documentación sin buscar en el correo o en Drive.
Criterios de aceptación
Desde la ficha del vehículo se ven todos sus documentos, con su tipo y fecha de subida.
Cada documento indica quién lo subió y si está ligado a una incidencia.
Se puede abrir cada documento directamente (enlace a Drive).
Se pueden filtrar los documentos por tipo.
Los documentos con fecha de caducidad (seguro, permiso, ITV) muestran dicha fecha.


HU-4.4  Gestionar la documentación (administrador)
Como administrador, quiero subir, sustituir o eliminar documentos de un vehículo, para mantener la documentación correcta y actualizada.
Criterios de aceptación
El administrador puede subir documentos de cualquier vehículo, igual que el conductor.
Puede sustituir un documento por una versión actualizada, conservando el registro del anterior.
Puede marcar un documento como caducado o vigente.
Toda subida o sustitución queda registrada con su autor y fecha.
La eliminación de un documento queda registrada y requiere confirmación.
















Épica 5 · ITV
Cubre el control de las inspecciones técnicas: el aviso anticipado de vencimientos, el registro de resultados y el seguimiento del ciclo de ITV. Automatiza la vigilancia de fechas que hoy se hace manualmente sobre el Excel.

HU-5.1  Avisar de ITV próximas a vencer
Como administrador, quiero que el sistema me avise de las ITV próximas a vencer, para gestionarlas a tiempo y evitar que un vehículo circule con la ITV caducada.
Criterios de aceptación
El sistema comprueba a diario las fechas de próxima ITV de todos los vehículos activos.
Genera avisos escalonados cuando faltan 30, 15 y 7 días para el vencimiento.
Los avisos aparecen en el panel de alertas de la aplicación.
Cada aviso identifica el vehículo (matrícula y modelo) y los días que faltan para el vencimiento.
Si la ITV vence sin registrarse, el aviso pasa a estado “vencida” y se resalta con prioridad.
Al registrar una ITV con nueva fecha, los avisos asociados se cierran automáticamente.
Desde el aviso se puede acceder directamente a la ficha del vehículo.


