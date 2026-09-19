# Torre de Control — SaaS de Logística de Transporte de Carga

Plataforma multi-tenant para monitorear en tiempo real el cumplimiento de
protocolo de viajes de carga: estatus de tránsito/detención, validación de
coordenadas contra geocercas autorizadas, cálculo de atrasos y reportes de
turno automáticos por Telegram.

## Stack

- **Base de datos / backend**: Supabase (Postgres + PostGIS, Auth, Realtime,
  Storage, Edge Functions, Cron).
- **Frontend**: páginas HTML/TS ligeras servidas con Vite (sin framework
  pesado), usando `@supabase/supabase-js` directamente desde el navegador.
- **Multi-tenant**: aislamiento por `tenant_id` con Row Level Security en
  todas las tablas; roles de aplicación separados del rol de Postgres.

## Roles

| Rol | Descripción |
|---|---|
| `ADMIN` | Administra el tenant: usuarios, clientes, geocercas, turnos. |
| `JEFATURA` | Supervisa cumplimiento, recibe reportes de turno, justifica atrasos. |
| `MONITOR` | Opera la torre de control en tiempo real, registra eventos manuales. |
| `SEGURIDAD_PATRIMONIAL` | Recibe alertas de incumplimiento y reportes de turno. |
| `CLIENTE_VIEW` | Acceso de solo lectura, restringido a sus propios viajes/clientes. |

## Desarrollo local

```bash
cp .env.example .env.local   # completa con las credenciales de tu proyecto Supabase
npm install
npm run dev
```

