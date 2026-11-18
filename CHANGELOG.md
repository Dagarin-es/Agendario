# Historial de cambios

## 0.16.0-beta
- **Etiquetas de teléfonos, emails y webs**: desplegable propio con la lista completa al tocar (las tuyas, las habituales y las que ya usan tus contactos), filtro al escribir y «+ Crear "…"». Si sales escribiendo una nueva, pregunta si se crea.
- **Fechas importantes**: botón ✏️ para editar nombre, día, mes y año (opcional), también el cumpleaños. **Selector de emoji completo**: buscador, recientes, categorías y escribir o pegar cualquiera.
- **Ficha**: los recuadros de Ideas, Fechas, Relaciones y Regalos recibidos van en mosaico (cada uno pegado al de encima).
- **App Android**: aviso al colgar con un contacto «¿Quieres apuntar algo?», con «Escribir nota» desde la propia notificación y «Abrir ficha» (solo llamadas atendidas de más de 30 s; desactivable en Aplicaciones externas).
- **App Android**: índice de iniciales a la derecha, translúcido, pegado al borde; se toca o se desliza el dedo y una burbuja enseña la letra.
- **App Android**: incluye todo lo de la 0.15 (logotipos transparentes, recorte de fotos, relaciones nuevas, «Duplicados» oculto sin duplicados, arreglos del mapa y los menús).

## 0.15.0-beta (servidor y web; la APK sigue en la 0.14.2)
- **Logotipos transparentes**: las imágenes con transparencia se guardan en PNG y se ven transparentes (con un fondo claro suave detrás, también en modo oscuro), centradas con margen para que el círculo no corte las esquinas. Se envían también en PNG a Fastmail y a la agenda del móvil. Las fotos normales siguen en JPEG.
- **Recortar la foto** al subirla (contactos y tu foto de perfil): arrastrar para encuadrar, acercar y girar, con la vista previa en círculo.
- **Relaciones nuevas**: primo/a, tío/a ↔ sobrino/a, cuñado/a y suegro/a ↔ yerno/nuera (con su inversa automática).
- **«Duplicados»** solo aparece en las pestañas cuando hay duplicados.
- Corregido: buscar una dirección en el mapa desde la edición del contacto guardaba la ficha y salía de la edición.
- Corregido: los menús desplegables (como «Abrir con…» del mapa) ya no se salen de la pantalla en el móvil.

## 0.14.2-beta
- **Registro de llamadas**: corregida la primera carga «desde una fecha», que se ignoraba y solo leía las llamadas a partir de ese momento. La sección enseña cuántas llamadas se leyeron, cuántas se guardaron, cuántas ya estaban y cuántas eran de números que no son contactos.
- **Ventanas en el móvil**: ya no quedan pegadas a los bordes (registro de llamadas, Acerca de, imagen e idea de regalo).

## 0.14.1-beta
- **App**: «Ordenar por…» en la cabecera (pestaña Contactos); la fila de herramientas solo aparece al marcar contactos.
- **App**: «Acerca de Agendario» se abre como ventana emergente (antes quedaba detrás de la hoja) y está debajo de «Cambiar de servidor».
- **Registro de llamadas**: corregido el fallo por el que la sección no aparecía (la app se quedaba esperando a la parte nativa sin respuesta). Ahora siempre se ve en Ajustes → Aplicaciones externas y, si algo falla, enseña el error exacto.

