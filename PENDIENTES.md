# Pendiente para la próxima versión

Aquí se apunta lo que Daniel va pidiendo. No se genera nada hasta que diga «genera»; al generar, se borra de aquí lo hecho (el detalle técnico queda en `CLAUDE.md` y el resumen en `CHANGELOG.md`).

## Para la próxima versión

- **Landing (ya entregada a Daniel, 28-11-2026)**: en el móvil, debajo de la captura de la galería sale el texto corto de la opción elegida (`.gal-cap`, solo ≤900 px) y se define la animación `agl-in` que faltaba. La versión buena está en el proyecto de Claude (`web/agendario-landing.html`): al generar, copiarla a `docs/web/agendario-landing.html`.
- **Quitar todo lo de compartir (28-11-2026)**: Agendario pasa a ser un gestor personal y privado. Se mantienen **varios usuarios**, cada uno con su agenda totalmente separada; desaparece compartir contactos entre usuarios.
  - **Limpieza completa ya** (Daniel confirma que no hay contactos compartidos ni públicos): migración que borra las tablas `contact_shares`, `group_members` y `groups` y la columna `contacts.visibility` (y los enums `visibility`/`permission` si ya no se usan). Comprobar antes en la migración que no queda nada compartido; si lo hubiera, no tocar nada y avisar.
  - **Servidor**: fuera `groupRoutes`, las rutas de compartir y la visibilidad; todo lo de «contactos visibles/editables» pasa a ser «los del dueño» (contactos, búsqueda, duplicados, combinar, CardDAV, Fastmail, Gmail y sus fotos, exportar, calendario, historial…). Quitar los esquemas y tipos de shared que ya no se usen.
  - **Copias de seguridad**: sacar esas tablas de `TABLES`; al restaurar una copia antigua, ignorar `groups`, `group_members`, `contact_shares` y el campo `visibility` sin fallar.
  - **Web y app**: fuera `SharePanel`, la página `Groups` y sus entradas en el menú (`Layout`, `AppShell`), el selector de visibilidad y cualquier aviso de «compartido». Las APK antiguas que llamen a esas rutas deben recibir un error limpio, sin romperse.
  - **Landing**: cambiar la tarjeta «Varios usuarios» (cada uno con su agenda, separada), la pregunta «¿Puedo compartir la agenda con mi familia?» y el «aunque compartas un contacto con tu familia» de Privacidad y de Regalos. **Manual**: quitar o cambiar lo que hable de compartir y de grupos. README y CHANGELOG al día.

## Para la próxima versión: Mis deseos y listas para regalarme (maquetas en `design/maquetas/deseos/`)

Decidido el 28-11-2026: entra en la próxima versión. Crear listas y mandar enlaces, solo en la versión con servidor (en Lite no hay página pública); ser invitado, cualquiera con un navegador.

