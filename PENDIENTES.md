# Pendiente para la próxima versión

Aquí se apunta lo que Daniel va pidiendo. No se genera nada hasta que diga «genera»; al generar, se borra de aquí lo hecho (el detalle técnico queda en `CLAUDE.md` y el resumen en `CHANGELOG.md`).

## Para la próxima versión

### Fechas y Regalos (móvil)
- **Fechas: selector «Eventos / Efemérides» siempre arriba en el móvil** (fijo al hacer scroll, con el fondo de la app, como `.list-sticky`). Está en `pages/Upcoming.tsx`.
- **Emoji en cada opción también en el móvil**: cambiar los actuales (🎂/📔) por **🎉 Eventos** y **📜 Efemérides** (elegidos por Daniel) y mostrarlos siempre: ahora en pantallas pequeñas se ocultan (`hidden sm:inline`). Cambiar también el 📔 de la tarjeta de efeméride en Eventos (`{e.emoji} Efeméride` usa el emoji de cada una: dejarlo) y revisar si hay más sitios con 📔 como icono de la sección.
- **Regalos: botones «🎁 Para regalar» y «🎀 Recibidos» siempre arriba** en el móvil (fijos al hacer scroll). Están en `pages/Gifts.tsx`.
- **Nueva pestaña «Regalados»** en Regalos, junto a las otras dos: lo que Daniel ya ha regalado (ideas con estado `given`): a quién, qué, día del regalo (`givenAt`) y evento (`eventDate`/etiqueta), de lo más reciente a lo más antiguo, con buscador como en Recibidos. Los datos ya existen: no hace falta migración, como mucho una ruta para listarlos.

## Revisión en Google Play (cuando Daniel diga)

- **Organizar una revisión en Google Play (prueba interna)**, para instalar y actualizar la app desde Play Store sin el aviso de «app no fiable». Se intenta **una sola vez**: si Google la rechaza, no se insiste y se sigue con la APK (el registro de desarrollador ya cubre la instalación en 2027). Más adelante, cuando esté más terminada, se valorará una **versión Lite sin llamadas** para Play (de momento no).
  - **Compilación para Play**: GitHub Actions genera también el AAB firmado con la misma clave (secretos de siempre) y lo deja en la Release (o lo sube a la pista de prueba interna con la API de Play Console, si es sencillo y seguro: credenciales solo como secreto de GitHub). Revisar Play App Signing para conservar la clave actual (`BE:1E:…:09:75`) y no obligar a desinstalar.
  - **Formulario de declaración de permisos** (`READ_CALL_LOG`, `PROCESS_OUTGOING_CALLS`): redactarlo enfocado al uso como **CRM de negocio** (excepción «Enterprise archive, business & enterprise CRM»): el registro de llamadas y las notas en la ficha de cada contacto son la función principal. Repasar también lo que pida Play para `SYSTEM_ALERT_WINDOW`, el servicio en primer plano `specialUse`, `SCHEDULE_EXACT_ALARM` y `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, la ficha de la tienda, la seguridad de los datos y la política de privacidad (dagarin.es/agendario/privacidad).
  - **Vídeo de demostración** (obligatorio, YouTube oculto, 1–2 min): guion para Daniel (llamada → aviso al colgar → nota → ficha con la llamada; número desconocido → guardarlo). Daniel lo graba con la app en castellano y **sin hablar** (solo grabación de pantalla); Claude le prepara el guion con los tiempos y, con el vídeo que le pase, le añade **subtítulos en inglés** (grabados en la imagen con ffmpeg, y también un .srt para YouTube). Sin doblaje.
  - **En inglés para los revisores**: el formulario de declaración de permisos, las instrucciones de acceso del usuario de demostración y la ficha de la tienda (además de la ficha en castellano). La app sigue en castellano (traducirla entera se descarta de momento: mucho trabajo y no decide la aprobación).
  - **Acceso para los revisores**: usuario de demostración en su servidor (accesible desde internet) con contactos inventados y sin ver nada real (ojo a los contactos públicos/compartidos); instrucciones de acceso para el formulario. Mantenerlo mientras dure la revisión.
  - Lista de testers de la prueba interna (por email) y pasos para que Daniel instale desde el enlace de invitación.

## Más adelante / tareas de Daniel

- **Norma fija**: cada versión lleva su entrada en `CHANGELOG.md` (lo que se ve en «Changelog»), apuntando ahí todos los cambios de la versión.
- Verificación de desarrollador Android: **hecha** (25-11-2026). `es.dagarin.agendario` registrado en Play Console con la clave de firma `BE:1E:…:09:75` verificada (y las 3 de Google por la app en borrador, que hay que conservar).
- **(En suspenso) Sincronizar con Outlook / Microsoft 365**, cuando llegue la cuenta de empresa. Decidido: Microsoft Graph (contactos del buzón), solo Agendario → Outlook, contactos dentro de una carpeta **«Agendario»** y cada etiqueta como **categoría**; conexión con código de dispositivo (microsoft.com/devicelogin). Encajaría como otro tipo de cuenta en la lista de cuentas de sincronización (una etiqueta podría ir a Google y a Outlook a la vez). Ojo: hace falta registrar una app en Microsoft Entra y, con la cuenta de empresa, seguramente que el administrador de TI la apruebe. Al pasar de Google a Outlook, no migrar los contactos con herramientas de Microsoft (saldrían duplicados): se pasan las etiquetas de cuenta y Agendario los crea.
- Hoja de ruta de la web dagarin.es/agendario: ahora tiene propuestas; Daniel dictará el contenido.
- (Lejano) Sincronizar recordatorios con apps de tareas autoalojadas por **CalDAV (VTODO)**: serviría para Vikunja, Nextcloud Tasks y cualquier otra compatible, si Daniel instala alguna.
- Cuando la oficina pase a Outlook (principios de 2027): añadir la Gmail normal en el nuevo Outlook y dejar visibles solo sus contactos (Personas → Configuración → «Mostrar solo estos contactos»).