## 0.14.0-beta
- **Modo sin conexión** (app y web): se guarda en el dispositivo una copia de todas las fichas y de las pantallas visitadas. Si el servidor no responde ves lo guardado (con aviso arriba), puedes buscar, y los cambios en contactos, llamadas, apuntes e ideas de regalo se guardan en cola y se envían solos al volver la conexión.
- **Registro de llamadas automático** (app Android): con tu permiso, las llamadas hechas, recibidas y perdidas con tus contactos se guardan solas al colgar, aunque llames desde el teléfono del sistema. Primera carga con el historial del móvil (todo o desde una fecha), sin duplicar las apuntadas a mano; revisión de respaldo cada 2 horas; aviso de la optimización de batería. En ⚙️ Ajustes → Aplicaciones externas.
- **Pestaña Regalos**: quién tiene fechas con 🎁, su próxima fecha y sus ideas (con miniatura y estado), ordenable por fecha o nombre, en dos columnas en el ordenador y «+ Idea» directo.
- **Ideas de regalo**: botón **🛒 Comprar** (abre la tienda y luego eliges para qué fecha es), distintivo **✅ Comprado** y botón **🎁 Regalar**. **Miniatura** de cada idea, sacada sola de la web del enlace o subida a mano.
- **Compartir → «Añadir idea de regalo»** desde el navegador del móvil (APK y PWA instalada): enlace, título e imagen ya puestos; eliges para quién.
- **Galaxy Fold / pantallas anchas**: barra lateral de navegación y lista + ficha a la vez; cambia al plegar y desplegar.
- **App**: el icono del tema se cambia al salir de Apariencia (sin reiniciar a cada toque); solo se ofrecen las apps de correo y mensajería instaladas; la píldora de abajo es más translúcida, tiene «Regalos» y se esconde con el teclado; la hoja de tu cuenta se cierra deslizando hacia abajo y tiene «Acerca de».
- **Móvil**: la lista muestra todos los contactos (sin páginas), «Ordenar por…» arriba a la derecha y la casilla de marcar todos solo cuando hay algo marcado; en la ficha, de las etiquetas para abajo va a todo el ancho.
- **Importar y exportar .vcf** pasan a ⚙️ Ajustes → Sincronización; «Acerca de Agendario» al menú de usuario.

## 0.13.0-beta
- **Temas de color**: Índigo, Océano, Laguna, Lavanda, Arcilla y Grafito (casi monocromo), en ⚙️ Ajustes → Apariencia. Cada uno con su icono en ese tono (en la web, la pestaña del navegador; en Android, el icono del lanzador). En la app, además, «Tu fondo de pantalla» (Material You). El tema se guarda en tu cuenta y te sigue en todos tus dispositivos.
- **Ajustes en pestañas**: Cuentas, Aplicaciones externas, Sincronización, Apariencia y Copias.
- **Foto de perfil**: sube la tuya o marca uno de tus contactos como «mi ficha» y se usa su foto. En la web sale a la izquierda del menú; en la app, abajo a la derecha.
- **Menú de usuario** con el selector Claro / Oscuro / Auto con iconos (web y app).
- **App de correo por defecto** (sistema, Gmail, Outlook, Fastmail o Proton Mail) en Aplicaciones externas.
- **CardDAV**: lista de las libretas que verá el móvil al marcar etiquetas, con su ruta completa («Agendario · Familia › Primos»).
- **Copias**: botón «Limpiar registro» (no borra las copias).
- **App Android**: barra superior más baja que siempre dice «Agendario»; la barra inferior es una píldora flotante translúcida y tu foto sustituye a «Más».
- Fuera la barra de letras (abecedario) de la lista.

## 0.12.1-beta
- **App Android**: la barra superior ya no se monta sobre la barra de estado (Android 15 y posteriores dibujan la app de borde a borde); lo mismo en el login, los diálogos y el mapa.
- **Lista**: el buscador ya no parpadea al desplazarse; se recoge al bajar y vuelve al subir con un margen y una pequeña pausa.

