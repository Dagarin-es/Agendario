# Agendario · Beta

<img src="design/icons/agendario-libreta.svg" alt="" width="72">

*Antes se llamaba «Contactos». Si tienes esa instalación, mira **Pasar de Contactos a Agendario**.*

> ⚠️ **Versión beta (0.16.0-beta).** Funciona, pero puede tener fallos y cambiar entre versiones. Haz copias de seguridad (ver más abajo) antes de confiarle tus contactos de verdad.

Agenda de contactos autoalojada con **historial de cambios**, **llamadas y apuntes**, **copias de seguridad cifradas**, **ideas para regalos**, **contactos compartidos** entre usuarios y **fotos**, pensada para crecer hasta tener apps de escritorio y móvil, sincronización con Google/Outlook/CardDAV y copias cifradas.

Esta es la **versión 0.16.0-beta**: servidor + web app instalable (PWA) en un contenedor Docker, y la primera **app Android** (APK).

---

## Qué hace ya

- **Usuarios**: el primero que se registra es el administrador. El registro se controla con `REGISTRATION`.
- **Contactos** con nombre, apodo, empresa (que puede enlazarse con otro contacto de la agenda), cargo, cumpleaños (con o sin año), varios teléfonos, emails, webs y direcciones, y notas.
- **Direcciones geolocalizadas**: buscador de direcciones que rellena los campos y guarda las coordenadas, botón **Abrir en mapa** (o en Waze) y mapa en la ficha. Ver *Direcciones y mapas*.
- **Historial de cambios** (60 días) de cada contacto, con **restaurar** una versión o un solo campo, y **papelera** para recuperar contactos borrados. Ver *Historial y papelera*.
- **Llamadas y apuntes** de cada conversación (privados) y botones **Llamar · Mensaje · Email** con el teléfono, email y app de mensajería por defecto (general y por contacto). Ver *Llamadas, mensajes y apuntes*.
- **Copias de seguridad automáticas y cifradas** en una carpeta local, NFS, SMB o Google Drive. Ver *Copias de seguridad*.
- **Modo oscuro** (automático, claro u oscuro) en ⚙️ Ajustes → Apariencia.
- **Foto de contacto**: se guarda normalizada (JPEG de hasta 1024 px más una miniatura de 256 px) y va incluida en la exportación vCard.
- **Visibilidad por contacto**:
  - *Privado*: solo tú.
  - *Compartido*: con las personas o los grupos que elijas, con permiso de **ver** o de **editar**.
  - *Público*: lo ven todos los usuarios del servidor.
- **Grupos** (por ejemplo "Familia") para compartir con varias personas a la vez.
- **Etiquetas** con color para clasificar contactos y **filtrar** la lista. Son **personales**: puedes etiquetar también los contactos que te comparten y nadie más verá tus etiquetas.
- **Etiquetas en cada dato**: un teléfono, email o dirección se puede asociar a una etiqueta. Al filtrar o exportar por esa etiqueta se usan sus datos. Ver *Etiquetas en teléfonos, emails y direcciones*.
- **Importación de .vcf**: uno o varios ficheros, o **una carpeta entera** (con subcarpetas). Ver el apartado *Importar contactos*.
- **Selección múltiple** con acciones en bloque: exportar, añadir o quitar etiquetas y borrar.
- **Duplicados** al estilo de Google Contacts: borrar uno, combinar automáticamente o combinar manualmente eligiendo qué conservar. Ver *Buscar y combinar duplicados*.
- **Ideas para regalos**: idea, enlace, precio, notas y estado regalado (fecha y motivo). **Siempre son privadas**: aunque el contacto esté compartido, nadie más ve tus ideas.
- **Regalos recibidos**: qué te regaló, cuándo y por qué. También son privados.
- **Fechas importantes** (aniversarios, santos…) y **relaciones** entre contactos ("pareja de", "hijo/a de"…).
- **Próximas fechas**: cumpleaños y fechas importantes de los próximos días, con aviso de cuántas ideas de regalo tienes guardadas para esa persona.
- **Exportación .vcf** (vCard 4.0 con foto y tus etiquetas como `CATEGORIES`), opcionalmente con tus ideas de regalo como propiedades `X-CONTACTOS-GIFT`. Lo que exportas se puede volver a importar sin perder nada.
- **Lista paginada** (25, 50, 75, 100 o todos) y búsqueda sin distinguir acentos, que también encuentra teléfonos aunque estén escritos con espacios.
- **PWA**: se instala como una app en Android, Mac y Windows desde el navegador.

---

## Instalación en el homelab

### Requisitos

- Una máquina con **Docker** y **Docker Compose** (una VM o LXC con Docker en Proxmox sirve perfectamente).
- Unos 300 MB de disco más lo que ocupen las fotos.
- Arquitecturas compatibles: x86-64 (amd64) y ARM64.

### Opción rápida: con el script (recomendada)

Funciona igual que el `actualizar.sh` de PVEMon.

**Primera vez.** Desde tu Mac, sube el zip:

```bash
scp agendario-0.16.0-beta.zip root@IP_DEL_SERVIDOR:/opt/
```

En el servidor, saca el script del zip y lánzalo:

```bash
cd /opt && apt install -y unzip curl
unzip -j -o agendario-*.zip agendario/scripts/actualizar-agendario.sh -d /opt
bash /opt/actualizar-agendario.sh
```

**Cada actualización.** Sube el zip nuevo a `/opt` y ejecuta:

```bash
bash /opt/actualizar-agendario.sh
```

Qué hace:

