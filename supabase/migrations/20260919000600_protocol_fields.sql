-- =========================================================================
-- Fase 13: campos de la bitácora de protocolo de seguridad (viene de una
-- hoja de cálculo que ya usa el cliente: BAJO PROTOCOLO, Folio, Cliente,
-- Proveedor, Prv. Independiente, Operador, Modalidad, Placa, Caja con GPS,
-- ECO, Doc. Transporte, Origen, Destino, Fecha, Encargado, Estatus,
-- Modificado, Lugar de detención, Coordenadas, Motivo, Horario de
-- reinicio, Paro de motor). No se incluye la columna "D('')" del
-- encabezado original: su significado no quedó claro (posible artefacto
-- de Excel) y se dejó pendiente de confirmar con el cliente.
-- =========================================================================

-- Proveedores de transporte (distintos del cliente dueño de la carga).
create table public.providers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  is_independent boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create index providers_tenant_id_idx on public.providers (tenant_id);

alter table public.providers enable row level security;

create policy providers_select on public.providers
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.current_role() <> 'CLIENTE_VIEW');

create policy providers_insert_operativo on public.providers
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  );

create policy providers_update_operativo on public.providers
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  )
  with check (tenant_id = app.current_tenant_id());

create policy providers_delete_admin on public.providers
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin());

-- Campos nuevos en trips (el resto de las columnas del encabezado ya
-- existían: Cliente, Operador, Placa -vehicles.plate-, Origen, Destino,
-- Fecha -scheduled_departure-, Estatus).
alter table public.trips
  add column under_protocol boolean not null default true,
  add column folio text,
  add column provider_id uuid references public.providers (id) on delete set null,
  add column modality text,
  add column transport_doc text,
  add column encargado_id uuid references public.profiles (id) on delete set null,
  add column updated_at timestamptz not null default now();

-- Folio único por tenant solo cuando se captura (no rompe viajes ya
-- existentes, que se quedan con folio null).
create unique index trips_tenant_folio_idx on public.trips (tenant_id, folio) where folio is not null;

create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trips_set_updated_at
  before update on public.trips
  for each row
  execute function app.set_updated_at();

-- "ECO" ya existía como vehicles.economic_number; solo falta "Caja con GPS".
alter table public.vehicles
  add column box_has_gps boolean not null default false;

-- Datos propios de una detención puntual (una fila de trip_events con
-- event_type = 'DETENCION'): si se apagó el motor y el nombre del lugar
-- (las coordenadas ya existían como lat/lng). El nombre de lugar no lo
-- pregunta el bot -Telegram no lo sabe-, así que queda editable a mano
-- desde la bitácora.
alter table public.trip_events
  add column engine_off boolean,
  add column stop_location_name text;

-- record_trip_event cambia de firma (nuevo parámetro p_engine_off): hay
-- que hacer drop explícito de la versión anterior. CREATE OR REPLACE NO
-- reemplaza una función cuando cambian los parámetros -crea un segundo
-- overload en su lugar-, tal como pasó de verdad en la Fase 9 con
-- notify_trip_alert (ver 20260919000300_fix_notify_trip_alert_overload.sql).
drop function if exists app.record_trip_event(
  uuid, public.trip_event_type, uuid, public.report_channel,
  double precision, double precision, jsonb, text
);

create function app.record_trip_event(
  p_trip_id uuid,
  p_event_type public.trip_event_type,
  p_operator_id uuid,
  p_reported_via public.report_channel default 'whatsapp',
  p_lat double precision default null,
  p_lng double precision default null,
  p_raw_payload jsonb default null,
  p_notes text default null,
  p_engine_off boolean default null
)
returns public.trip_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_event public.trip_events;
  v_new_status public.trip_status;
begin
  select tenant_id into v_tenant_id from public.trips where id = p_trip_id;
  if v_tenant_id is null then
    raise exception 'record_trip_event: el viaje % no existe', p_trip_id;
  end if;

  insert into public.trip_events (
    tenant_id, trip_id, operator_id, event_type, reported_via, lat, lng, raw_payload, notes, engine_off
  ) values (
    v_tenant_id, p_trip_id, p_operator_id, p_event_type, p_reported_via, p_lat, p_lng, p_raw_payload, p_notes, p_engine_off
  )
  returning * into v_event;

  v_new_status := case p_event_type
    when 'EN_TRANSITO' then 'EN_TRANSITO'
    when 'REINICIO' then 'EN_TRANSITO'
    when 'DETENCION' then 'DETENIDO'
    when 'ENTREGA' then 'FINALIZADO'
    else null
  end;

  if v_new_status is not null then
    update public.trips
    set status = v_new_status, current_status_since = v_event.reported_at
    where id = p_trip_id;
  end if;

  return v_event;
end;
$$;

revoke all on function app.record_trip_event(
  uuid, public.trip_event_type, uuid, public.report_channel,
  double precision, double precision, jsonb, text, boolean
) from public;

grant execute on function app.record_trip_event(
  uuid, public.trip_event_type, uuid, public.report_channel,
  double precision, double precision, jsonb, text, boolean
) to service_role;

-- El wrapper en "public" (el que de verdad invoca supabase-js .rpc() desde
-- el bot, ver 20260918001200_whatsapp_support.sql) también cambia de
-- firma: mismo motivo, mismo drop explícito.
drop function if exists public.record_trip_event(
  uuid, public.trip_event_type, uuid, public.report_channel,
  double precision, double precision, jsonb, text
);

create function public.record_trip_event(
  p_trip_id uuid,
  p_event_type public.trip_event_type,
  p_operator_id uuid,
  p_reported_via public.report_channel default 'whatsapp',
  p_lat double precision default null,
  p_lng double precision default null,
  p_raw_payload jsonb default null,
  p_notes text default null,
  p_engine_off boolean default null
)
returns public.trip_events
language sql
set search_path = public
as $$
  select * from app.record_trip_event(
    p_trip_id, p_event_type, p_operator_id, p_reported_via, p_lat, p_lng, p_raw_payload, p_notes, p_engine_off
  )
$$;

revoke all on function public.record_trip_event(
  uuid, public.trip_event_type, uuid, public.report_channel,
  double precision, double precision, jsonb, text, boolean
) from public;

grant execute on function public.record_trip_event(
  uuid, public.trip_event_type, uuid, public.report_channel,
  double precision, double precision, jsonb, text, boolean
) to service_role;

-- Permite a JEFATURA/MONITOR/ADMIN editar el nombre del lugar de una
-- detención desde la bitácora (dashboard), sin exponer el resto de
-- columnas de trip_events a update libre.
create policy trip_events_update_stop_location on public.trip_events
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  )
  with check (tenant_id = app.current_tenant_id());