Las migraciones de base de datos viven en `supabase/migrations/` y se aplican
con el [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Después de aplicar las migraciones necesitas, al menos para empezar a
probar:

1. Crear un `tenant` (dispara automáticamente su fila en
   `protocol_thresholds`).
2. Invitar usuarios desde el dashboard de Supabase (Authentication) y luego
   insertar su fila en `public.profiles` con `tenant_id` + `role`.
3. Dar de alta `clients`, `operators`, `vehicles` y al menos un `shift` que
   cubra la hora actual para que el dashboard muestre el turno vigente.

## Roadmap

Las 6 fases originales están implementadas. Lo que queda es trabajo de
"último kilómetro" específico de cada instalación (crear el bot de
Telegram, generar los secrets de Vault, cargar el catálogo real de
clientes/turnos/checklist) — no código pendiente. Ver la nota al final de
cada fase para el detalle de qué configurar.

A partir de la Fase 7, el roadmap continúa con mejoras solicitadas después
del despliegue inicial (mapa en vivo, alertas proactivas, y las que sigan).

### ✅ Fase 1 — Modelo de datos multi-tenant
Esquema en Postgres con RLS por tenant y por rol: tenants, perfiles/roles,
clientes, operadores, unidades, turnos, viajes, geocercas, eventos, atrasos,
evidencia y reportes.

### ✅ Fase 2 — Dashboard web en tiempo real
Página `dashboard.html` que lista los viajes activos del turno vigente vía
Supabase Realtime, con semáforo de cumplimiento (verde/amarillo/rojo) según
tiempo transcurrido desde el último evento y validación de geocerca.

- `src/lib/currentShift.ts` determina qué turno está vigente ahora (soporta
  turnos que cruzan medianoche).
- `src/lib/semaforo.ts` calcula el semáforo por viaje usando
  `protocol_thresholds` (verde/amarillo por minutos sin reportar, rojo si el
  último evento marcó la coordenada fuera de la geocerca autorizada).
- Suscripción Realtime a `trips`, `trip_events` y `trip_delays` (respeta RLS:
  cada usuario solo recibe los cambios que su rol puede ver).
- Filtros por estatus y por color de semáforo, chips de resumen del turno.

### ✅ Fase 3 — Integración Telegram Bot API

> **Nota de decisión**: originalmente esta fase se diseñó sobre WhatsApp
> Business Platform (Meta Cloud API). Se reemplazó por Telegram Bot API a
> petición explícita del usuario, principalmente porque el alta en Meta
> Business (verificación de negocio) resultó una fricción difícil de
> resolver rápido. Telegram no requiere ningún tipo de verificación de
> negocio — un bot se crea en minutos hablando con `@BotFather` dentro de
> la propia app. El tradeoff real no es técnico sino de adopción: los
> operadores necesitan tener Telegram instalado (mucho menos universal que
> WhatsApp entre choferes en México/LatAm). Toda la lógica de negocio
> (identificación por teléfono, `record_trip_event`, geocercas, atrasos)
> es idéntica a la que tenía el diseño con WhatsApp — solo cambia el canal.

Edge Function `telegram-webhook` (`supabase/functions/telegram-webhook/`):

- **Seguridad**: valida el header `X-Telegram-Bot-Api-Secret-Token` contra
  `TELEGRAM_WEBHOOK_SECRET` (una cadena que tú inventas al registrar el
  webhook) — el equivalente de Telegram al `X-Hub-Signature-256` de Meta,
  pero sin HMAC: es una comparación directa de secreto compartido. Responde
  `200` de inmediato y procesa en segundo plano (`EdgeRuntime.waitUntil`).
- **Identificación**: a diferencia de WhatsApp, el primer mensaje de
  Telegram *no* trae el número de teléfono — solo un `telegram_user_id`
  numérico. El bot le pide al operador compartir su teléfono con el botón
  nativo "📱 Compartir mi teléfono" (Telegram confirma criptográficamente
  que es el número real de esa cuenta), y ahí se empareja contra
  `operators.phone_e164` igual que antes. Hasta que se identifica,
  `telegram_contacts.tenant_id` queda `NULL` (no sabemos a qué tenant
  pertenece todavía).
- **Deduplicación**: cada `update_id` (Telegram lo garantiza único y
  creciente por bot) se registra en `telegram_inbound_messages`.
- **Flujo guiado** (botones inline, 5 opciones): En tránsito / Detención /
  Reinicio / Enviar evidencia (foto) / Compartir ubicación. El estado de la
  conversación (`telegram_conversation_state.current_step`) sostiene los
  pasos de "esperando foto" / "esperando ubicación".
- **Escritura atómica**: igual que antes, todo pasa por
  `public.record_trip_event(...)`, que valida la geocerca (Fase 4) y
  calcula atrasos (Fase 5) automáticamente sin importar el canal.
- **Evidencia**: descarga la foto vía `getFile` + descarga directa (más
  simple que el Media API de Meta, sin token de medios separado) y la sube
  a Supabase Storage (`trip-evidence/{tenant_id}/{trip_id}/...`).
- **Ubicación**: usa el botón nativo de Telegram "solicitar ubicación".
- **`/start`**: cualquier persona (no solo operadores) que le escriba
  `/start` al bot recibe su propio `telegram_chat_id` — es lo que un
  `JEFATURA`/`SEGURIDAD_PATRIMONIAL` necesita pegar en su perfil
  (`profiles.telegram_chat_id`) para recibir el reporte de turno (Fase 6).

**Configuración** (una vez desplegada la función):

```bash
supabase functions deploy telegram-webhook

supabase secrets set \
  TELEGRAM_BOT_TOKEN=... \
  TELEGRAM_WEBHOOK_SECRET=...
```

Para crear el bot y obtener el token: en Telegram, busca **@BotFather**,
envíale `/newbot`, ponle nombre y username, y te da el token
inmediatamente (sin cuenta de developer, sin verificación de negocio).

Luego registra el webhook con una sola llamada (puedes correrla desde
`curl`, Postman, o el navegador con la URL armada):

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<project-ref>.functions.supabase.co/telegram-webhook",
    "secret_token": "<el-mismo-TELEGRAM_WEBHOOK_SECRET-de-arriba>"
  }'
