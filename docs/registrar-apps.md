# App de Google para Google Drive

La imagen de Docker Hub (`dagarines/agendario`) trae integrada la app «Agendario» registrada en Google Cloud (tipo «TV y dispositivos de entrada limitada», permiso `drive.file`), así que quien la instale desde Docker Hub no tiene que registrar nada: basta con pulsar **Conectar** en Ajustes → Copias de seguridad.

Los valores **no están en el código** (GitHub bloquea subir credenciales de Google): GitHub Actions los mete en la imagen desde los secretos del repositorio `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Si construyes tú la imagen (con `actualizar-agendario.sh`), ponlos en el `.env` del servidor.

Para crear una app de Google propia:

1. **console.cloud.google.com** → **Nuevo proyecto**.
2. **APIs y servicios → Biblioteca** → **Google Drive API** → **Habilitar**.
3. **Google Auth Platform** → **Empezar** (público **Externo**). En **Marca**, página principal, política de privacidad y dominio autorizado.
4. **Acceso a datos** → añade el permiso `.../auth/drive.file`.
5. **Público** → **Publicar aplicación** (debe quedar «En producción»; en «Prueba» la autorización caduca a los 7 días).
6. **Clientes** → **Crear cliente** → **TV y dispositivos de entrada limitada**.

```env
GOOGLE_CLIENT_ID=….apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-…
```

y reinicia: `cd /opt/agendario && docker compose up -d`.

> Estos valores no son secretos de verdad: van dentro de cada instalación, como hacen rclone y otras apps de código abierto. Lo que protege la cuenta es que cada usuario autoriza la conexión con su propio usuario de Google y puede revocarla cuando quiera.

Páginas públicas de la app: [dagarin.es/agendario](https://dagarin.es/agendario) y [política de privacidad](https://dagarin.es/agendario/privacidad) (texto en `docs/privacidad.md`).