## 0.12.0-beta
- **App Android** (primera APK, `apps/mobile`, Capacitor 8) con diseño **Material 3 / Material You**: toma los colores del fondo de pantalla (Android 12+), modo oscuro, barra de navegación abajo (Contactos, Fechas, Duplicados, Más), botón flotante «Nuevo», hoja inferior con el resto de opciones, botón atrás de Android, vibración suave e icono temático (Android 13+). La primera vez pregunta la dirección del servidor y comprueba que responde. Todo lo de la web está dentro.
- **Servidor CardDAV** en `/dav/` para la agenda del móvil y del Mac (DAVx⁵, iPhone, macOS): una libreta con todo y, si quieres, una por etiqueta (con sus subetiquetas). En ⚙️ Ajustes → CardDAV eliges las libretas y ves la dirección e instrucciones.
- **Subetiquetas ↔ grupos de Fastmail**: al sincronizar, las subetiquetas se convierten en grupos de Fastmail («Familia › Primos») y los grupos creados en Fastmail llegan como subetiquetas.
- **Gestión de usuarios** (⚙️ Ajustes → Usuarios, solo administradores): crear usuarios con contraseña temporal (se les pide cambiarla al entrar), poner otra contraseña, hacer o quitar administrador, desactivar, y elegir el modo de registro sin tocar el `.env`. Cada uno puede cambiar su contraseña en ⚙️ Ajustes → Cuenta.
- **Regalo y emoji por evento**: en Fechas importantes, cada fecha (cumpleaños, santo, aniversario…) tiene 🎁 para decir si toca regalo y un emoji propio para el calendario.
- **Aviso de regalos en la pestaña Fechas**: 🎁 rojo si hay algo a menos de 30 días sin regalo, amarillo si solo hay ideas.
- **Lista**: buscador, etiquetas y barra de herramientas siempre visibles (en el móvil el buscador se esconde al bajar y vuelve al subir). Las etiquetas muestran la ruta completa (`Personal › Familia`).
- **Pestañas con su propio tono** (Contactos índigo, Fechas ámbar, Duplicados violeta) y sin títulos repetidos en Fechas.
- **Ficha**: fuera el título «Celebraciones»; direcciones en dos columnas con el minimapa a la derecha.
- `scripts/fotos-google.py`: trae las fotos de perfil de Google Contacts a los contactos que no tienen foto.
- Corregido: el número de contactos de cada usuario.

## 0.11.0-beta
- **Ficha más compacta**: foto a la izquierda y, a la derecha, nombre, puesto y empresa, etiquetas, Llamar/WhatsApp/Email y los botones ✏️ Editar, 🕘 Historial y 🗑️ Borrar.
- **Teléfonos y Emails** en dos recuadros de la misma altura. Las **llamadas y apuntes** van plegados dentro de Teléfonos (botón «Llamadas y apuntes»).
- **Celebraciones**: Ideas para regalos, 📅 Fechas importantes (con el cumpleaños), 👪 Relaciones y 🎀 Regalos recibidos en cuatro recuadros.
- **Trabajadores** en la ficha de una empresa (los contactos que la tienen enlazada), con llamada rápida y «+ Añadir trabajador».
- **Relaciones recíprocas**: al crear una relación se crea la inversa en el otro contacto (cónyuge ↔ cónyuge, padre/madre ↔ hijo/a, jefe/a ↔ trabaja para…) y al borrarla se borra en los dos. Las que ya había se han completado.
- **Fechas**: calendario más pequeño, a la derecha de la lista en ordenador; iconos más grandes con el número de eventos del día.
- **Santos automáticos desactivados** (se pueden volver a activar en Ajustes → Fechas).
- **Lista**: pestañas del abecedario sobrias, «Todos · N» en el chip, la barra fija queda pegada a la cabecera (ya no asoman los contactos por el hueco) y el «1–50 de N» va junto al paginador.
- **Menú** con icono de hamburguesa y texto, y cada opción con su icono.
- **Combinar manualmente**: en «Quedará» eliges la etiqueta de cada teléfono, email y web (de tu lista; si escribes una nueva pregunta si la crea) y los reordenas con ▲▼. Las etiquetas que solo cambian en mayúsculas se unifican.
- **Mapa**: la capa «Callejero» pasa a Esri (la de CARTO ahora pide clave) y hay una nueva «IGN España». Si una capa no carga, el mapa cambia solo a OpenStreetMap. El menú «Abrir con…» ya no queda debajo del mapa.
- `scripts/limpiar-telefonos.sh`: quita +34 y espacios de los teléfonos y pone las etiquetas con mayúscula y tilde.