```

**Pendiente conocido**: si dos tenants dieran de alta el mismo número de
operador (poco probable en la práctica), la función toma el primer match y
lo registra en el log — no hay hoy una forma de que el operador elija
tenant.

### ✅ Fase 4 — Motor de geocercas

**Validación automática** (`app.validate_trip_event_geofence`, trigger
`BEFORE INSERT OR UPDATE OF lat, lng ON trip_events`): cualquier coordenada
que llegue en un `trip_event` — por cualquier canal, no solo Telegram — se
compara contra las geocercas activas del cliente del viaje
(`ST_Contains` sobre `geom::geometry`) y se guarda `DENTRO`/`FUERA` +
`geofence_match_id`. Sin lat/lng, el evento queda `SIN_VALIDAR`. Al vivir en
un trigger (no en el webhook), cubre también los eventos que inserte el
dashboard directamente.

**Importador GeoJSON** (`app.import_geofences`, wrapper público
`public.import_geofences` para PostgREST): recibe un `FeatureCollection` y
hace upsert por `(tenant_id, client_id, name)` — reimportar el mismo mapa
actualiza en vez de duplicar. Soporta:
- `Polygon`/`MultiPolygon` (el caso típico: un polígono dibujado a mano
  en Google My Maps).
- `Point` + propiedad `radius`/`radius_meters` en metros (un parador
  marcado como pin): se convierte a círculo con `ST_Buffer` sobre
  `geography`.
- Cualquier otro tipo de geometría se reporta como `omitido` en vez de
  fallar todo el import.

Autorización: la función valida internamente que quien la llama sea
`ADMIN` del mismo tenant que el cliente destino (por eso sí se puede
otorgar a `authenticated`, a diferencia de `record_trip_event`).

**Página `geofences.html`**: selector de cliente, carga de archivo
`.geojson` (ADMIN), tabla de resultados por feature (`ok`/`omitido`/`error`)
y mapa Leaflet (vía la vista `geofences_geojson`, con
`security_invoker = true` para que respete las mismas policies de RLS que
`geofences`) para verificar visualmente lo importado.

**Cómo obtener el GeoJSON desde Google My Maps**: My Maps exporta a
KML/KMZ, no directamente a GeoJSON — conviértelo con una herramienta como
[mygeodata.cloud](https://mygeodata.cloud/converter/kml-to-geojson) o
`ogr2ogr -f GeoJSON salida.geojson entrada.kml`, y agrega manualmente la
propiedad `radius` a los paraderos que hayas dibujado como punto (pin) si
quieres que se importen como círculo en vez de con el radio por defecto
(100 m).

### ✅ Fase 5 — Cálculo automático de atrasos

Trigger `app.progress_trip_checkpoint_and_delay` (`AFTER INSERT ON
trip_events`), automático sin importar el canal de entrada:

- **`DETENCION`**: marca `actual_arrival_time` en el siguiente
  `trip_checkpoint` pendiente del viaje (status `EN_PARADA`).
- **`REINICIO`**: cierra ese checkpoint (`actual_departure_time`, status
  `COMPLETADO`) y calcula el atraso contra la **hora esperada previamente
  registrada**, en dos niveles:
  1. Si el viaje tiene `trip_checkpoints` planeados (los cargó despacho de
     antemano): `expected_departure_time` del checkpoint donde se detuvo.
  2. Si no hay checkpoints planeados: la última `DETENCION` del viaje +
     `protocol_thresholds.max_stop_minutes` (tiempo máximo de detención
     permitido por protocolo, configurable por tenant, default 60 min).
  3. Si no hay ninguna referencia (REINICIO sin DETENCION previa), no se
     genera atraso — no hay nada contra qué comparar.
- Solo se inserta una fila en `trip_delays` cuando el atraso es real
  (`delay_minutes > 0`); un reinicio a tiempo no genera registro.
- El resultado ya se ve en el dashboard de la Fase 2 (columna "Atraso"),
  sin cambios adicionales de UI: `dashboard.ts` ya leía `trip_delays`.

**Justificar un atraso**: en la columna "Atraso" del dashboard, `ADMIN`/
`JEFATURA` ven un enlace "Justificar" junto a cada atraso sin justificar
(gateado también server-side por la policy `trip_delays_update_justificacion`
de la Fase 1, no solo en el cliente). Abre un modal pidiendo el motivo y
actualiza `trip_delays.justified`/`reason` vía `supabase-js`; el cambio se
refleja en tiempo real para cualquier otra sesión con Realtime abierto.

### ✅ Fase 6 — Reporte de turno automático (PDF + Telegram)

**Cómo se dispara**: no hay una sola "hora de corte" global — cada turno
tiene la suya, en su propio timezone. En vez de un cron por turno,
`pg_cron` corre un barrido cada 5 minutos (`generate-shift-report-sweep`)
que llama a la Edge Function `generate-shift-report` sin argumentos; ella
consulta `shifts_due_for_report` (Fase 6, migración
`20260918001700`) para saber qué turnos ya cruzaron su `cutoff_time` (en
su timezone y respetando `days_of_week`) y todavía no tienen un reporte
`GENERADO`/`ENVIADO` para esa fecha — así que reintentarlo no duplica nada
si el cron se retrasa o se cae un tick.

**Contenido del PDF** (`supabase/functions/generate-shift-report/pdf.ts`,
generado con `pdf-lib`): encabezado de turno, tabla de reinicios sin
evidencia, tabla de detenciones, tabla de validación de coordenadas, lista
de incumplimientos, checklist de cumplimiento y observaciones (resumen
autogenerado). El rango de datos del turno se calcula por duración (no por
fecha de calendario), así que un turno que cruza medianoche no genera
ambigüedad sobre "a qué día pertenece" (`window.ts`).

**Envío**: sube el PDF a Storage (`shift-reports/{tenant_id}/{shift_id}/{fecha}.pdf`)
y lo envía como documento de Telegram a cada `profiles` con rol `JEFATURA`
o `SEGURIDAD_PATRIMONIAL` (activo, con `telegram_chat_id` configurado) del
mismo tenant — no hace falta una tabla de contactos aparte, son "los
Jefatura y Seguridad Patrimonial configurados" literalmente vía roles. Ese
`telegram_chat_id` lo obtiene cada persona enviándole `/start` al bot
(Fase 3) y pegándoselo a su ADMIN.

**Regeneración manual**: la misma función acepta `POST { "shift_id": "..." }`
desde el dashboard (con el JWT del usuario). Internamente valida que quien
llama sea `ADMIN` del tenant dueño de ese turno antes de procesar nada —
sin ese chequeo, cualquier sesión válida podría forzar el reporte
confidencial de otro tenant, porque el resto de la función usa el cliente
`service_role` que ignora RLS.

**Configuración** (además de los secrets de Telegram de la Fase 3):

```bash
supabase functions deploy generate-shift-report

