# Torre de Control — SaaS de Logística de Transporte de Carga

Plataforma multi-tenant para monitorear en tiempo real el cumplimiento de
protocolo de viajes de carga: estatus de tránsito/detención, validación de
coordenadas contra geocercas autorizadas, cálculo de atrasos y reportes de
turno automáticos por WhatsApp.

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

### ✅ Fase 3 — Integración WhatsApp Business Platform (Meta Cloud API)
Edge Function `whatsapp-webhook` (`supabase/functions/whatsapp-webhook/`):

- **Verificación** (`GET`): responde `hub.challenge` si `hub.verify_token`
  coincide con `WHATSAPP_VERIFY_TOKEN`.
- **Seguridad** (`POST`): valida `X-Hub-Signature-256` (HMAC-SHA256 con
  `WHATSAPP_APP_SECRET`) antes de procesar cualquier payload; responde
  `200` de inmediato (`EdgeRuntime.waitUntil`) y procesa en segundo plano,
  como espera Meta.
- **Identificación**: normaliza el número entrante (`5215500000001` →
  `+52...`, contemplando el prefijo `1` extra de México) y lo busca en
  `operators.phone_e164`. Si no hay match, responde que el número no está
  registrado.
- **Deduplicación**: cada `wamid` se registra en
  `whatsapp_inbound_messages` (unique) para ignorar los reintentos de Meta.
- **Flujo guiado** (lista interactiva, 5 opciones): En tránsito / Detención
  / Reinicio / Enviar evidencia (foto) / Compartir ubicación. El estado de
  la conversación (`whatsapp_conversation_state.current_step`) sostiene los
  pasos de "esperando foto" / "esperando ubicación".
- **Escritura atómica**: todas las escrituras de eventos pasan por la
  función `public.record_trip_event(...)` (wrapper de `app.record_trip_event`,
  el único schema expuesto a PostgREST), que inserta el `trip_event` y
  actualiza `trips.status`/`current_status_since` en una sola transacción.
  Ese es también el punto donde se conectará la validación de geocerca
  (Fase 4) y el cálculo de atrasos (Fase 5).
- **Evidencia**: descarga la foto vía Media API de Meta (resuelve URL
  temporal + descarga autenticada) y la sube a Supabase Storage
  (`trip-evidence/{tenant_id}/{trip_id}/...`).
- **Ubicación**: usa el mensaje interactivo nativo `location_request_message`
  de WhatsApp para pedir la ubicación en vivo.

**Configuración** (una vez desplegada la función):

```bash
supabase functions deploy whatsapp-webhook

supabase secrets set \
  WHATSAPP_VERIFY_TOKEN=... \
  WHATSAPP_ACCESS_TOKEN=... \
  WHATSAPP_PHONE_NUMBER_ID=... \
  WHATSAPP_APP_SECRET=...
```

En el panel de Meta for Developers → tu app → WhatsApp → Configuration,
registra como *Callback URL* la URL de la función
(`https://<project-ref>.functions.supabase.co/whatsapp-webhook`) y el mismo
`WHATSAPP_VERIFY_TOKEN`, y suscribe el campo `messages`.

**Pendiente conocido**: si dos tenants dieran de alta el mismo número de
operador (poco probable en la práctica), la función toma el primer match y
lo registra en el log — no hay hoy una forma de que el operador elija
tenant desde WhatsApp.

### ✅ Fase 4 — Motor de geocercas

**Validación automática** (`app.validate_trip_event_geofence`, trigger
`BEFORE INSERT OR UPDATE OF lat, lng ON trip_events`): cualquier coordenada
que llegue en un `trip_event` — por cualquier canal, no solo WhatsApp — se
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

Justificar un atraso (marcar `justified = true` + `reason`) ya estaba
soportado desde la Fase 1 vía RLS (`ADMIN`/`JEFATURA` pueden actualizar
`trip_delays`); falta solo la UI para hacerlo desde el dashboard, que se
puede agregar cuando se necesite.

### ⏭️ Fase 6 — Reporte de turno automático (PDF + WhatsApp)
- Job programado (Supabase Cron / Edge Function) a la hora de corte de cada
  turno (`shifts.cutoff_time`).
- Genera PDF replicando el formato actual: encabezado de turno, tabla de
  reinicios sin evidencia, tabla de detenciones, tabla de validación de
  coordenadas, lista de incumplimientos, checklist de cumplimiento y
  observaciones.
- Sube el PDF a Supabase Storage y lo envía automáticamente por WhatsApp
  (Media + Document message) a los contactos de Jefatura y Seguridad
  Patrimonial configurados por tenant.

## Estructura del repositorio

```
supabase/
  migrations/                 # esquema SQL versionado + RLS
  functions/
    _shared/                   # cliente admin, firma HMAC, cliente Graph API
    whatsapp-webhook/           # Fase 3: webhook + máquina de estados
src/
  lib/                         # supabaseClient, tipos, auth/sesión, turno/semáforo
  login.ts                     # página de ingreso
  dashboard.ts                  # torre de control en tiempo real
  geofences.ts                  # Fase 4: importador + mapa de geocercas
index.html / login.html / dashboard.html / geofences.html
```