## 0.10.0-beta
- **Fechas con calendario mensual**: navegas mes a mes; cada día con eventos lleva un icono de regalo **rojo** (sin ideas), **amarillo** (con ideas) o **verde** (comprado o regalado). Recuerdos y otras fechas, punto gris. Debajo, los próximos 30 días, el mes elegido o el día que toques.
- **Regalos: idea → comprado → regalado**. Al marcar una idea como comprada eliges para qué es (Cumpleaños 2027, Santo, Navidad, Reyes u otra fecha). Si pasa la fecha sin marcarlo como regalado, aviso en la pestaña **Fechas** (🛍️) y en el calendario.
- **Santos automáticos** por el nombre (santoral español). Se pueden quitar en cada contacto o desactivar en Ajustes → Fechas. Si pones un santo a mano, manda ese.
- **Subetiquetas**: una etiqueta puede ir dentro de otra y se pueden **reordenar** (Etiquetas: ▲▼ y «Mover a…»). Filtrar, exportar o sincronizar una etiqueta incluye sus subetiquetas. La fila de etiquetas de la lista ya no se corta y muestra las subetiquetas de la elegida.
- **Abecedario arriba**, a todo el ancho, como las pestañas de una agenda.
- **Combinar** desde la lista: marca dos contactos y pulsa «Combinar» para abrir la combinación manual.
- **Reordenar teléfonos, emails y webs** en el formulario (▲▼).
- **Etiquetas de teléfonos y emails** (móvil, casa…): la lista crece con las tuyas; si escribes una nueva, pregunta si la crea.
- **Historial de sincronizaciones**: en Ajustes → Sincronización → Historial, qué se dio de alta, se modificó o se borró en cada pasada, con filtros y buscador (60 días).

## 0.9.0-beta
- **Sincronización con Fastmail** (o cualquier servidor CardDAV), en ⚙️ Ajustes → Sincronización:
  - Bidireccional y con fotos. Solo los contactos con las **etiquetas que elijas** para ese servicio; de cada uno, los datos de esas etiquetas y los que no tienen etiqueta.
  - Quitar la etiqueta lo borra del servicio (no de Agendario); lo creado en el servicio llega con su etiqueta; lo borrado en el servicio va a la papelera; si cambia en los dos sitios gana lo más reciente (el otro queda en el historial).
  - La primera vez, **vista previa**: qué se empareja, qué se envía y qué llega. Las parejas se combinan sin perder datos.
  - Se conservan los datos del servicio que Agendario no maneja (Skype, redes…). Los grupos de Fastmail se respetan.
  - Freno de seguridad: si de golpe se fuera a borrar más de la mitad, se para y pregunta.
  - Automática cada 5 min a 12 h, o a mano.
- **Mapa para ubicar direcciones**: «🗺️ Ubicar en el mapa» abre un mapa grande con buscador y una **chincheta que se arrastra** al portal exacto. Capas: Callejero, OpenStreetMap, Satélite y Ortofoto PNOA del IGN (España). El mapa de la ficha usa la capa que elijas.
- **Lista**: barra con el **abecedario** a la derecha (toca o desliza) y **ordenar por** nombre a mostrar, nombre, apellidos, empresa o apodo (se recuerda en cada dispositivo; los que no tienen ese dato van al final).
- **Ficha**: el botón **Editar** pasa arriba a la derecha, con su lápiz.
- **Formulario**: foto y **etiquetas** también al crear o editar; el campo «Nombre (o nombre de empresa)».
- Los avisos al borrar dicen que va a la papelera (antes decían «No se puede deshacer»).

## 0.8.3-beta
- El botón **Copiar** (código de Google Drive y «Copiar dirección» del mapa) funciona también entrando por `http://IP:3002`, sin HTTPS, y confirma «✓ Copiado».
- Nueva descripción de la app en Ajustes → Acerca de.
- Imagen Docker: la parte de JavaScript se compila sin emulación en GitHub Actions (más rápido y fiable para ARM).
- `CLAUDE.md`: guía del proyecto para trabajar con Claude Code.
- El ID y el secreto de la app de Google ya no van en el código (GitHub bloquea subirlos): llegan por `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` (en el `.env`, o de serie en la imagen de Docker Hub).

## 0.8.2-beta
- **Google Drive listo para usar**: la app «Agendario» de Google viene integrada. En Ajustes → Copias de seguridad elige Google Drive, indica la carpeta y pulsa **Conectar**: escribe el código en google.com/device con tu cuenta y listo. Agendario solo ve los ficheros que crea él.
- Se quita OneDrive (registrar la app de Microsoft exige un directorio de Azure). Las nubes disponibles quedan en Google Drive.
- Política de privacidad en `docs/privacidad.md`.