1. Busca el **único** `agendario-*.zip` de `/opt`; los zips de otras apps, como los de PVEMon, los ignora. Si hay cero o varios de Contactos, se para y te lo dice.
2. Si tienes configurado GitHub, te pregunta al empezar si quieres subir también el código.
3. Lo descomprime en `/var/tmp/agendario-build`, fuera de `/opt` para que Arcane no lo vea como proyecto.
4. Construye la imagen `agendario-local` y recrea los contenedores en `/opt/agendario`, sin tocar el `.env` ni la carpeta `data`. La primera vez crea `/opt/agendario` con su `docker-compose.yml` y un `.env` con una contraseña aleatoria. El `docker-compose.yml` se sincroniza **siempre** con el de la versión: si el tuyo es distinto, guarda una copia fechada y te enseña los cambios. Tus ajustes van en el `.env`, que nunca se toca.
5. Comprueba que la app responde y que Docker publica el puerto de tu `.env` (3002 por defecto) hacia el 3002 del contenedor.
6. Si dijiste que sí, sube el código a GitHub.
7. Borra el zip (si algo falla, se conserva) y se actualiza a sí mismo con la versión que venía en el zip.

Si prefieres hacerlo a mano, estos son los pasos:

### 1. Copiar el proyecto al servidor

Desde tu Mac:

```bash
scp agendario-0.16.0-beta.zip root@IP_DEL_SERVIDOR:/opt/
```

En el servidor:

```bash
cd /opt
apt install -y unzip        # si no lo tienes
unzip agendario-0.16.0-beta.zip
cd agendario
```

### 2. Configurar

```bash
cp .env.example .env
# Genera una contraseña para la base de datos y guárdala en .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')|" .env
nano .env    # revisa el resto de opciones
```

| Variable | Valor por defecto | Para qué sirve |
|---|---|---|
| `POSTGRES_PASSWORD` | — | Contraseña de la base de datos (**obligatoria**) |
| `APP_PORT` | `3002` | Puerto en el host |
| `REGISTRATION` | `first` | `first`: solo el primer usuario · `open`: cualquiera · `closed`: nadie |
| `SECURE_COOKIES` | `false` | Ponlo a `true` cuando accedas por HTTPS |
| `SESSION_DAYS` | `30` | Días que dura la sesión |

### 3. Arrancar

```bash
docker compose up -d --build
docker compose logs -f app     # espera a ver "Agendario escuchando en…" y sal con Ctrl+C
```

La primera compilación tarda unos minutos. Las migraciones de la base de datos se aplican solas en cada arranque.

No hace falta crear carpetas ni ajustar permisos: Docker crea `data/` y el contenedor corrige los permisos solo al arrancar. Después, la app se ejecuta con un usuario sin privilegios, no como root.

### 4. Primer acceso

Abre `http://IP_DEL_SERVIDOR:3002`. La primera pantalla te pedirá **crear la cuenta de administrador**.

---

## Pasar de Contactos a Agendario

Desde la 0.8.0 todo se llama Agendario: carpeta `/opt/agendario`, script `actualizar-agendario.sh`, zip `agendario-*.zip`, imagen `agendario-local` y base de datos `agendario`. El script nuevo copia los datos de la instalación antigua por ti.

1. Sube el zip y saca el script nuevo:
   ```bash
   scp agendario-0.16.0-beta.zip root@IP_DEL_SERVIDOR:/opt/
   # en el servidor:
   unzip -j -o /opt/agendario-*.zip agendario/scripts/actualizar-agendario.sh -d /opt
   bash /opt/actualizar-agendario.sh
   ```
2. Al ver que no existe `/opt/agendario` pero sí `/opt/contactos`, pregunta: **«¿Copio sus datos a Agendario?»** → **s**. Entonces:
   - copia tu `.env` (puerto, registro, cookies…) con una contraseña nueva para la base de datos, y tu `actualizar.conf`;
   - exporta la base de datos de Contactos (`pg_dump`), **para** la instalación antigua (libera el puerto 3002) y copia las fotos y las copias locales (`data/app`);
   - carga los datos en la base nueva y arranca Agendario: usuarios, contactos, historial, papelera, ajustes de copias… todo igual.
3. Entra en la web (la misma dirección y puerto; en Nginx Proxy Manager no hay que tocar nada). Como cambia el nombre de la cookie, tendrás que **volver a iniciar sesión**.
4. Cuando compruebes que está todo, borra lo antiguo:
   ```bash
   rm -rf /opt/contactos /opt/actualizar-contactos.sh && docker image rm contactos-local
   ```

Si algo fallara a mitad, la instalación antigua queda intacta: vuelve a arrancarla con `cd /opt/contactos && docker compose up -d`.

<details><summary>Hacerlo a mano (sin el script)</summary>

```bash
# 1. Exportar la base de datos antigua y pararla
cd /opt/contactos
docker compose exec -T db pg_dump -U contactos --no-owner --no-privileges contactos > /root/contactos.sql
docker compose down
# 2. Instalar Agendario sin arrancar la app y copiar fotos y copias
#    (instala con el script contestando «n» a copiar datos, y luego:)
cd /opt/agendario && docker compose stop app
cp -a /opt/contactos/data/app/. /opt/agendario/data/app/
# 3. Vaciar la base nueva y cargar la antigua
docker compose exec -T db psql -U agendario agendario -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;'
docker compose exec -T db psql -q -U agendario agendario < /root/contactos.sql
docker compose up -d
```
</details>

---

## Publicarlo con Nginx Proxy Manager (HTTPS)

Para instalar la PWA en el móvil y usarla fuera de casa **hace falta HTTPS**: los navegadores solo permiten instalar apps web y usar el service worker con HTTPS o en `localhost`.

