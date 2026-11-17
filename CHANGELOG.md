# Historial de cambios

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