## 0.8.1-beta
- **NFS más sencillo**:
  - Al salir del campo del servidor, Agendario consulta las **carpetas que comparte** y las ofrece en una **lista** (con a qué IPs las permite). También se puede escribir otra ruta.
  - Agendario se conecta desde un puerto «privilegiado», así que **ya no hace falta la opción «insecure»** en el NAS: basta con dar permiso de lectura/escritura a la IP del servidor (el `docker-compose.yml` incluye el ajuste `net.ipv4.ip_unprivileged_port_start`).
  - El usuario y grupo (UID/GID) pasan a «avanzado», con la explicación de cuándo hacen falta.
  - Mensajes de error que dicen qué falla: si la ruta no está entre las compartidas (y cuáles hay) o a qué IPs permite la carpeta.

## 0.8.0-beta
- **Todo pasa a llamarse Agendario**: carpeta `/opt/agendario`, script `actualizar-agendario.sh`, zip `agendario-*.zip`, imagen `agendario-local`, base de datos y contenedores `agendario`. **Migración automática**: la primera vez, si existe `/opt/contactos`, el script ofrece copiar todos los datos (base de datos, fotos, copias, `.env` y `actualizar.conf`) y deja la instalación antigua parada e intacta. Hay que volver a iniciar sesión.
- **Modo oscuro**, con selector en ⚙️ Ajustes → Apariencia: automático (el del sistema), claro u oscuro.
- **Copias de seguridad**:
  - **NFS desde la propia app**: Agendario lleva su propio cliente NFSv3 (servidor, ruta exportada, carpeta y UID/GID), sin montar nada ni tocar el `docker-compose.yml`.
  - **Google Drive y OneDrive con código de dispositivo**: «Conectar» muestra un código para escribir en google.com/device o microsoft.com/devicelogin y lo detecta solo; sin páginas que no cargan ni direcciones que copiar. En Google, acceso solo a los ficheros de Agendario. (Necesita las apps registradas: ver `docs/registrar-apps.md`.)
  - **Probar conexión** funciona con los datos del formulario, antes de guardar.
  - **Retención**: un solo número, «Copias a guardar» (las más recientes).
  - En Google Drive y OneDrive la carpeta es obligatoria.
  - Se quitan Dropbox y WebDAV.
- **Script de actualizar**: el token de GitHub puede ir en `actualizar.conf` (`GITHUB_TOKEN`); se usa sin mostrarlo ni guardarlo en otro sitio.
- **Docker Hub**: GitHub Actions publica la imagen (Intel/AMD y ARM) en `dagarines/agendario` con cada etiqueta de versión.

## 0.7.0-beta
- **Nuevo nombre e imagen: Agendario.** Icono de libreta con pestañas y lápiz, y la interfaz pasa a la paleta índigo. El texto de la versión, abajo a la derecha, es más grande. (La instalación sigue en `/opt/contactos` y el script de actualizar es el mismo.)
- **Historial de cambios** (60 días) por contacto: creación, cada campo modificado (antes y después, quién y cuándo), borrado, combinación y restauración. Icono de historial en la lista. En la ficha, botón **Historial** con la cronología: deshacer un campo, ver la versión completa, recuperar un campo de esa versión o restaurarla entera.
- **Papelera**: los contactos borrados se pueden restaurar durante 60 días (con su foto y los enlaces de empresa); después se eliminan solos. Borrar un contacto ya no borra su foto al momento.
- **Llamadas y apuntes** por contacto (privados): llamadas salientes, entrantes y perdidas con duración, reuniones, mensajes y notas. Al volver de una llamada hecha desde la ficha, ofrece apuntarla.
- **Botones Llamar · Mensaje · Email** en la ficha, con teléfono, email y app de mensajería por defecto (WhatsApp, WhatsApp Business, Telegram, Signal o SMS), generales en **Ajustes** y cambiables por contacto con ☆.
- **Ajustes** (⋯ → Ajustes) con **copias de seguridad automáticas cifradas** (age): destino local, NFS, SMB, WebDAV, Google Drive, Dropbox u OneDrive (con «Conectar», sin registrar apps), programación, retención diaria/semanal/mensual, contraseña, copia manual, registro, descarga y **restauración** (con copia previa del estado actual).
- **Ficha**: los datos van en bloques con título (Teléfonos, Emails, Direcciones, Webs, Otros datos, Notas).
- **Edición**: el tipo de cada dirección (casa, trabajo, particular…) va aparte, en su cabecera, y los campos llevan su nombre.
- **Combinar manualmente**: «＋ Añadir un campo que no tiene ninguno» (empresa, cargo, cumpleaños, email, dirección, notas…) y «＋ Añadir» datos nuevos en la columna Quedará.
- El icono de etiqueta de cada dato y su «+» quedan alineados y del tamaño del texto.
- Imagen Docker con rclone y zona horaria (`TZ`, por defecto Europe/Madrid).