1. En NPM: **Hosts → Proxy Hosts → Add Proxy Host**
   - *Domain Names*: por ejemplo `agendario.tudominio.es`
   - *Scheme*: `http` · *Forward Hostname/IP*: la IP del host Docker · *Forward Port*: `3002`
   - Activa *Block Common Exploits*
2. Pestaña **SSL**: pide un certificado de Let's Encrypt y activa *Force SSL* y *HTTP/2*.
3. Si al subir fotos grandes te aparece un error 413, añade esto en la pestaña **Advanced**:
   ```nginx
   client_max_body_size 20m;
   ```
4. En el `.env`, pon `SECURE_COOKIES=true` y reinicia:
   ```bash
   docker compose up -d
   ```

> Si solo vas a usarlo desde casa o a través de tu VPN (WireGuard/Tailscale), puedes hacer lo mismo con un dominio interno y un certificado DNS-01.

---

## Instalar la app

### App Android (APK)

1. Pasa `agendario-0.16.0-beta.apk` al móvil (Drive, Telegram, cable…) y ábrelo.
2. Android pedirá permiso para **instalar apps de origen desconocido** desde esa aplicación (Archivos, Chrome…): actívalo solo para ella.
3. Abre **Agendario**, escribe la dirección de tu servidor (la **https** de Nginx Proxy Manager; en casa vale `http://IP:3002`) y entra con tu usuario.

Las actualizaciones se instalan encima, siempre que estén firmadas con la misma clave (`agendario-release.jks`: **guárdala** con su contraseña en Vaultwarden; si se pierde, habrá que desinstalar y volver a instalar).

Para compilarla tú (necesitas Android SDK y Java 21):

```bash
cd apps/web && npm run build:app            # web para la app → dist-app
cd ../mobile && npx cap sync android
node scripts/icons.mjs                      # solo si cambia el icono
cd android && ./gradlew assembleRelease     # APK en app/build/outputs/apk/release/
```

La firma se lee de `apps/mobile/android/keystore.properties` (no se sube a git) o de las variables `AGENDARIO_KEYSTORE`, `AGENDARIO_KEYSTORE_PASSWORD` y `AGENDARIO_KEY_ALIAS`:

```properties
storeFile=/ruta/agendario-release.jks
storePassword=LA_CONTRASEÑA
keyAlias=agendario
```

La versión de la APK sale sola de `APP_VERSION` (0.16.0-beta → código 1200).

**Registro de llamadas**: en ⚙️ Ajustes → Aplicaciones externas → «Activar el registro de llamadas». Android pide permiso para leer el registro de llamadas y el estado del teléfono. Si las llamadas tardan en aparecer, quita a Agendario de la optimización de batería (la app te lleva al ajuste).

**Sin conexión**: la app guarda una copia de tus fichas; si el servidor no responde, ves lo guardado y los cambios se envían al volver.

### Como web app (PWA)

- **Android (Chrome)**: abre la web → menú ⋮ → *Instalar aplicación*.
- **Mac (Edge)**: menú … → *Aplicaciones* → *Instalar este sitio como una aplicación*.
- **Windows (Edge/Chrome)**: icono de instalar en la barra de direcciones.
- **iPhone (Safari)**: Compartir → *Añadir a pantalla de inicio*.

---

## Importar contactos

En el menú **⋯ → Importar .vcf**:

1. Elige **uno o varios ficheros .vcf** o **una carpeta entera**. La opción de carpeta funciona en Edge/Chrome de escritorio e incluye las subcarpetas; en el móvil, usa la de ficheros.
2. Elige las opciones:
   - **Etiqueta** para todo lo importado. Por defecto propone una nueva, «Importado DD/MM/AAAA».
   - **Convertir categorías en etiquetas**: los grupos de Google, iCloud, etc. (campo `CATEGORIES`) pasan a ser etiquetas tuyas.
   - **Si el contacto ya existe**: saltarlo, actualizarlo o duplicarlo. Se considera el mismo si coincide el UID del vCard o, si el vCard no lo tiene, el nombre y un email o teléfono.
   - **Visibilidad** de los contactos nuevos.
3. Pulsa **Importar** y verás el progreso y un resumen.

**Para tus primeras pruebas:** importa siempre con una etiqueta propia. Si no te convence el resultado, ve a **⋯ → Etiquetas → Borrar con contactos** y se borra de golpe todo lo importado con esa etiqueta. Solo borra contactos tuyos, nunca los que te han compartido.

Qué se importa: nombre, apodo, empresa y departamento, cargo, teléfonos, emails, webs y direcciones (con sus etiquetas, incluidas las de Apple), cumpleaños (también sin año), aniversario (pasa a *Fechas importantes*), notas, **foto** y categorías. Las fotos que vienen como enlace web (algunas exportaciones de Google) no se descargan.

Formatos probados: vCard 2.1 (Android, Outlook, con quoted-printable y acentos en UTF-8 o Windows-1252), 3.0 (Google, iCloud/iPhone) y 4.0 (Nextcloud y esta misma app). Rendimiento: 1.500 contactos, 300 de ellos con foto, se importan en unos 7 segundos.

---

## Etiquetas en teléfonos, emails y direcciones

Además de etiquetar el contacto, puedes asociar cada teléfono, email o dirección a una de sus etiquetas. Por ejemplo, el fijo y el email de la oficina a «Trabajo».

