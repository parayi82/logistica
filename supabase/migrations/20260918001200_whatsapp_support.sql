-- =========================================================================
-- Fase 3: soporte de base de datos para el webhook de WhatsApp.
-- =========================================================================

-- Log de mensajes entrantes (dedupe por wamid: Meta reintenta el webhook
-- si no responde 200 a tiempo, o ante fallos de red).
create table public.whatsapp_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  contact_id uuid references public.whatsapp_contacts (id) on delete set null,
  wamid text not null unique,
  message_type text not null,
  processed boolean not null default false,
  error text,
  raw_payload jsonb not null,
  received_at timestamptz not null default now()
);

create index whatsapp_inbound_messages_tenant_id_idx on public.whatsapp_inbound_messages (tenant_id);

alter table public.whatsapp_inbound_messages enable row level security;

create policy whatsapp_inbound_messages_select on public.whatsapp_inbound_messages
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.current_role() in ('ADMIN', 'JEFATURA'));

-- Sin policies de insert/update/delete para "authenticated": solo el
-- Edge Function (service_role, bypassa RLS) escribe esta tabla.

-- -------------------------------------------------------------------------
-- app.record_trip_event: inserta el evento y actualiza el estatus del
-- viaje de forma atómica. Es el único punto de escritura que usa el
-- webhook de WhatsApp (vía service_role) para reportar EN_TRANSITO,
-- DETENCION, REINICIO y UBICACION. La validación de geocerca (Fase 4) y el
-- cálculo de atrasos (Fase 5) se conectarán aquí mismo más adelante.
-- -------------------------------------------------------------------------
create or replace function app.record_trip_event(
  p_trip_id uuid,
  p_event_type public.trip_event_type,
  p_operator_id uuid,
  p_reported_via public.report_channel default 'whatsapp',
  p_lat double precision default null,
  p_lng double precision default null,
  p_raw_payload jsonb default null,
  p_notes text default null
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
    tenant_id, trip_id, operator_id, event_type, reported_via, lat, lng, raw_payload, notes
  ) values (
    v_tenant_id, p_trip_id, p_operator_id, p_event_type, p_reported_via, p_lat, p_lng, p_raw_payload, p_notes
  )
  returning * into v_event;

  v_new_status := case p_event_type
    when 'EN_TRANSITO' then 'EN_TRANSITO'
    when 'REINICIO' then 'EN_TRANSITO'
    when 'DETENCION' then 'DETENIDO'
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

-- Solo el Edge Function (service_role) invoca esta función: internamente
-- no valida tenant/rol del llamante, así que NO se otorga a "authenticated".
revoke all on function app.record_trip_event(
  uuid, public.trip_event_type, uuid, public.report_channel, double precision, double precision, jsonb, text
) from public;

grant execute on function app.record_trip_event(
  uuid, public.trip_event_type, uuid, public.report_channel, double precision, double precision, jsonb, text
) to service_role;

-- PostgREST (y por tanto supabase-js .rpc()) solo expone funciones del
-- schema "public" (ver supabase/config.toml: api.schemas). El schema "app"
-- es privado a propósito (alberga los helpers de RLS), así que se publica
-- un wrapper delgado en "public" únicamente para esta operación.
create or replace function public.record_trip_event(
  p_trip_id uuid,
  p_event_type public.trip_event_type,
  p_operator_id uuid,
  p_reported_via public.report_channel default 'whatsapp',
  p_lat double precision default null,
  p_lng double precision default null,
  p_raw_payload jsonb default null,
  p_notes text default null
)
returns public.trip_events
language sql
set search_path = public
as $$
  select * from app.record_trip_event(
    p_trip_id, p_event_type, p_operator_id, p_reported_via, p_lat, p_lng, p_raw_payload, p_notes
  )
$$;

revoke all on function public.record_trip_event(
  uuid, public.trip_event_type, uuid, public.report_channel, double precision, double precision, jsonb, text
) from public;

grant execute on function public.record_trip_event(
  uuid, public.trip_event_type, uuid, public.report_channel, double precision, double precision, jsonb, text
) to service_role;
