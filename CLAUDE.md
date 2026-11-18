# Agendario — guía para Claude Code

Agenda de contactos **autoalojada** (servidor Docker + web/PWA; más adelante app Android). Autor: Daniel (GitHub `Dagarin-es`, Docker Hub `dagarines`). La app está en **Beta** hasta que él diga lo contrario (etiqueta «Beta» visible y versiones `X.Y.Z-beta`).

## Cómo trabajar con Daniel

- Todo en **español** (código comentado en español, textos de la interfaz, commits, CHANGELOG y README).
- Es principiante con la terminal: instrucciones **paso a paso**, comandos completos para copiar y pegar. Trabaja como **root**: nunca pongas `sudo`.
- Patrón de trabajo: va dando cambios; si dice «para la próxima versión / no generes aún», **solo se apuntan** (sección *Pendiente* de este fichero). Cuando dice «genera» (o no pide esperar), se hace la versión, se prueba y se publica.
- Le gusta ver capturas de lo que cambia y un resumen corto al final: qué hay nuevo y cómo actualizar.
- Nada de diálogos nativos del navegador (`alert/confirm`): usar `useConfirm`/`useAlert` de `components/Dialogs.tsx`.

## Estructura

Monorepo con npm workspaces:

- `packages/shared` — esquemas zod y tipos compartidos, `APP_VERSION`, `APP_NAME`, constantes (historial, copias, mensajería…).
- `apps/server` — Node 22, Hono, Drizzle ORM + PostgreSQL, sharp, @node-rs/argon2, bundle con tsup.
  - `src/routes/*` (contacts, duplicates, history, personal, backup, geo, import, export, tags…), `src/lib/*` (merge, history, backup, nfs, oauth, items, duplicates…).
  - Migraciones en `drizzle/` (generar con `cd apps/server && npx drizzle-kit generate --name nombre`; SQL a mano con `--custom`).
- `apps/web` — React 19, Vite 7, Tailwind v4 (`@utility` en `src/styles.css`), TanStack Query, react-router 7, vite-plugin-pwa.
  - **Modo oscuro**: `src/dark.css` invierte las escalas de color con variables CSS bajo `.dark` (generado desde `tailwindcss/theme.css`). No añadir clases `dark:`; si un color sólido se ve mal en oscuro, ajustarlo en `dark.css`.
- `scripts/actualizar-agendario.sh` + `actualizar.conf.example` — instalación/actualización en el servidor desde un zip (y subida a GitHub).
- `.github/workflows/docker.yml` — al subir una etiqueta `v*`, publica la imagen en Docker Hub `dagarines/agendario` (amd64 + arm64; betas → `X.Y.Z-beta` y `beta`, estables → `X.Y.Z` y `latest`). Secretos del repo: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- `docs/` — `registrar-apps.md` (app de Google), `privacidad.md` (publicada en dagarin.es/agendario/privacidad). `design/icons/` — iconos (principal: libreta índigo con lápiz; alternativo: libreta abierta, para la futura personalización).

## Comandos

```bash
npm install
npm run typecheck          # siempre antes de dar algo por terminado
npm run build              # server (tsup) + web (vite)
# Servidor de desarrollo contra una base de datos de pruebas:
cd apps/server && DATABASE_URL=postgres://... WEB_DIR=../web/dist DATA_DIR=/tmp/agendario-data node dist/index.js
```

No hay tests automáticos: se prueba la API con `curl` y la interfaz con Playwright (capturas). Si se añaden tests, documentarlos aquí.

## Versiones y publicación

1. Subir la versión en: `packages/shared/src/index.ts` (`APP_VERSION`), los cuatro `package.json` (raíz, shared, server, web) y `ARG APP_VERSION` del `Dockerfile`; después `npm install` para el lockfile.
2. Entrada en `CHANGELOG.md` y actualizar `README.md` (versión, funciones, hoja de ruta).
3. `npm run typecheck && npm run build`.
4. Commit en la rama `beta` (betas) o `main` (estables), etiqueta `vX.Y.Z[-beta]` y push (rama + etiqueta). La etiqueta dispara la imagen de Docker Hub. Recordar a Daniel crear la *Release* (pre-release en betas).
5. Desplegar en su servidor (ver abajo).

### Despliegue en el servidor de Daniel

Instalación en `/opt/agendario` (docker compose: `app` = imagen `agendario-local`, `db` = postgres:17-alpine, datos en `/opt/agendario/data`). Puerto **3002** (el 3000 y 3001 son de PVEMon y BCKMon). Publicado por Nginx Proxy Manager.