## 0.6.0-beta
- **Direcciones geolocalizadas**:
  - En el formulario, cada dirección tiene un **buscador** (OpenStreetMap, a través de Photon): al elegir un resultado se rellenan los campos y se guardan las coordenadas.
  - **📍 Geolocalizar** una dirección ya escrita: busca con lo escrito y, al elegir el resultado, guarda las coordenadas y solo rellena los campos vacíos (no se pierden detalles como el piso o la puerta).
  - Las búsquedas pasan por el servidor (con caché y como mucho una por segundo). Se puede usar un Photon propio con `GEOCODER_URL` o desactivarlo con `GEOCODER=off`.
- **Abrir en mapa**: un botón por dirección que se adapta al dispositivo (en Android abre el selector de apps de mapas, en iPhone Apple Maps y en el ordenador Google Maps) y un menú ▾ «Abrir con…» Google Maps, Apple Maps, Waze u OpenStreetMap, o copiar la dirección. Si la dirección está geolocalizada, la ficha muestra además un mapa pequeño.
- **Lista**: icono por contacto con el estado de geolocalización (geolocalizado, a medias, sin geolocalizar o sin dirección) y nuevo orden **«Sin geolocalizar primero»**, para ir completando los que faltan.
- **Empresa enlazada**: al cambiar el nombre del contacto de la empresa, se actualiza en todos los contactos enlazados (también los que ya estaban desactualizados, al instalar esta versión).
- **Combinar manualmente**: un valor movido a otro campo se puede devolver a su sitio con «— No mover —» en el desplegable o con «↩ Deshacer».
- **Duplicados**: los botones de cada pareja se reparten a lo ancho de la tarjeta.
- Al combinar, si la misma dirección solo estaba geolocalizada en uno de los dos contactos, se conservan sus coordenadas.

## 0.5.1-beta
- **Empresa enlazada a un contacto** (opcional): en el formulario, el botón 🔍 junto a «Empresa» busca y enlaza un contacto de la agenda. En la ficha, la empresa enlaza con la ficha de ese contacto. Al combinar, el enlace va con el valor de empresa elegido; si se borra el contacto de la empresa, se conserva el texto.
- **Combinar manualmente** rediseñado: cada campo en su propio recuadro (alternando tonos) con el nombre del campo bien visible, y tres columnas: contacto principal, contacto a eliminar y **Quedará**, que muestra en todo momento cómo quedará el contacto (también para teléfonos, emails, direcciones, notas y foto). Las cabeceras de columna se quedan fijas al bajar.
- **Vista previa**: los campos que cambian respecto al contacto principal se resaltan en amarillo con la marca «cambia».
- **Desplegables**: la misma flecha, más grande, en todos los desplegables de la app.

## 0.5.0-beta
- **Etiquetas en cada teléfono, email y dirección**: en la ficha, el botón 🏷️ de cada dato lo asocia a una de las etiquetas del contacto (si eliges otra, se añade también al contacto). Varios datos pueden llevar la misma etiqueta; los que no llevan ninguna son los generales.
  - Al **filtrar** la lista por una etiqueta se muestran el teléfono y el email de esa etiqueta.
  - Al **exportar** por etiqueta (desde *Etiquetas → Exportar*, o la selección con la lista filtrada) cada contacto sale con los datos de esa etiqueta; si no tiene ninguno de ese tipo, con los generales.
  - Al quitar una etiqueta de un contacto, sus datos dejan de tenerla. Al combinar, la etiqueta viaja con el dato.
  - Los contactos que ya tenías se preparan solos al actualizar.
