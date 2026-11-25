# Pendiente para la próxima versión

Aquí se apunta lo que Daniel va pidiendo. No se genera nada hasta que diga «genera»; al generar, se borra de aquí lo hecho (el detalle técnico queda en `CLAUDE.md` y el resumen en `CHANGELOG.md`).

## Para la próxima versión

- **Varias cuentas de Google por usuario** (para la 1.4.0). Ejemplo: los contactos de una etiqueta a una Gmail y los de otra etiqueta a otra.
  - **Ajustes → Sincronización → Gmail** pasa a ser una **lista de cuentas** (añadir, sincronizar ahora, desconectar con la opción de borrar en Google lo creado por Agendario, estado y último error de cada una). La app de Google Cloud (`gmail.app`) es la misma para todas.
  - **Etiquetas** (`pages/Tags.tsx`): en vez de la casilla «Sincronizar con Gmail», cada etiqueta elige **a qué cuenta o cuentas** va (una etiqueta puede ir a varias a la vez; las subetiquetas siguen entrando solas). Con una sola cuenta conectada se ve igual que ahora.
  - Botón **«Pasar estas etiquetas a otra cuenta»** en cada cuenta: mueve sus etiquetas a otra (crea los contactos en la nueva y los quita de la antigua). Pensado para cuando una cuenta se sustituya por otra.
  - **Técnica**: settings `gmail.user.<id>` → lista de cuentas por usuario (cada una con su id, email, refreshToken, tagIds, groups, lastSync*); `gmail_links` con columna `account_id` y PK (user, account, contact) (migración 0026). **Al actualizar, la conexión actual pasa a ser la primera cuenta con sus enlaces, sin volver a subir nada.** Al conectar, `prompt=select_account consent` para poder elegir otra cuenta de Google; si se vuelve a conectar la misma dirección, se renuevan los permisos de esa cuenta y no se duplica. La sincronización, el programador y `kickAll` recorren todas las cuentas; un fallo en una no para las demás. Revisar `/gmail*` (rutas por cuenta), copias de seguridad y `GmailStatus` en shared.
  - Manual: actualizar el capítulo 10 (varias cuentas y cómo pasar etiquetas de una a otra).

## Más adelante / tareas de Daniel

- **Norma fija**: cada versión lleva su entrada en `CHANGELOG.md` (lo que se ve en «Novedades»), apuntando ahí todos los cambios de la versión.
- **Gmail (tras instalar la 1.3.0)**: crear el cliente «Aplicación web» en Google Cloud con la People API, publicar la app «En producción», pegar ID y secreto en Ajustes → Sincronización → Gmail, conectar la Gmail normal y marcar las etiquetas (capítulo 10 del manual).
- Verificación de desarrollador Android: **hecha** (25-11-2026). `es.dagarin.agendario` registrado en Play Console con la clave de firma `BE:1E:…:09:75` verificada (y las 3 de Google por la app en borrador, que hay que conservar).
- **(En suspenso) Sincronizar con Outlook / Microsoft 365**, cuando llegue la cuenta de empresa. Decidido: Microsoft Graph (contactos del buzón), solo Agendario → Outlook, contactos dentro de una carpeta **«Agendario»** y cada etiqueta como **categoría**; conexión con código de dispositivo (microsoft.com/devicelogin). Encajaría como otro tipo de cuenta en la lista de cuentas de sincronización (una etiqueta podría ir a Google y a Outlook a la vez). Ojo: hace falta registrar una app en Microsoft Entra y, con la cuenta de empresa, seguramente que el administrador de TI la apruebe. Al pasar de Google a Outlook, no migrar los contactos con herramientas de Microsoft (saldrían duplicados): se pasan las etiquetas de cuenta y Agendario los crea.
- Hoja de ruta de la web dagarin.es/agendario: ahora tiene propuestas; Daniel dictará el contenido.
- (Lejano) Sincronizar recordatorios con apps de tareas autoalojadas por **CalDAV (VTODO)**: serviría para Vikunja, Nextcloud Tasks y cualquier otra compatible, si Daniel instala alguna.
- Cuando la oficina pase a Outlook (principios de 2027): añadir la Gmail normal en el nuevo Outlook y dejar visibles solo sus contactos (Personas → Configuración → «Mostrar solo estos contactos»).