- **Mis deseos**: lista personal y permanente de lo que Daniel quiere (enlace, foto y nombre sacados de la web, precio, nota tipo «talla M»). Se rellena desde la app, la web y «Compartir → Añadir» desde una tienda. No hace falta mandarla a nadie. Vive en Regalos, como una pestaña más.
- **Ocasiones** («Navidad 2026», «Cumpleaños 2027»): nombre, emoji y fecha; se eligen qué deseos entran; opción «revelar después de la fecha».
- **Invitados con enlace personal**: se eligen de los contactos; Agendario genera un enlace secreto distinto por invitado (WhatsApp, email o copiar). Al abrirlo ya se sabe quién es, sin cuenta ni registro. Es una página web normal: funciona en iPhone, Android y ordenador sin instalar nada. Si alguien reenvía su enlace, el otro actuaría en su nombre (asumido).
- **Lo que ven los invitados**: la lista entera y, en lo marcado, quién lo compra («Comprado por Luis»). Pueden marcar «Lo compro yo» o «Lo compramos entre varios»; en ese caso el que marca elige a los demás entre los invitados y puede añadir nombres a mano de gente sin enlace (p. ej. la pareja de Ana). Los apuntados lo ven al abrir su enlace («Ana te ha apuntado») y pueden borrarse. Se puede desmarcar.
- **La sorpresa**: el dueño nunca ve quién ha marcado qué; el servidor no se lo devuelve (no basta con esconderlo en pantalla). Si el dueño abre un enlace de invitado, la página le reconoce (sesión) y le avisa antes de enseñar nada.
- **Después de la fecha**: la ocasión se archiva y los enlaces dejan de funcionar. Si se activó la revelación, lo regalado pasa a «Recibidos» enlazado a quien lo compró (varios contactos si fue entre varios) y sale de Mis deseos; lo no comprado se queda en Mis deseos para la próxima. Los nombres sueltos se pueden enlazar con un contacto, crear contacto nuevo o dejar como nombre: **los recibidos tendrán que admitir personas que solo son un nombre** (ahora un recibido sin contactos se borra solo con el trigger `gift_received_contacts_orphan`).
- **Elegir participantes**: al marcar «entre varios», el invitado ve a todos los invitados con su situación («Libre» o «Ya regala la chaqueta», en gris); no se bloquea a nadie (se puede participar en varios regalos).
- **Aceptar o no**: los apuntados aparecen como «pendiente» hasta que aceptan («Ana, Luis y Pepe (pendiente)») y pueden decir «No participo». Sin notificaciones push (es una web): lo ven al abrir su enlace; al guardar, el que apunta tiene un botón «Avisar por WhatsApp» que abre WhatsApp con el mensaje y el enlace del otro para que elija el chat. **Nunca se enseñan a los invitados los teléfonos ni emails de los contactos.** Los nombres escritos a mano (sin enlace) no reciben nada: avisarles es cosa del que los apunta; si Daniel quiere, los invita él.
- **Cambiar de idea**: cualquiera puede soltar lo suyo («Ya no lo regalo») y el regalo vuelve a estar libre. Si alguien acepta unirse a un regalo teniendo ya otro marcado, se le pregunta: «Ya regalas la chaqueta. ¿La dejas libre o haces los dos?». Si uno se borra de un regalo entre varios, los demás siguen.
- **«¿Falta alguien?»**: en la página del invitado, un botón para sugerirle a Daniel que invite a otra persona (nombre y nota opcional: «Falta Marta, la pareja de Ana»). A Daniel le llega un aviso en la app con «Invitar» (elegir contacto o crear uno y mandarle su enlace) o «Descartar». La sugerencia no revela nada de lo marcado.
- **«Añadir a mi Agendario»** (para invitados que usan Agendario, completo o Lite): un botón discreto en la página del invitado. Al usarlo, la app lee la ocasión con la API pública (CORS de esas rutas abierto también a los orígenes de Capacitor), pide con qué contacto de su agenda se corresponde el dueño de la lista (o lo crea) y, cuando el invitado marca «Lo regalo yo» desde la app, se apunta solo como «Regalado» en esa ficha (con la ocasión y la fecha). Un navegador no puede saber si una app está instalada, así que:
  - **Android**: el botón abre un enlace `intent://` con el esquema `agendario://` (la app ya lo usa) y `S.browser_fallback_url` a dagarin.es/agendario#android: si la app está, se abre; si no, se le ofrece conseguirla.
  - **iPhone y ordenador**: «¿Usas Agendario? Copia este enlace y pégalo en tu Agendario» + «¿Qué es Agendario?» (enlace a la landing).
  - En la app, «Compartir → Agendario» o pegar el enlace también lo abre (los dominios de cada servidor son distintos: no se pueden asociar con Android App Links).
- **Seguridad (requisitos)**:
  - **Subdominio solo para las listas** (p. ej. `regalos.dagarin.es`): en Nginx Proxy Manager solo pasan las rutas públicas de las listas y el servidor, por ese host, no sirve nada más (ni la web, ni el login, ni la API normal). Documentarlo en el manual y en la landing.
  - Código del enlace aleatorio de ≥128 bits, **detrás de `#`** (no llega a los registros del proxy ni a las vistas previas); en la base de datos solo su hash; por invitado, anulable y con caducidad al archivar la ocasión.
  - `Referrer-Policy: no-referrer` y `rel="noopener noreferrer"` en los enlaces a tiendas; `noindex` (meta y `X-Robots-Tag`); vista previa genérica («Lista de deseos»), sin nombres ni regalos.
  - Abrir la página nunca cambia nada (las vistas previas de WhatsApp la visitan): marcar exige pulsar.
  - Rutas públicas mínimas y aparte, sin sesión ni cookies: solo leer esa ocasión y marcar/desmarcar lo propio; nunca contactos, ids internos, teléfonos ni emails. Validación con zod, límites de tamaño, límite de peticiones por IP y de sugerencias por invitado.
  - Los invitados nunca hacen que el servidor descargue nada (sin SSRF): solo el dueño añade enlaces; las fotos se sirven desde las copias guardadas, no desde las tiendas.
  - Texto de los invitados (nombres a mano, «¿Falta alguien?») siempre como texto, con longitud máxima.
  - Sin recursos de terceros en la página (ni fuentes de Google ni analíticas).
  - Cada invitado solo puede quitar lo suyo; anular un enlace libera lo que marcó sin revelar qué era.
  - El servidor nunca devuelve a la sesión del dueño lo marcado (antes de la revelación).
  - **Nombre que verán los demás** por invitado (por defecto el nombre de pila), no el nombre de la agenda.
  - Al archivar, borrar a los pocos días quién marcó qué y los nombres escritos a mano, salvo lo que pase a Recibidos.
  - Antes de dar la versión por buena: revisión a fondo de la parte pública y pruebas de ataque (adivinar códigos, inyección de texto, acceso a otras ocasiones, peticiones masivas).