Desde el clon del repositorio, con la versión ya hecha:

```bash
docker build -t agendario-local --build-arg APP_VERSION=$(node -p "require('./package.json').version") .
cp docker-compose.yml /opt/agendario/docker-compose.yml   # solo si ha cambiado (avisar antes y guardar copia .bak)
cd /opt/agendario && docker compose up -d --force-recreate app
docker compose logs --tail=50 app
```

Nunca tocar `/opt/agendario/.env` ni `/opt/agendario/data` sin preguntar. El script `actualizar-agendario.sh` sigue sirviendo para instalar desde zip.

## Decisiones ya tomadas (no cambiar sin hablarlo)

- **Etiquetas por dato**: teléfonos, emails y direcciones pueden llevar una etiqueta del contacto. Al filtrar/exportar por etiqueta: los datos con esa etiqueta; si no hay ninguno de ese tipo, los que no tienen etiqueta; nunca los de otras etiquetas.
- **Duplicados**: grupos por union-find; las parejas se revisan de una en una (`pickPair`); combinar mueve todo (fechas, regalos, relaciones, etiquetas, apuntes) y el contacto eliminado va a la papelera.
- **Historial** (60 días) de campos del contacto con restaurar versión/campo; **papelera** 60 días; purga automática. Etiquetas, regalos y apuntes son personales y no van al historial compartido.
- **Empresa enlazada** a otro contacto; al renombrar la empresa se actualizan los enlazados.
- **Llamadas y apuntes** privados por usuario. **Acciones por defecto** (teléfono, email, app de mensajería: WhatsApp, WhatsApp Business, Telegram, Signal, SMS) generales en Ajustes y por contacto (☆).
- **Copias de seguridad** (solo admin): JSON de todas las tablas + fotos → tar.gz → cifrado **age** con contraseña. Destinos: local, **NFS** (cliente NFSv3 propio en `lib/nfs.ts`, conecta desde puerto < 1024 gracias al sysctl del compose; lista las exportaciones), **SMB** (rclone) y **Google Drive** (rclone, permiso `drive.file`, autorización con **código de dispositivo**; el ID y secreto de la app de Google llegan por las variables `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`: en el `.env` del servidor y como secretos de GitHub Actions para la imagen de Docker Hub. **Nunca ponerlos en el código**: GitHub bloquea el push). OneDrive, Dropbox y WebDAV descartados. Retención = número de copias.
- **Direcciones**: buscador Photon (OSM) a través del servidor, coordenadas, botón «Abrir en mapa» adaptado al sistema.
- Interfaz: paleta índigo (con amarillo, lila y rosa), modo claro/oscuro/automático, botones repartidos a lo ancho en duplicados, combinación manual en tres columnas (principal · a eliminar · Quedará).

## Pendiente (en orden)