supabase secrets set \
  SUPABASE_URL=https://<project-ref>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=... # ya la inyecta el runtime, no hace falta duplicarla
```

Y, **una sola vez**, desde el SQL Editor del proyecto (nunca en una
migración — son secretos reales, no deben vivir en git):

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<tu service_role key>', 'service_role_key');
```

Si `create extension pg_cron;`/`pg_net;` fallan en la migración por
permisos, actívalas primero desde el Dashboard → Database → Extensions.

### ✅ Fase 7 — Mapa en vivo

El dashboard principal (`dashboard.html`) incluye un mapa Leaflet arriba de
la tabla, mostrando la última posición conocida (`lat`/`lng` de
`trip_events`) de cada viaje activo del turno vigente, con un marcador
coloreado según el mismo semáforo de cumplimiento de la tabla. No requiere
hardware ni tablas nuevas — reutiliza la ubicación que ya llega por
Telegram (Fase 3). Si un viaje nunca reportó ubicación, simplemente no
tiene marcador (la tabla lo sigue mostrando normal).

### ✅ Fase 8 — Alertas proactivas por Telegram

Antes había que estar viendo el dashboard para notar un problema; ahora se
notifica solo, sin esperar al reporte de turno. `app.notify_trip_alert`
arma el mensaje, aplica un cooldown por `(trip_id, alert_type)` para no
saturar Telegram, y encola la llamada al nuevo Edge Function
`send-trip-alert` vía `pg_net` (mismo mecanismo y mismos secrets de Vault
que la Fase 6). Se notifica a los mismos roles que reciben el reporte de
turno (JEFATURA/SEGURIDAD_PATRIMONIAL, vía `telegram_chat_id`). Tres
disparadores:

1. **Fuera de geocerca** (inmediato): trigger `AFTER INSERT` en
   `trip_events` cuando `geofence_validation_status = 'FUERA'`.
2. **Atraso calculado** (inmediato): trigger `AFTER INSERT` en
   `trip_delays` (la Fase 5 ya solo inserta ahí cuando hay atraso real).
3. **Silencio prolongado** (periódico, cooldown de 30 min): barrido de
   `pg_cron` cada 5 minutos (`app.check_silent_trips`) que replica en SQL
   la misma regla de "rojo por tiempo" de `src/lib/semaforo.ts` — el simple
   paso del tiempo no dispara ningún evento en la base, así que no hay
   forma de detectarlo con un trigger.

**Configuración**: ninguna nueva — reutiliza `TELEGRAM_BOT_TOKEN` y los
secrets de Vault (`project_url`, `service_role_key`) ya creados en la Fase
6. Solo hace falta desplegar la función:

```bash
supabase functions deploy send-trip-alert
```

### ✅ Fase 9 — Escalamiento automático a Seguridad Patrimonial

Extiende la Fase 8 con una señal distinta y más seria: la alerta
`SIN_REPORTE` de la Fase 8 detecta silencio (nadie reportó nada); esta
detecta específicamente un viaje `DETENIDO` que superó
`protocol_thresholds.security_escalation_minutes` (default 45 min) **sin
ninguna evidencia fotográfica subida durante esa detención** — se dirige
solo a `SEGURIDAD_PATRIMONIAL`, no a Jefatura, vía el nuevo parámetro
`target_roles` de `app.notify_trip_alert`/`send-trip-alert` (por defecto
sigue siendo ambos roles, para no romper los disparadores de la Fase 8).
`app.check_stopped_without_evidence()` corre en el mismo barrido de
`pg_cron` de 5 minutos que la Fase 8 (mismo `cron.job`, comando
actualizado para llamar ambas funciones).

**Configuración**: ninguna nueva. Solo hace falta el `supabase functions
deploy send-trip-alert` de la Fase 8 (ya desplegado ahí si seguiste el
orden; si no, correrlo ahora aplica el cambio).

> **Bug real encontrado y corregido**: la migración de esta fase usó
> `create or replace function` para agregarle un 5º parámetro a
> `app.notify_trip_alert`, pero Postgres no reemplaza una función si
> cambia la firma (cantidad de parámetros) — crea un *segundo* overload
> en vez de sustituir el original. Eso dejó 2 versiones coexistiendo, y
> cualquier llamada con 4 argumentos (como la de la Fase 8) se volvió
> ambigua ("function ... is not unique"), rompiendo el barrido completo
> de alertas de ambas fases en producción. Corregido en la migración
> `20260919000300_fix_notify_trip_alert_overload.sql` (`drop function`
> de la firma vieja). Lección para futuras fases: cambiar la firma de una
> función siempre necesita un `drop function` explícito de la versión
> anterior, `create or replace` no basta.

### ✅ Fase 10 — KPIs históricos