- En la ficha, junto a cada dato, el botón **🏷️** lo asocia a una etiqueta. Primero se ofrecen las etiquetas del contacto; si eliges otra, se le añade también al contacto. Varios datos pueden llevar la misma etiqueta. Los datos sin etiqueta son los **generales**.
- En la ficha se ven siempre todos los datos, cada uno con su etiqueta si la tiene.
- **Filtrar** la lista por una etiqueta muestra, en cada contacto, el teléfono y el email de esa etiqueta.
- **Exportar** por etiqueta (*⋯ → Etiquetas → Exportar*, o seleccionando con la lista filtrada y marcando «Solo los datos de…») saca cada contacto con los datos de esa etiqueta.

La regla, para cada tipo de dato: se usan los que tienen esa etiqueta; si no hay ninguno, los generales; los de otras etiquetas, nunca. Ejemplo: con un móvil general y un fijo de «Trabajo», al exportar «Trabajo» sale solo el fijo. Si no hubiera fijo de «Trabajo», saldría el móvil.

---

## Direcciones y mapas

- **Buscar una dirección**: en el formulario, escribe en el buscador de la dirección (calle, número y ciudad). Al elegir un resultado se rellenan los campos y la dirección queda **geolocalizada** (📍).
- **Geolocalizar una dirección ya escrita**: pulsa **📍 Geolocalizar**. Busca con lo escrito; al elegir el resultado correcto se guardan las coordenadas y solo se rellenan los campos vacíos, así no pierdes el piso, la puerta o cómo lo tenías escrito.
- **Abrir en mapa**: en la ficha, cada dirección tiene un botón que se adapta al dispositivo: en Android abre el selector de apps de mapas (Google Maps, Waze…), en iPhone Apple Maps y en el ordenador Google Maps. La flecha ▾ permite elegir otra app o copiar la dirección. Funciona aunque la dirección no esté geolocalizada (se busca por el texto).
- **Ir completando**: en la lista, el icono 📍 de cada contacto indica si está geolocalizado (verde), a medias (ámbar), sin geolocalizar (rojo) o sin dirección (gris). Con **Ordenar → Sin geolocalizar primero** salen arriba los que faltan.

El buscador usa **Photon**, el geocodificador de OpenStreetMap. Por defecto, el servidor público de Komoot (gratuito, sin clave, para uso razonable). Las consultas las hace tu servidor, con caché y como mucho una por segundo. Opciones en `.env`:

```env
# Photon propio (p. ej. un contenedor en el homelab con el extracto de España)
GEOCODER_URL=http://IP:2322
# Desactivar el buscador
GEOCODER=off
# Priorizar resultados cerca de un punto (lat,lon); por defecto, el centro de España
GEOCODER_BIAS=36.72,-4.42
```

---

## Seleccionar varios contactos

Cada contacto de la lista tiene una casilla. Junto al contador hay otra casilla para marcar los de la página, y su menú **▾** permite elegir:

- **Los de esta página**
- **Todos los del filtro**: los que salen con la búsqueda o la etiqueta activa.
- **Toda la agenda**
- **Ninguno**

La selección se mantiene aunque cambies de página o de filtro. Cuando hay algo seleccionado, en esa misma fila (que se queda fija arriba al desplazarte) puedes:

- **Exportar** la selección a un .vcf, con o sin tus ideas de regalo.
- **Añadir una etiqueta**, existente o nueva.
- **Quitar una etiqueta**.
- **Borrar** los contactos seleccionados. Solo se borran los tuyos; los que te han compartido se saltan. No hay papelera: haz tus copias antes.

---

## Buscar y combinar duplicados

En **Duplicados** (menú principal; el número indica cuántos grupos hay pendientes) aparece cada pareja de posibles duplicados en una tarjeta, con los dos contactos uno junto al otro y el motivo: mismo email, mismo teléfono, mismo nombre o nombre parecido. Solo se buscan entre tus contactos.

En cada tarjeta, el contacto marcado como **★ Principal** es el que manda al combinar: se conserva y recibe lo que le falte del otro. Por defecto es el más completo; para cambiarlo, pulsa **Hacer principal** en el otro.

Cada tarjeta muestra una pareja y los motivos de esa pareja. Si el grupo tiene más contactos, la tarjeta indica quiénes son: aparecerán en las siguientes parejas. En cada contacto hay un botón **✏️ Editar** para corregirlo sin salir de aquí.

Opciones de cada tarjeta:

- **Borrar**: pulsa primero el contacto que quieres borrar (queda marcado en rojo) y después **Borrar**. Si tiene ideas de regalo o fechas, te avisa de que se perderán.
- **Combinar**: combinación automática en el principal. Teléfonos, emails y direcciones se suman sin repetidos.
- **Vista previa**: muestra cómo quedará el contacto combinado. Lo que cambia respecto al principal se resalta en amarillo, lo que viene del otro aparece como «+ de …» y lo que se descarta, tachado. Desde ahí puedes cambiar el principal o combinar.
- **Ver fichas completas**: los dos contactos uno junto a otro con todos sus datos, con botones para **editar** o **borrar** cualquiera de los dos.
- **Combinar manualmente**: «Seleccione los elementos a conservar de cada contacto». Cada campo va en su recuadro con tres columnas: contacto principal, contacto a eliminar y **Quedará**, donde ves cómo quedará y puedes escribirlo a mano. Con **«↪ Mover a otro campo…»** llevas un valor a otro campo: por ejemplo, si la empresa venía en «Nombre», la pasas a «Empresa». Indicas cuál es el **contacto principal** (el otro queda como **contacto a eliminar**) y marcas lo que quieres de cada uno. En teléfonos, emails, webs y direcciones puedes quedarte con los de los dos; en los campos de un solo valor (nombre, cumpleaños, foto…), con uno. Las casillas vienen marcadas con lo que haría la combinación automática.
- **No son duplicados**: esa pareja no vuelve a aparecer. Se puede deshacer al final de la lista.