> Hecho en 0.17.0-beta: varias copias (`backup.jobs` en settings, claves `backup.config.<id>`/`backup.secrets.<id>`/`backup.lastAuto.<id>`; la «main» conserva las claves antiguas; `backup_runs.job_id`, migración 0019; todas las rutas de `/backup` aceptan `?job=`; CRUD en `/backup/jobs`; en la web `BackupJobs` + `BackupJobCtx`/`useJobQuery`), `MaterialYouPlugin.mailApps/openMail` (+ `<queries>` de SENDTO mailto), el buscador no se recoge con foco/teclado, Modal `full` usa `h-full` (respeta `--sat`), clases `detail-*` para la cabecera en `.two-pane-detail`.
> Hecho en 0.16.0-beta: `LabelInput` como desplegable propio (+ `GET /contacts/item-labels`), `PATCH /contacts/:id/dates/:subId` y `DateEditForm`, `EmojiPicker`, mosaico en la ficha, aviso tras llamada (`CallNotify`, `NoteReplyReceiver`, `items` en la respuesta de `/calls/import`, evento nativo «open» → `?call=`), `LetterIndex` (solo app).
> Hecho en 0.15.0-beta (sin APK): fotos con transparencia en PNG (clave con sufijo «-png», `photoType`/`vcardPhotoType` en `lib/photos.ts`), `PhotoCropper`, relaciones primo/tío/sobrino/cuñado/suegro/yerno (migración 0018), menús con `keepInView`, «Duplicados» oculto sin duplicados, `Modal` corta el submit hacia formularios exteriores.
> Hecho en 0.14.0-beta: modo sin conexión (`lib/offline.ts` con idb-keyval: copia `/contacts/offline-snapshot` + cola de cambios permitidos; `api.ts` responde con lo guardado ante `OfflineError`; caché de TanStack Query persistida en IndexedDB en `main.tsx`; `OfflineBanner`), registro de llamadas (`CallLogPlugin`/`CallSync`/`CallSyncWorker`/`PhoneStateReceiver` con WorkManager y disparador por cambio en CallLog; `POST /calls/import` con `interactions.external_id`), pestaña Regalos (`/gifts/overview`, `pages/Gifts.tsx`), miniaturas de ideas (`gift_ideas.image_key`, `lib/linkpreview.ts`, `/gift-ideas/:id/image`), compartir (`.ShareGift` activity-alias + `share_target` del manifiesto PWA → `/share-gift`), Fold (≥600 dp: rail + dos paneles en `AppShell`), `nativeApi.installedApps`.
> Hecho en 0.13.0-beta: temas de color (`packages/shared/src/themes.ts` con paletas que sustituyen la escala indigo; `lib/theme.ts` inyecta `<style id="color-theme">` en claro y oscuro y cambia el favicon; `prefs.colorTheme`, «dynamic» = Material You en la app; iconos por tema con `node --experimental-strip-types apps/mobile/scripts/icons.mjs` y `activity-alias` .Icon<Tema> activados con `MaterialYouPlugin.setIcon`), Ajustes en pestañas (`?tab=`), foto de perfil (`users.photo_key`, `users.me_contact_id`, `/auth/avatar`, `/auth/me-contact`), `prefs.emailApp` (`emailLink` en `lib/links.ts`), `DELETE /backup/runs`, píldora inferior `.m3-pill` en la app.
> Hecho en 0.12.0-beta: servidor CardDAV (`routes/dav.ts`, tabla `dav_resources`), grupos de Fastmail ↔ subetiquetas (`syncGroups` en `lib/sync.ts`, tabla `sync_group_links`), gestión de usuarios (`adminRoutes`, `users.disabled`/`mustChangePassword`, ajuste `auth.registration`), regalo/emoji por evento (`contact_prefs.events`), app Android en `apps/mobile` (Capacitor 8; la web se compila con `npm run build:app` → `apps/web/dist-app` con `VITE_APP=1`; `lib/platform.ts` guarda servidor y token Bearer; `components/AppShell.tsx` y `app.css` son la interfaz Material 3; `lib/native.ts` + `MaterialYouPlugin.java` aplican la paleta del sistema sobre `--color-indigo-*`; iconos con `apps/mobile/scripts/icons.mjs`; firma en `android/keystore.properties`, nunca en git).
> Hecho en 0.11.0-beta: ficha compacta (cabecera, Teléfonos/Emails, Celebraciones, Trabajadores), relaciones recíprocas (`relationshipInverse`, `lib/upgrades.ts` para ajustes de datos de una sola vez), calendario en dos columnas, santos desactivados por defecto, Menú, `components/LabelInput.tsx`.
> Hecho en 0.10.0-beta: calendario de Fechas con estado de regalos (`lib/events.ts`, `pages/Upcoming.tsx`), idea → comprado → regalado, santos automáticos (`packages/shared/src/santoral.ts`), subetiquetas (`tags.parent_id/position`, `expandTagIds`), abecedario arriba, Combinar desde la lista, reordenar datos, etiquetas de datos en `user_prefs.itemLabels`, historial de sincronizaciones (`sync_log`).
> Hecho en 0.9.0-beta: sincronización CardDAV/Fastmail (`lib/carddav.ts`, `lib/sync.ts`, `routes/sync.ts`, tablas `sync_accounts`/`sync_links`), mapa con chincheta (`components/MapPicker.tsx`, Leaflet), abecedario y orden de la lista, etiquetas y foto en el formulario, botón Editar con lápiz.

2. **Google Contactos**: primero importar contactos y fotos; después, quizá bidireccional (API People con OAuth web; el permiso de contactos no vale con código de dispositivo).
3. **Agendario como servidor CardDAV** (una libreta por etiqueta o grupo de etiquetas) para sincronizar el móvil directamente (DAVx⁵).
4. **App Android** con Capacitor reutilizando la web; registro automático de llamadas (solo Android), notificaciones de cumpleaños, cuenta de contactos del teléfono.
5. **Personalización de la interfaz**: paletas de color y elegir icono (principal o libreta abierta).
