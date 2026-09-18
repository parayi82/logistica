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

### ✅ Fase 1 — Modelo de datos multi-tenant (en curso)
Esquema en Postgres con RLS por tenant y por rol: tenants, perfiles/roles,
clientes, operadores, unidades, turnos, viajes, geocercas, eventos, atrasos,
evidencia y reportes. Ver propuesta de esquema discutida con el equipo antes
de aplicar migraciones.

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

### ⏭️ Fase 3 — Integración WhatsApp Business Platform (Meta Cloud API)
Edge Function `whatsapp-webhook` que:
- Verifica el webhook de Meta (`hub.challenge`) y valida la firma de cada
  request entrante.
- Identifica al operador por su número de teléfono (`operators.phone_e164`).
- Ofrece un flujo guiado por botones/listas interactivas (WhatsApp
  Interactive Messages) para reportar: En tránsito / Detención / Reinicio /
  Enviar evidencia (foto) / Compartir ubicación.
- Persiste el estado de la conversación (`whatsapp_conversation_state`) para
  sostener el flujo de varios pasos.
- Descarga medios (fotos, ubicación) vía Media API de Meta y los sube a
  Supabase Storage.

### ⏭️ Fase 4 — Motor de geocercas
- Importador de mapas de Google My Maps exportados como KML/GeoJSON hacia
  `geofences` (columna `geom geography(Polygon,4326)` con PostGIS).
- Función/trigger que, al recibir un evento con coordenadas, valida contra
  `ST_Contains`/`ST_DWithin` las geocercas del cliente correspondiente al
  viaje y guarda el resultado (`DENTRO`/`FUERA`/`SIN_VALIDAR`) en el evento.

### ⏭️ Fase 5 — Cálculo automático de atrasos
- Al registrar un evento `REINICIO`, comparar contra la hora esperada del
  checkpoint (`trip_checkpoints.expected_departure_time` o el tiempo
  estándar de detención del protocolo) y calcular `delay_minutes` en
  `trip_delays`, disparando alerta si excede el umbral configurado.

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
  migrations/        # esquema SQL versionado + RLS
  functions/          # Edge Functions (whatsapp-webhook, generate-report, ...)
src/
  lib/                # supabaseClient, tipos, helpers de rol
  login.ts            # página de ingreso
  dashboard.ts         # torre de control en tiempo real
index.html / login.html / dashboard.html
```