Página nueva `reportes.html`: cumplimiento y atrasos por operador, cliente
o ruta a lo largo del tiempo (no solo el turno vigente, a diferencia del
dashboard de la Fase 2). Dos vistas de solo lectura con
`security_invoker=true` (mismo patrón que `geofences_geojson` de la Fase
4, respetan la RLS de quien consulta) — `trip_delays_report` y
`trip_alerts_report` — con operador/cliente/ruta ya resueltos por join; el
navegador filtra por rango de fechas y agrega/agrupa en JS (flexible sin
tener que anticipar cada reporte posible en SQL). Muestra: viajes con
atraso, atraso promedio, atrasos justificados/no justificados, eventos
fuera de geocerca, y escalamientos a Seguridad Patrimonial.

**Configuración**: ninguna — son solo 2 vistas SQL, sin Edge Function ni
secrets nuevos.

### ✅ Fase 11 — Exportar a CSV para CLIENTE_VIEW

Sin tocar SQL: las vistas de la Fase 10 ya filtran automáticamente por
cliente para `CLIENTE_VIEW` (vía `app.can_view_client`, la misma función
de la Fase 1), así que solo hacía falta abrirles la página (antes
bloqueada para ese rol) y ocultarles la columna "Escalamientos a
Seguridad" (información operativa interna de la Fase 9, no pensada para
clientes externos). Botón "Descargar CSV" en `reportes.html` — exporta lo
que esté renderizado en ese momento (respeta el rango de fechas y
agrupación elegidos), 100% en el navegador (`Blob` + `<a download>`, sin
Edge Function), con BOM UTF-8 para que Excel no rompa acentos/ñ.

**Configuración**: ninguna nueva.

### ✅ Fase 12 — Prueba de entrega (POD)

Nuevo botón en el menú del bot: "🏁 Entrega / Finalizar viaje"
(`callback_data: ENTREGA`). A diferencia de "Enviar evidencia" (que no
cambia el estatus del viaje), este SÍ lo hace: `app.record_trip_event`
mapea el nuevo `event_type` `ENTREGA` a estatus `FINALIZADO` (mismo
mecanismo que `DETENCION`→`DETENIDO`, `REINICIO`→`EN_TRANSITO`). Flujo de
2 pasos: primero pide una foto (se sube a `trip-evidence` con el nuevo
`evidence_type` `POD`, para distinguirla de evidencia genérica en
reportes futuros) y registra el evento — así el viaje queda finalizado
aunque el operador no complete el segundo paso —, luego pide el nombre de
quién recibió la carga y lo guarda en `trip_events.notes` (columna que ya
existía, sin campo nuevo). Un viaje `FINALIZADO` deja de aparecer como
"viaje activo" en el menú del bot y en el dashboard.

**Configuración**: ninguna nueva — reutiliza `TELEGRAM_BOT_TOKEN` y el
bucket `trip-evidence` ya existentes. Solo hace falta el redeploy:

```bash
supabase functions deploy telegram-webhook --no-verify-jwt
```

### ✅ Fase 13 — Bitácora de protocolo de seguridad

Nueva página `bitacora.html` (visible para todos los roles internos,
oculta a `CLIENTE_VIEW`) con dos tablas:

- **Viajes bajo protocolo**: alta y edición de viajes desde el dashboard
  (antes solo existían por SQL manual). Formulario con los campos nuevos
  de `trips`: folio, bajo protocolo, proveedor, modalidad, doc. de
  transporte y encargado (un `profile` interno responsable del viaje).
  El selector de proveedor incluye un alta rápida ("¿Proveedor nuevo?")
  que crea el registro en la nueva tabla `providers` (nombre + si es
  independiente) sin salir del modal.
- **Bitácora de detenciones**: una fila por cada evento `DETENCION`, con
  el layout exacto que ya usa el cliente en su hoja de cálculo (BAJO
  PROTOCOLO, Folio, Cliente, Proveedor, Prv. Independiente, Operador,
  Modalidad, Placa, Caja con GPS, ECO, Doc. Transporte, Origen, Destino,
  Fecha, Encargado, Estatus, Modificado, Lugar de detención,
  Coordenadas, Motivo, Horario de reinicio, Paro de motor) y exportable
  a CSV con esos mismos encabezados. "ECO" reutiliza
  `vehicles.economic_number` (ya existía desde Fase 1); "Caja con GPS" es
  un campo nuevo en `vehicles`. La columna "Lugar de detención" no la
  pregunta el bot (Telegram solo da coordenadas, no nombres de lugar), así
  que queda editable a mano desde esta página.
  > No se incluye la columna `D('')` del encabezado original que
  > compartió el cliente: su significado no quedó claro (parece un
  > artefacto de Excel) y se dejó pendiente de confirmar.