- Opcional: lista siempre abierta con enlace fijo para quien pregunte «¿qué te regalo?» en cualquier momento.
- **Seguridad**: enlaces imposibles de adivinar, anulables y que caducan, `noindex`, límite de peticiones, solo lo imprescindible en la página pública (sin datos de contacto de nadie).

## Revisión en Google Play (cuando Daniel diga)

> **Cambio (27-11-2026)**: Google Play se plantea con **Agendario Lite** (ver `LITE.md`), sin registro de llamadas. Lo de abajo sobre permisos de llamadas, vídeo y usuario de demostración en el servidor queda como referencia y se rehará para la Lite.

- **Organizar una revisión en Google Play (prueba interna)**, para instalar y actualizar la app desde Play Store sin el aviso de «app no fiable». Se intenta **una sola vez**: si Google la rechaza, no se insiste y se sigue con la APK (el registro de desarrollador ya cubre la instalación en 2027). Más adelante, cuando esté más terminada, se valorará una **versión Lite sin llamadas** para Play (de momento no).
  - **Compilación para Play**: GitHub Actions genera también el AAB firmado con la misma clave (secretos de siempre) y lo deja en la Release (o lo sube a la pista de prueba interna con la API de Play Console, si es sencillo y seguro: credenciales solo como secreto de GitHub). Revisar Play App Signing para conservar la clave actual (`BE:1E:…:09:75`) y no obligar a desinstalar.
  - **Formulario de declaración de permisos** (`READ_CALL_LOG`, `PROCESS_OUTGOING_CALLS`): redactarlo enfocado al uso como **CRM de negocio** (excepción «Enterprise archive, business & enterprise CRM»): el registro de llamadas y las notas en la ficha de cada contacto son la función principal. Repasar también lo que pida Play para `SYSTEM_ALERT_WINDOW`, el servicio en primer plano `specialUse`, `SCHEDULE_EXACT_ALARM` y `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, la ficha de la tienda, la seguridad de los datos y la política de privacidad (dagarin.es/agendario/privacidad).
  - **Vídeo de demostración** (obligatorio, YouTube oculto, 1–2 min): guion para Daniel (llamada → aviso al colgar → nota → ficha con la llamada; número desconocido → guardarlo). Daniel lo graba con la app en castellano y **sin hablar** (solo grabación de pantalla); Claude le prepara el guion con los tiempos y, con el vídeo que le pase, le añade **subtítulos en inglés** (grabados en la imagen con ffmpeg, y también un .srt para YouTube). Sin doblaje.
  - **En inglés para los revisores**: el formulario de declaración de permisos, las instrucciones de acceso del usuario de demostración y la ficha de la tienda (además de la ficha en castellano). La app sigue en castellano (traducirla entera se descarta de momento: mucho trabajo y no decide la aprobación).
  - **Acceso para los revisores**: usuario de demostración en su servidor (accesible desde internet) con contactos inventados y sin ver nada real (ojo a los contactos públicos/compartidos); instrucciones de acceso para el formulario. Mantenerlo mientras dure la revisión.
  - Lista de testers de la prueba interna (por email) y pasos para que Daniel instale desde el enlace de invitación.

## Más adelante / tareas de Daniel

- **Agendario Lite** (sin servidor, solo app, para Google Play): todo el plan en **`LITE.md`**. No se genera hasta que Daniel lo diga.
- **Norma fija**: cada versión lleva su entrada en `CHANGELOG.md` (lo que se ve en «Changelog»), apuntando ahí todos los cambios de la versión.
- Verificación de desarrollador Android: **hecha** (25-11-2026). `es.dagarin.agendario` registrado en Play Console con la clave de firma `BE:1E:…:09:75` verificada (y las 3 de Google por la app en borrador, que hay que conservar).
- **(En suspenso) Sincronizar con Outlook / Microsoft 365**, cuando llegue la cuenta de empresa. Decidido: Microsoft Graph (contactos del buzón), solo Agendario → Outlook, contactos dentro de una carpeta **«Agendario»** y cada etiqueta como **categoría**; conexión con código de dispositivo (microsoft.com/devicelogin). Encajaría como otro tipo de cuenta en la lista de cuentas de sincronización (una etiqueta podría ir a Google y a Outlook a la vez). Ojo: hace falta registrar una app en Microsoft Entra y, con la cuenta de empresa, seguramente que el administrador de TI la apruebe. Al pasar de Google a Outlook, no migrar los contactos con herramientas de Microsoft (saldrían duplicados): se pasan las etiquetas de cuenta y Agendario los crea.
- Hoja de ruta de la web dagarin.es/agendario: ahora tiene propuestas; Daniel dictará el contenido.
- (Lejano) Sincronizar recordatorios con apps de tareas autoalojadas por **CalDAV (VTODO)**: serviría para Vikunja, Nextcloud Tasks y cualquier otra compatible, si Daniel instala alguna.
- Cuando la oficina pase a Outlook (principios de 2027): añadir la Gmail normal en el nuevo Outlook y dejar visibles solo sus contactos (Personas → Configuración → «Mostrar solo estos contactos»).