- **Combinar manualmente**: cada campo muestra cómo «Quedará» y se puede escribir a mano. Además, «↪ Mover a otro campo…» lleva un valor a otro campo (por ejemplo, la empresa que venía en «Nombre» pasa a «Empresa»).
- **Ver fichas completas**: botones ✏️ Editar y 🗑️ Borrar en cada ficha.
- **actualizar-contactos.sh**: el `docker-compose.yml` de `/opt/contactos` se sincroniza siempre con el de la versión (guarda una copia fechada del anterior y enseña los cambios), y al arrancar comprueba que Docker publica el puerto del `.env` hacia el 3002 del contenedor.

## 0.4.4-beta
- **Puerto 3002 en todas partes**: la app escucha también en el 3002 dentro del contenedor (antes 3000, el mismo que PVEMon). El script de actualización detecta un `docker-compose.yml` o un `.env` antiguos con el 3000 y ofrece corregirlos.
- **Duplicados con varios contactos en el grupo**:
  - Cada tarjeta muestra los motivos de *esa pareja* (antes mostraba los de todo el grupo y parecía que la pareja era otra).
  - Al pasar a la siguiente pareja del grupo la tarjeta empieza de cero: el principal vuelve a ser el más completo y no queda nada marcado (antes se arrastraba la elección de la pareja anterior).
  - Se indica quién más hay en el grupo y que se revisará después.
- Botón **✏️ Editar** en cada contacto de la tarjeta de duplicados y en «Combinar manualmente»; al guardar se vuelve a la misma pantalla.

## 0.4.3-beta
- **Corregido**: en los grupos de más de dos posibles duplicados, «No son duplicados» volvía a mostrar la misma pareja. Ahora cada tarjeta enseña siempre una pareja que no hayas descartado y pasa a la siguiente hasta resolver el grupo.
- **Corregido**: «Combinar todos» podía combinar una pareja marcada como «no son duplicados» si estaba en un grupo de más de dos. Ahora combina pareja a pareja y respeta los descartes.
- Pantalla más ancha en escritorio y botones de cada pareja de duplicados en una sola línea.
- «No son duplicados» tiene contorno como el resto de botones.

## 0.4.2-beta
- Nuevo **`actualizar-contactos.sh`**, que funciona como el `actualizar.sh` de PVEMon: va en `/opt`, usa el único `contactos-*.zip` de `/opt` (ignora los zips de otras apps), descomprime en `/var/tmp/contactos-build`, construye la imagen `contactos-local`, recrea los contenedores, pregunta al empezar si subir a GitHub, borra el zip al terminar y se actualiza a sí mismo.
- La configuración de GitHub va aparte, en `/opt/contactos/actualizar.conf`, con un `actualizar.conf.example` siempre al lado. Si no existe, el script lo avisa y actualiza solo en local.
- GitHub como en PVEMon: las betas van a la rama `beta` y las estables a `main` (con opción de borrar la etiqueta anterior).
- `/opt/contactos` queda solo con lo necesario para funcionar: `docker-compose.yml`, `.env`, `data/` y la configuración.
- Sustituye al `scripts/actualizar.sh` anterior.

## 0.4.1-beta
- **Selección**: las acciones (Exportar, + Etiqueta, − Etiqueta, Borrar) aparecen arriba, junto a la casilla de seleccionar, y se quedan fijas al desplazarte por la lista. Ya no hay barra inferior.
- El desplegable de opciones de selección es más grande y va unido a la casilla.
- **Diálogos con el diseño de la app** en lugar de las ventanas del navegador (confirmaciones de borrado, avisos y errores).
- **Duplicados**:
  - Se marca claramente cuál es el **★ Principal** (el que manda al combinar) y se puede cambiar con «Hacer principal».
  - Para borrar, se pulsa uno de los dos contactos y después **Borrar** (desactivado hasta que haya uno marcado).
  - Nuevo **Ver fichas completas**: los dos contactos uno junto a otro con todos sus datos.
  - Nueva **Vista previa**: muestra cómo quedará el contacto combinado, con lo que viene del otro marcado como «+ de …» y lo que se descarta tachado. Desde ahí se puede cambiar el principal o combinar.
  - «Combinar manualmente» abre con el principal que se haya elegido en la tarjeta.