Si un grupo tiene más de dos contactos, se revisa por parejas: tras resolver una, aparece la siguiente.

**⚡ Combinar todos** combina automáticamente todos los grupos de una vez, después de pedirte confirmación. Respeta las parejas marcadas como «no son duplicados».

En cualquier combinación, las etiquetas, ideas de regalo, regalos recibidos, fechas, relaciones y compartidos pasan al contacto que se conserva.

---

## Añadir más usuarios (familia)

1. En **⚙️ Ajustes → Usuarios** (solo administradores) pulsa **+ Crear usuario**: nombre, email y una contraseña temporal. Al entrar se le pedirá cambiarla.
2. Desde ahí también puedes ponerle otra contraseña, hacerle administrador o desactivarlo. Siempre queda al menos un administrador.
3. «Registro desde la web» decide si cualquiera puede crearse cuenta (abierto), solo el primero o nadie. Manda sobre `REGISTRATION` del `.env`.
4. En **⋯ → Grupos**, crea por ejemplo "Familia" y añade a sus miembros.
5. En un contacto: **Editar → Visibilidad: Compartido** y, en la ficha, elige con quién compartirlo.

---

## Sincronizar con Fastmail (u otro CardDAV)

En **⚙️ Ajustes → Sincronización → Añadir sincronización**:

1. En Fastmail crea una **contraseña de app**: Settings → Privacy & Security → Connected apps & API tokens → Manage app passwords and access → New app password (acceso «Mail, Contacts & Calendars» o solo contactos).
2. En Agendario elige Fastmail, pon tu email y esa contraseña y pulsa **Conectar**.
3. Elige las **etiquetas** que quieres en Fastmail (p. ej. «Personal») y cada cuánto sincronizar.
4. Verás una **vista previa** (qué se empareja, qué se envía y qué llega). Pulsa **Empezar a sincronizar**.

Reglas: solo van los contactos con esas etiquetas y, de cada uno, los datos de esas etiquetas y los que no tienen etiqueta. Quitar la etiqueta lo borra de Fastmail (no de Agendario). Lo creado en Fastmail llega con la etiqueta. Lo borrado en Fastmail va a la papelera de Agendario. Si cambia en los dos sitios, gana lo más reciente y lo otro queda en el historial. Si de golpe se fuese a borrar más de la mitad, se para y te pregunta.

Para otro servidor (Nextcloud, Radicale, iCloud con contraseña de app…) elige «Otro servidor CardDAV» y pon su dirección.

## Agenda del móvil y del Mac (servidor CardDAV)

Agendario es también un servidor CardDAV en `https://TU_DOMINIO/dav/`. En **⚙️ Ajustes → CardDAV** eliges qué libretas verá el móvil: «Agendario» con todo y, si quieres, una por etiqueta (incluye sus subetiquetas).

- **Android**: instala **DAVx⁵** → Añadir cuenta → *Acceder con URL y nombre de usuario* → `https://TU_DOMINIO/dav/`, tu email y tu contraseña de Agendario. Marca las libretas.
- **iPhone/iPad**: Ajustes → Contactos → Cuentas → Añadir cuenta → Otra → *Añadir cuenta CardDAV*: servidor `TU_DOMINIO`, tu email y contraseña.
- **Mac**: Contactos → Ajustes → Cuentas → + → *Otra cuenta de Contactos* → CardDAV, manual, servidor `https://TU_DOMINIO/dav/`.

Usa siempre la dirección **https** (Nginx Proxy Manager). Lo que crees en una libreta de etiqueta llega con esa etiqueta y lo que borres en el móvil va a la papelera.

## Fechas y regalos

La pestaña **Fechas** muestra un calendario mensual. Cada día con algo señalado lleva un icono de regalo:
- 🔴 **rojo**: cumpleaños, aniversario o santo sin ideas de regalo;
- 🟡 **amarillo**: tienes ideas guardadas para esa persona;
- 🟢 **verde**: ya está comprado (o regalado).

En la ficha, cada idea pasa por **Comprado** (eliges para qué evento: cumpleaños, santo, Navidad, Reyes u otra fecha) y **Regalado**. Si la fecha pasa y no lo marcas como regalado, la pestaña Fechas muestra un aviso 🛍️.

Los **santos** se pueden añadir a mano en «Fechas importantes». Si quieres que se calculen solos por el nombre (santoral español), actívalo en Ajustes → Fechas.

## Historial y papelera

- Cada vez que se **crea, modifica o borra** un contacto queda apuntado: qué campo cambió, el valor anterior y el nuevo, quién y cuándo. También los cambios automáticos (importar, combinar, renombrar la empresa enlazada). Se conserva **60 días**.
- En la lista, el icono del **reloj con la flecha hacia atrás** marca los contactos que tienen cambios después de crearse.
- En la ficha, **Historial** muestra la cronología. En cada cambio puedes:
  - **↩ Deshacer** un campo concreto (vuelve al valor anterior).
  - **Ver versión completa** (cómo quedó el contacto en ese momento) y **Recuperar** cualquier campo de esa versión.
  - **↩ Restaurar esta versión** entera.
  
  Restaurar queda apuntado como un cambio más, así que también se puede deshacer. La foto no se guarda en el historial.
- **Papelera** (⋯ → Papelera): los contactos borrados (o combinados con otro) se pueden **restaurar** durante 60 días, con su foto, fechas, regalos y enlaces de empresa. Después se eliminan del todo. También puedes eliminarlos antes o vaciar la papelera.