El bot de Telegram cambia el flujo de "🛑 Detención": ahora pide el
**motivo** (texto libre) y si se **apagó el motor** (Sí/No, con botones)
antes de registrar el evento — antes se registraba al toque sin pedir
ninguno de los dos datos. `app.record_trip_event` gana un parámetro
nuevo (`p_engine_off`); como cambia la firma, se hizo el mismo `drop
function` explícito documentado en la Fase 9 (`create or replace` no
hubiera reemplazado la función, habría creado un segundo overload).

**Configuración**: correr la migración
`20260919000600_protocol_fields.sql` y redesplegar el bot:

```bash
supabase functions deploy telegram-webhook --no-verify-jwt
```

### ✅ Fase 14 — Catálogos y cotizaciones

Dos páginas nuevas para operar sin tocar SQL:

- **`catalogos.html`**: alta/edición de Clientes, Proveedores, Operadores
  y Vehículos, cada uno en su propia tabla. Antes solo un `ADMIN` podía
  escribir estas tablas (y sin ninguna pantalla para hacerlo); ahora
  `ADMIN`/`JEFATURA`/`MONITOR` pueden (mismo patrón de roles que ya usaban
  `trips`/`providers` desde la Fase 13-14), borrar sigue siendo solo
  `ADMIN`.
- **`cotizaciones.html`**: nueva tabla `quotes` para enlazar cliente +
  proveedor + camionero (operador) + unidad **antes** de confirmar el
  viaje, con tarifa/moneda y estatus (Pendiente → Aprobada/Rechazada →
  Convertida). Una cotización **Aprobada** tiene el botón "Convertir a
  viaje": abre un modal precargado con los datos de la cotización, pide
  lo que falta (turno, ruta si no se había capturado, fecha de salida) y
  crea el viaje real en `trips` enlazándolo de vuelta
  (`quotes.converted_trip_id`). Proveedor/operador/unidad son opcionales
  en la cotización (se puede cotizar antes de asignar camionero).
  Oculta a `CLIENTE_VIEW` (mismo criterio que la Bitácora: es información
  comercial/operativa interna).

**Configuración**: correr la migración
`20260919000700_quotes_and_catalog_access.sql`. No requiere redeploy de
Edge Functions (es solo esquema + frontend).

## Estructura del repositorio

```
supabase/
  migrations/                 # esquema SQL versionado + RLS
  functions/
    _shared/                   # cliente admin, cliente Telegram Bot API, normalización de teléfono
    telegram-webhook/           # Fase 3: webhook + máquina de estados
    generate-shift-report/      # Fase 6: PDF + envío por Telegram
    send-trip-alert/            # Fase 8: alertas proactivas por Telegram
src/
  lib/                         # supabaseClient, tipos, auth/sesión, turno/semáforo
  login.ts                     # página de ingreso
  dashboard.ts                  # torre de control en tiempo real + mapa en vivo (Fase 7)
  geofences.ts                  # Fase 4: importador + mapa de geocercas
  reportes.ts                   # Fase 10: KPIs históricos por operador/cliente/ruta
  bitacora.ts                   # Fase 13: alta/edición de viajes + bitácora de detenciones
  catalogos.ts                  # Fase 14: alta/edición de clientes/proveedores/operadores/vehículos
  cotizaciones.ts                # Fase 14: cotizaciones + convertir a viaje
index.html / login.html / dashboard.html / geofences.html / reportes.html / bitacora.html /
catalogos.html / cotizaciones.html
```