## 0.4.0-beta
- **Selección múltiple** en la lista de contactos: casilla en cada contacto y menú para seleccionar los de la página, todos los del filtro o toda la agenda. La selección se mantiene al cambiar de página o de filtro.
- **Acciones en bloque** sobre la selección: exportar a .vcf (opcionalmente con ideas de regalo), añadir una etiqueta (existente o nueva), quitar una etiqueta y borrar. Al borrar solo se borran tus contactos; los que te han compartido se saltan y se indica cuántos.
- **Duplicados rediseñados**, al estilo de Google Contacts: cada pareja en una tarjeta con los dos contactos uno junto al otro y cuatro opciones: *Borrar uno*, *Combinar* (automático), *Combinar manualmente* y *No son duplicados*. Nuevo botón **Combinar todos**.
- **Combinar manualmente**: «Seleccione los elementos a conservar de cada contacto». Se marca cuál es el *contacto principal* y cuál el *contacto a eliminar*; se pueden conservar elementos de los dos (por ejemplo, las dos direcciones). Las casillas vienen marcadas con lo que haría la combinación automática.
- Al borrar un contacto se borra también su foto del disco.

## 0.3.1-beta
- **Duplicados** pasa al menú principal, con un contador de grupos pendientes, y la lista de contactos muestra un aviso «Revisar y combinar» cuando hay posibles duplicados.
- Nuevo menú **⋯** con Grupos, Etiquetas, Importar, Exportar y Salir.
- **Paginación** de la lista de contactos: 50 por página por defecto, a elegir entre 25, 50, 75, 100 o todos (se recuerda en cada navegador). Al volver de una ficha sigues en la misma página.
- Búsqueda **sin distinguir acentos** («lucia» encuentra «Lucía») y teléfonos sin importar espacios ni guiones («611 22 33» encuentra «611223344»).
- La versión queda siempre visible abajo a la derecha de la pantalla.
- Las fotos de la lista se cargan a medida que aparecen (más rápido con muchos contactos).

## 0.3.0-beta
- **Duplicados**: detecta posibles duplicados entre tus contactos (mismo email, mismo teléfono —comparando los 9 últimos dígitos—, mismo nombre sin tener en cuenta acentos, orden ni tratamientos como «Dr.», o nombre contenido en otro). Ignora teléfonos y emails compartidos por más de 4 contactos (centralitas, info@…).
- **Panel de fusión** campo a campo: propone como principal el contacto más completo; eliges qué valor queda en cada campo, qué teléfonos, emails, webs y direcciones conservar, la foto y las notas (o las dos unidas). Los grupos de más de dos se revisan por parejas, uno tras otro.
- Al fusionar se trasladan etiquetas, ideas de regalo, regalos recibidos, fechas, relaciones y compartidos. El contacto fusionado recuerda los UID de los absorbidos para no recrearlos al reimportar.
- «No son la misma persona» descarta la pareja (se puede deshacer desde la lista de duplicados).
- Número de versión discreto en el pie de página.

## 0.2.1-beta
- El puerto por defecto pasa a ser el **3002**.
- Nuevo script `scripts/actualizar.sh`: instala o actualiza desde el zip y sube el código a GitHub con su etiqueta de versión (cuando el repositorio esté configurado).

## 0.2.0-beta
- Etiquetas personales con color, filtro en la lista de contactos y gestor de etiquetas (con «Borrar con contactos» para deshacer importaciones).
- Importación de ficheros .vcf (vCard 2.1, 3.0 y 4.0): uno, varios o una carpeta entera, con fotos, categorías como etiquetas y detección de duplicados.
- La exportación .vcf incluye las etiquetas (`CATEGORIES`).

## 0.1.0-beta
- Primera versión: usuarios, contactos con foto, visibilidad privada, compartida o pública, grupos, ideas para regalos, regalos recibidos, fechas importantes, relaciones, próximas fechas, exportación vCard y PWA.
- El contenedor ajusta solo los permisos de la carpeta de datos (sin `chown` manual).
