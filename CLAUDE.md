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

> Hecho en 0.9.0-beta: sincronización CardDAV/Fastmail (`lib/carddav.ts`, `lib/sync.ts`, `routes/sync.ts`, tablas `sync_accounts`/`sync_links`), mapa con chincheta (`components/MapPicker.tsx`, Leaflet), abecedario y orden de la lista, etiquetas y foto en el formulario, botón Editar con lápiz.

1. **Etiquetas de teléfonos y emails** (móvil, casa, trabajo…): lista predefinida que crece con las que mete el usuario; si escribe una que no existe, preguntar si se crea (se crea una vez).
2. **Google Contactos**: primero importar contactos y fotos; después, quizá bidireccional (API People con OAuth web; el permiso de contactos no vale con código de dispositivo).
3. **Agendario como servidor CardDAV** (una libreta por etiqueta o grupo de etiquetas) para sincronizar el móvil directamente (DAVx⁵).
4. **App Android** con Capacitor reutilizando la web; registro automático de llamadas (solo Android), notificaciones de cumpleaños, cuenta de contactos del teléfono.
5. **Personalización de la interfaz**: paletas de color y elegir icono (principal o libreta abierta).