> Las etiquetas, ideas de regalo y apuntes son personales y no aparecen en el historial compartido del contacto.

---

## Llamadas, mensajes y apuntes

- En la ficha, los botones **📞 Llamar**, **💬 WhatsApp** (o la app que elijas) y **✉️ Email** usan el dato por defecto. La flecha ▾ de cada botón deja usar otro y, con **☆**, dejarlo por defecto **para ese contacto**. En el de mensajes también eliges la app para ese contacto.
- En **⚙️ Ajustes → Llamadas y mensajes** eliges la app de mensajería general (WhatsApp, WhatsApp Business, Telegram, Signal o SMS) y el prefijo de país para los números sin prefijo.
- Por defecto, llamar usa el primer teléfono y los mensajes el primer móvil. WhatsApp Business se abre directamente en Android; en el ordenador y en iPhone abre WhatsApp.
- **Llamadas y apuntes**: en cada ficha puedes apuntar llamadas (saliente, entrante, perdida, con duración), reuniones, mensajes y notas de lo que habéis hablado. Son **privados**: solo los ves tú. Si llamas desde la ficha, al volver a la app te ofrece apuntar la llamada con la duración calculada.
- El registro automático de llamadas del teléfono llegará con la app nativa de Android (iPhone no lo permite).

---

## Apariencia (temas y modo oscuro)

En **⚙️ Ajustes → Apariencia**:

- **Modo**: Claro, Oscuro o Auto (el del sistema). También está en el menú de usuario. Se guarda en cada dispositivo.
- **Tema de color**: Índigo, Océano, Laguna, Lavanda, Arcilla o Grafito. Se guarda en tu cuenta (te sigue en todos tus dispositivos) y cambia también el icono: en la web, el de la pestaña; en Android, el del lanzador. En la app de Android hay además «Tu fondo de pantalla» (Material You).
- **Foto de perfil** (⚙️ Ajustes → Cuentas): sube una o marca tu propia ficha de contacto y se usa su foto.

---

## Copias de seguridad

