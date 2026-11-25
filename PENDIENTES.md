# Pendiente para la próxima versión

Aquí se apunta lo que Daniel va pidiendo. No se genera nada hasta que diga «genera»; al generar, se borra de aquí lo hecho (el detalle técnico queda en `CLAUDE.md` y el resumen en `CHANGELOG.md`).

## Para la próxima versión

_(nada apuntado todavía)_

## Más adelante / tareas de Daniel

- **Norma fija**: cada versión lleva su entrada en `CHANGELOG.md` (lo que se ve en «Changelog»), apuntando ahí todos los cambios de la versión.
- **Gmail (tras instalar la 1.3.0/1.3.1)**: crear el cliente «Aplicación web» en Google Cloud con la People API, publicar la app «En producción», pegar ID y secreto en Ajustes → Sincronización → Gmail, conectar la Gmail normal y marcar las etiquetas (capítulo 10 del manual).
- Verificación de desarrollador Android: **hecha** (25-11-2026). `es.dagarin.agendario` registrado en Play Console con la clave de firma `BE:1E:…:09:75` verificada (y las 3 de Google por la app en borrador, que hay que conservar).
- **(En suspenso) Sincronizar con Outlook / Microsoft 365**, cuando llegue la cuenta de empresa. Decidido: Microsoft Graph (contactos del buzón), solo Agendario → Outlook, contactos dentro de una carpeta **«Agendario»** y cada etiqueta como **categoría**; conexión con código de dispositivo (microsoft.com/devicelogin). Encajaría como otro tipo de cuenta en la lista de cuentas de sincronización (una etiqueta podría ir a Google y a Outlook a la vez). Ojo: hace falta registrar una app en Microsoft Entra y, con la cuenta de empresa, seguramente que el administrador de TI la apruebe. Al pasar de Google a Outlook, no migrar los contactos con herramientas de Microsoft (saldrían duplicados): se pasan las etiquetas de cuenta y Agendario los crea.
- Hoja de ruta de la web dagarin.es/agendario: ahora tiene propuestas; Daniel dictará el contenido.
- (Lejano) Sincronizar recordatorios con apps de tareas autoalojadas por **CalDAV (VTODO)**: serviría para Vikunja, Nextcloud Tasks y cualquier otra compatible, si Daniel instala alguna.
- Cuando la oficina pase a Outlook (principios de 2027): añadir la Gmail normal en el nuevo Outlook y dejar visibles solo sus contactos (Personas → Configuración → «Mostrar solo estos contactos»).
