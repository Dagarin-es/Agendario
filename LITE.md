# Agendario Lite

Plan de la edición **Lite** (decidida por Daniel el 27-11-2026). **No se genera hasta que Daniel diga que toca esta versión.** Es la que se presentará en **Google Play**.

## Nombres

- **Agendario Lite**: la de esta hoja.
- **Agendario** (a secas): la de siempre, con servidor propio, web y registro de llamadas. Quien quiera todo, pasa a esta.

## Idea básica

- **Solo app Android**. Sin versión web (ni con ni sin servidor).
- **Un solo móvil**: los datos viven en el móvil (base de datos local, funciona sin conexión).
- **Google Drive como copia, no como sincronización**: copia automática en la carpeta privada de la app en Drive (appDataFolder, permiso `drive.appdata`; comprobar su clasificación en Google al hacerlo). Si se cambia de móvil, se restaura desde Drive y el móvil antiguo deja de copiar (marca de «dispositivo dueño» en Drive; al restaurar en otro, se avisa y el anterior queda fuera). Nunca escriben dos dispositivos a la vez: sin conflictos.
- **Copia siempre cifrada**, sin opción de no cifrar: contraseña obligatoria al activar la copia (age, como en la edición con servidor). Avisar con claridad de que, si se olvida, la copia no se puede recuperar; valorar un código de recuperación que se guarde aparte.

## Se mantiene (todo local)

Contactos, etiquetas (con subetiquetas y colores), favoritos, fechas y calendario, efemérides, regalos (ideas, regalados con valoración y anotación, recibidos con foto; lo de la versión con las tres pestañas), apuntes (sin llamadas), recordatorios con aviso en el móvil (alarmas locales), duplicados y combinar, historial, papelera, temas e iconos, exportar/importar .vcf, miniaturas de los enlaces de regalos (descargadas desde la propia app).

## Se quita

- Usuarios, inicio de sesión y compartir contactos (una persona, un móvil, sin contraseña de la app).
- Gmail, Fastmail y Todoist (escriben en servicios de fuera; el permiso de contactos de Google exige verificación pesada).
- Servidor CardDAV, enlace de calendario .ics y contraseñas de aplicación.
- Copias a NAS (NFS/SMB) y a Drive con rclone: las sustituye la copia cifrada en Drive.
- Registro de llamadas y todo lo que cuelga de él: burbuja durante la llamada, aviso al colgar, números desconocidos, notas por Android Auto, adjuntos de llamada. Sin permisos `READ_CALL_LOG`, `PROCESS_OUTGOING_CALLS`, `SYSTEM_ALERT_WINDOW` ni servicio en primer plano `specialUse`.

## Se añade

- **«Pasar a Agendario»**: exportar todo en un fichero que el servidor importe tal cual (contactos, fotos, fechas, regalos, apuntes, recordatorios…), para cambiar a la edición completa sin perder nada.

## Técnica (a valorar al empezar)

- Reaprovechar el código del servidor con **PGlite** (Postgres dentro de la app) + Drizzle, o SQLite nativo. Decidir con una prueba antes de empezar.
- Mismo repositorio, otra variante de compilación (otro `applicationId`, p. ej. `es.dagarin.agendario.lite`, para poder tener las dos instaladas); firma con la misma clave por GitHub Actions.
- Revisar qué permisos quedan (notificaciones, alarmas exactas para los recordatorios) y justificar cada uno en Play.

## Google Play

- La revisión de Google Play se plantea **con la Lite**. Lo apuntado en `PENDIENTES.md` («Revisión en Google Play») sobre el formulario de permisos de llamadas, el vídeo de llamadas y el usuario de demostración en el servidor **ya no aplica**: se rehará para la Lite (ficha de la tienda, seguridad de los datos, privacidad con Drive, capturas).