En **⚙️ Ajustes → Copias de seguridad** (solo el administrador). Cada copia es un único fichero `agendario-AAAA-MM-DD_HHMM.tar.gz.age` con toda la base de datos (todos los usuarios, historial incluido) y las fotos, **cifrado con tu contraseña** ([age](https://age-encryption.org)).

1. **Dónde**: elige el destino y rellena sus datos. **Probar conexión** escribe y borra un fichero de prueba con los datos del formulario, **antes de guardar**.
   - **Carpeta local**: por defecto `data/app/backups` en el servidor (`/opt/agendario/data/app/backups`). Sirve como copia rápida, pero conviene tener otra fuera del servidor.
   - **NFS**: escribe el servidor (IP o nombre local) y, al salir del campo, elige la **carpeta compartida** de la lista (puedes añadir una subcarpeta, que se crea sola). Agendario lleva su propio cliente NFSv3: no hay que montar nada. En el NAS solo hay que dar permiso de **lectura/escritura** a esa carpeta para la **IP local del servidor donde corre Agendario** (no su dirección web). En Synology: Panel de control → Carpeta compartida → Editar → Permisos NFS → Crear (IP del servidor, Lectura/Escritura, «Asignar todos los usuarios a admin»). Si el NAS convierte root en otro usuario sin permiso, en «avanzado» puedes indicar el UID/GID de un usuario con permiso.
   - **SMB**: servidor, recurso compartido, usuario y contraseña (Windows, NAS, Samba).
   - **Google Drive**: indica la **carpeta** (obligatoria) y pulsa **Conectar**. Agendario te da un **código**: abre `google.com/device` (en el ordenador o en el móvil), entra con tu cuenta, escribe el código y acepta. La pantalla lo detecta sola. Agendario solo puede ver los ficheros que crea él, no el resto de tu Drive, y tu contraseña nunca pasa por Agendario. Puedes retirar el permiso cuando quieras desde tu cuenta de Google (Seguridad → Conexiones con terceros).
2. **Cuándo**: cada día, semana o mes, a la hora que elijas (hora de España; cámbiala con `TZ` en `.env`).
3. **Cuántas**: el número de copias que se guardan; al hacer una nueva se borra la más antigua.
4. **Cifrado**: la contraseña con la que se cifran. ⚠️ **Sin ella no se puede abrir ninguna copia**: guárdala, por ejemplo, en Vaultwarden.

**Hacer copia ahora** lanza una al momento. El **registro** muestra las últimas copias y sus errores.

### Restaurar

En la misma pantalla, **Restaurar una copia**: elige una del destino (o sube el fichero), escribe su contraseña y pulsa **Comprobar** (muestra de cuándo es y cuántos contactos tiene). **Restaurar ahora** sustituye **todos** los datos por los de la copia; antes se guarda automáticamente el estado actual en `data/app/backups/antes-de-restaurar-….tar.gz.age`. Después hay que volver a entrar.

Las copias también se pueden abrir fuera de la app:

```bash
age -d agendario-2026-11-15_0330.tar.gz.age | tar xz   # pide la contraseña → db.json, manifest.json y photos/
```

Además, desde la web puedes descargar un `.vcf` con todos tus contactos y sus fotos (menú **⋯ → Exportar .vcf**).

---

## Actualizar

Sube el zip nuevo a `/opt` y ejecuta `bash /opt/actualizar-agendario.sh` (ver *Opción rápida*). Los cambios de cada versión están en `CHANGELOG.md`.

---

## Subir el código a GitHub y publicar en Docker Hub

La configuración de GitHub va aparte, en **`/opt/agendario/actualizar.conf`**. A su lado tienes siempre un ejemplo, `actualizar.conf.example`, que el script mantiene al día. Mientras no exista `actualizar.conf`, el script te lo indica al arrancar y actualiza solo en local.

1. **Crea el repositorio vacío** en GitHub (por ejemplo `Dagarin-es/Agendario`), sin README ni licencia.
2. **Crea un token** (Settings → Developer settings → Fine-grained tokens) con acceso solo a ese repositorio y permiso **Contents: Read and write**.
3. **Crea la configuración:**
   ```bash
   cp /opt/agendario/actualizar.conf.example /opt/agendario/actualizar.conf
   chmod 600 /opt/agendario/actualizar.conf
   nano /opt/agendario/actualizar.conf
   ```
   Rellena `GITHUB_URL` (`https://github.com/Dagarin-es/Agendario.git`), `GITHUB_TOKEN` (el token: el script lo usa sin mostrarlo ni guardarlo en otro sitio), `GIT_NAME` y `GIT_EMAIL`. `REPO` es el clon local, `/root/agendario-repo` por defecto. Si dejas `GITHUB_TOKEN` vacío, git usa tus credenciales guardadas o tu clave SSH.
4. La próxima vez que ejecutes `actualizar-agendario.sh` te preguntará: **«¿Subir también el código a GitHub al terminar?»**.

Cómo sube:

- **Betas** (versión con guion, como `0.11.0-beta`): a la rama **`beta`**, con la etiqueta `v0.11.0-beta`. Te recuerda crear la *Release* y marcarla como *pre-release*.
- **Estables** (como `1.0.0`): a **`main`**. Te pregunta qué etiqueta anterior quieres borrar (Enter = ninguna).
- Al repositorio nunca se suben el `.env`, la carpeta `data/` ni `actualizar.conf`: se copia solo el contenido del zip.

**Docker Hub**: cada etiqueta que sube el script activa **GitHub Actions** (`.github/workflows/docker.yml`), que compila la imagen para Intel/AMD y ARM y la publica en `dagarines/agendario`: las betas como `0.11.0-beta` y `beta`, las estables como `1.0.0` y `latest`. Solo hay que crear dos secretos en el repositorio (Settings → Secrets and variables → Actions): `DOCKERHUB_USERNAME` y `DOCKERHUB_TOKEN` (token de Docker Hub con permiso *Read & Write*).

---

## Solución de problemas

| Síntoma | Causa probable |
|---|---|
| No se suben las fotos (error 500, `EACCES` en los logs) | Has forzado `user:` en el compose; quítalo para que el contenedor ajuste los permisos solo |
| Inicias sesión pero vuelve a pedirte el login | `SECURE_COOKIES=true` y estás entrando por `http://` |
| Error 413 al subir una foto | Límite de Nginx Proxy Manager (ver el apartado de NPM) |
| `Falta la variable de entorno DATABASE_URL` | Estás lanzando el contenedor sin `docker compose` |
| No aparece la opción de instalar la app | Necesitas HTTPS |
| La app responde en el 3000 en vez del 3002 | Tu `.env` tiene `APP_PORT=3000`: cámbialo a 3002 (el script de actualización te lo ofrece) |

Ver los logs: `docker compose logs -f app`

---

## Cómo está hecho

```
agendario/
├── apps/
│   ├── server/          API (Node.js + Hono + Drizzle ORM + PostgreSQL)
│   │   ├── src/
│   │   │   ├── db/      esquema de la base de datos
│   │   │   ├── lib/     autenticación, permisos, fotos, vCard, fechas
│   │   │   └── routes/  endpoints de la API
│   │   └── drizzle/     migraciones SQL (generadas)
│   └── web/             PWA (React + Vite + Tailwind CSS)
├── packages/
│   └── shared/          tipos y validaciones compartidos por servidor y apps
├── Dockerfile
└── docker-compose.yml
```

- **Un único lenguaje (TypeScript)** en el servidor y en la web. Las futuras apps (Capacitor para Android/iOS, Tauri para Mac/Windows) reutilizarán la web y el paquete `shared`.
- **Permisos**: toda la lógica está en `apps/server/src/lib/access.ts`.
- **Preparado para sincronizar**: cada contacto tiene un número de `revision` que sube con cada cambio (servirá como ETag de CardDAV) y los borrados son lógicos (`deleted_at`), para poder propagarlos a otros servicios.
- **Autenticación**: cookie de sesión `httpOnly` para la web, y el servidor ya acepta `Authorization: Bearer <token>` para las apps nativas. Las contraseñas se guardan con Argon2.

### Resumen de la API

Todas las rutas están bajo `/api` y, salvo `auth/status`, `auth/register`, `auth/login` y `health`, requieren sesión.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado del servidor |
| GET | `/auth/status` | ¿Se puede registrar alguien? |
| POST | `/auth/register` · `/auth/login` · `/auth/logout` | Sesión |
| GET | `/auth/me` | Usuario actual |
| GET | `/users` | Usuarios (para compartir) |
| GET/POST | `/contacts` | Listar (`?q=` para buscar) / crear |
| GET/PATCH/DELETE | `/contacts/:id` | Ficha completa / editar / borrar |
| GET/PUT/DELETE | `/contacts/:id/photo` | Foto (`?size=thumb\|full`) |
| PUT | `/contacts/:id/shares` | Con quién se comparte (solo el propietario) |
| POST/DELETE | `/contacts/:id/dates[/:subId]` | Fechas importantes |
| POST/DELETE | `/contacts/:id/relationships[/:subId]` | Relaciones |
| POST | `/contacts/:id/gift-ideas` | Nueva idea de regalo |
| PATCH/DELETE | `/gift-ideas/:id` | Editar (marcar como regalado) / borrar |
| POST | `/contacts/:id/gifts-received` | Nuevo regalo recibido |
| DELETE | `/gifts-received/:id` | Borrar regalo recibido |
| GET/POST/DELETE | `/groups[/:id]` | Grupos |
| POST/DELETE | `/groups/:id/members[/:userId]` | Miembros |
| GET | `/upcoming?days=30` | Próximas fechas |
| GET | `/export/contacts.vcf[?gifts=true]` | Exportar vCard |
| POST | `/import/vcard` | Importar un lote de vCards (máx. 500 por petición) |
| GET/POST | `/tags` | Tus etiquetas (con nº de contactos) / crear |
| PATCH/DELETE | `/tags/:id[?withContacts=true]` | Renombrar o cambiar color / borrar (opcionalmente con sus contactos) |
| PUT | `/contacts/:id/tags` | Etiquetas de un contacto |
| PUT | `/contacts/:id/items/:itemId/tag` | Etiqueta de un teléfono, email o dirección (`tagId: null` = general) |
| GET | `/export/contacts.vcf?tag=<id>` | Exportar los contactos de una etiqueta con los datos de esa etiqueta |
| GET | `/contacts?tag=<id>` | Filtrar por etiqueta |
| GET | `/geo/search?q=` | Buscador de direcciones (Photon); `/geo/config` dice si está activado |
| GET | `/contacts/:id/history` · POST `/contacts/:id/history/:entryId/restore` | Historial y restaurar (`field`, `side`) |
| GET · DELETE | `/trash` · POST `/trash/:id/restore` · DELETE `/trash/:id` | Papelera |
| POST | `/contacts/:id/interactions` · PATCH/DELETE `/interactions/:id` | Llamadas y apuntes (privados) |
| GET/PUT | `/prefs` · PUT `/contacts/:id/prefs` | Preferencias de llamadas y mensajes |
| GET | `/backup` · PUT `/backup/config` · POST `/backup/run`, `/backup/test`, `/backup/restore` · GET `/backup/files` | Copias de seguridad (administrador) |
| GET | `/duplicates` | Grupos de posibles duplicados |
| POST | `/duplicates/merge` | Combinar dos contactos (valores elegidos a mano) |
| POST | `/duplicates/auto-merge` | Combinar dos contactos automáticamente |
| POST | `/duplicates/preview` | Vista previa de la combinación automática (no cambia nada) |
| POST | `/duplicates/auto-merge-all` | Combinar todos los grupos automáticamente |
| POST | `/contacts/bulk/tags` | Añadir o quitar una etiqueta a varios contactos |
| POST | `/contacts/bulk/delete` | Borrar varios contactos |
| POST | `/export/selection.vcf` | Exportar los contactos seleccionados |
| POST | `/duplicates/dismiss` | Marcar una pareja como personas distintas |
| DELETE | `/duplicates/dismissals` | Volver a revisar las parejas descartadas |

---

## Desarrollo

Necesitas Node.js 22 o superior y un PostgreSQL (por ejemplo `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:17-alpine`).

```bash
npm install
cat > .env <<'EOF'
DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres
REGISTRATION=open
EOF
npm run dev:server     # API en http://localhost:3002
npm run dev:web        # web en http://localhost:5173 (reenvía /api al servidor)
```

Si cambias el esquema (`apps/server/src/db/schema.ts`), genera la migración con:

```bash
npm run db:generate
```

---

## Hoja de ruta

Mientras el proyecto sea beta, la web muestra la etiqueta «Beta». Para quitarla al publicar la versión estable, cambia `IS_BETA` y `APP_VERSION` en `packages/shared/src/index.ts` (y `APP_VERSION` en el `Dockerfile`).

1. ✅ **Fase 1**: servidor, usuarios, contactos compartidos, fotos, regalos, fechas, relaciones y PWA.
   - ✅ 0.2: etiquetas personales con filtro e importación de .vcf (ficheros y carpetas).
   - ✅ 0.3: búsqueda y fusión de duplicados, paginación y nuevo menú.
   - ✅ 0.4: selección múltiple con acciones en bloque y duplicados al estilo de Google Contacts (con vista previa y fichas completas).
   - ✅ 0.5: etiquetas en cada teléfono, email y dirección; combinación manual con edición de valores.
   - ✅ 0.8: todo pasa a llamarse Agendario (con migración automática), modo oscuro, cliente NFS propio, Google Drive con código, probar destino antes de guardar y retención por número de copias.
   - ✅ 0.7: nuevo nombre (Agendario) e interfaz, historial de cambios con restaurar, papelera, llamadas y apuntes, acciones por defecto y copias de seguridad cifradas programables.
   - ✅ 0.6: direcciones geolocalizadas (buscador, abrir en mapa o Waze, mapa en la ficha) y orden por geolocalización.
2. ✅ **Fase 2**: copias cifradas (age), programables, a una carpeta, NFS, SMB o Google Drive. Pendiente: personalizar la interfaz (colores e icono alternativo).
3. ✅ **Fase 3** (0.12): servidor **CardDAV** para la agenda nativa del móvil y del Mac, y subetiquetas ↔ grupos de Fastmail.
4. Google: solo traer las fotos de perfil (`scripts/fotos-google.py`). Sin sincronización con Google ni Outlook.
5. **Fase 5**: ✅ app Android con Capacitor (0.12). Pendiente: iOS y Tauri (Mac/Windows).
6. Más adelante: historial de interacciones, "mantener el contacto" y préstamos.
