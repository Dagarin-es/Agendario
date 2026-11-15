# Registrar las apps de Google y Microsoft (una sola vez)

Para que el botón **Conectar** de Google Drive y OneDrive funcione con un código (como en las teles), Agendario necesita una app registrada en Google y otra en Microsoft. **Lo hace una vez el autor del proyecto**; sus identificadores van dentro de Agendario y nadie que lo instale tiene que repetirlo.

Mientras no estén puestos, la pantalla de copias lo indica y se pueden usar NFS, SMB o la carpeta local. Una instalación también puede usar sus propias apps con estas variables en el `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `MICROSOFT_CLIENT_ID`.

---

## Google (Google Drive)

1. Entra en **console.cloud.google.com** → selector de proyectos → **Nuevo proyecto** → nombre `Agendario` → **Crear**.
2. **APIs y servicios → Biblioteca** → busca **Google Drive API** → **Habilitar**.
3. **Google Auth Platform** (antes «Pantalla de consentimiento de OAuth") → **Empezar**:
   - Nombre de la app: `Agendario`; correo de asistencia: el tuyo.
   - Público: **Externo**.
   - Datos de contacto: tu correo → acepta y **Crear**.
4. **Acceso a datos** → **Añadir o quitar permisos** → marca `.../auth/drive.file` («Ver, editar, crear y eliminar solo los archivos de Google Drive que uses con esta aplicación») → **Actualizar** → **Guardar**.
   Es un permiso «no sensible»: Google no exige verificación. No subas logotipo (eso sí la pediría).
5. **Público** → **Publicar aplicación** → confirmar. Debe quedar **En producción** (en «Prueba», las autorizaciones caducan a los 7 días).
6. **Clientes** → **Crear cliente**:
   - Tipo de aplicación: **TV y dispositivos de entrada limitada**.
   - Nombre: `Agendario` → **Crear**.
7. Copia el **ID de cliente** (`….apps.googleusercontent.com`) y el **secreto del cliente** (`GOCSPX-…`).

## Microsoft (OneDrive)

1. Entra en **entra.microsoft.com** con tu cuenta de Microsoft. (Si te pide un directorio/inquilino, crea la cuenta gratuita de Azure o de desarrollador de Microsoft 365: solo hace falta para registrar la app.)
2. **Aplicaciones → Registros de aplicaciones → Nuevo registro**:
   - Nombre: `Agendario`.
   - Tipos de cuenta: **Cuentas en cualquier directorio organizativo y cuentas personales de Microsoft**.
   - URI de redirección: déjalo vacío → **Registrar**.
3. **Autenticación** → **Configuración avanzada** → **Permitir flujos de clientes públicos: Sí** → **Guardar**.
4. **Permisos de API** → **Agregar un permiso** → **Microsoft Graph** → **Permisos delegados** → marca `Files.ReadWrite`, `offline_access` y `User.Read` → **Agregar permisos**. (No hace falta «consentimiento del administrador».)
5. En **Información general**, copia el **Id. de aplicación (cliente)**.

---

## Después

Pásale a Claude los tres valores (ID y secreto de Google, ID de Microsoft) y los dejará integrados en la siguiente versión. Hasta entonces puedes probarlos poniéndolos en `/opt/agendario/.env`:

```env
GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
MICROSOFT_CLIENT_ID=00000000-0000-0000-0000-000000000000
```

y reiniciando: `cd /opt/agendario && docker compose up -d`.

> Estos valores no son secretos de verdad: van dentro de cada instalación, como hacen rclone y otras apps de código abierto. Lo que protege tu cuenta es que tú autorizas cada conexión con tu usuario y puedes revocarla cuando quieras (en tu cuenta de Google → Seguridad → Apps con acceso, o en account.microsoft.com → Privacidad → Aplicaciones).
