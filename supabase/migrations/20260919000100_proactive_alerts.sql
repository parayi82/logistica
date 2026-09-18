-- =========================================================================
-- Fase 8: alertas proactivas por Telegram a JEFATURA/SEGURIDAD_PATRIMONIAL.
--
-- Tres disparadores distintos, todos convergiendo en app.notify_trip_alert:
--   1) Evento con coordenada FUERA de geocerca autorizada (inmediato, vía
--      trigger AFTER INSERT en trip_events).
--   2) Nuevo atraso calculado (inmediato, vía trigger AFTER INSERT en
--      trip_delays — Fase 5 ya solo inserta ahí cuando delay_minutes > 0).
--   3) Silencio prolongado sin reportar, más allá del umbral de semáforo
--      "rojo" (periódico, barrido de pg_cron cada 5 min — a diferencia de
--      1) y 2), el simple paso del tiempo no dispara ningún evento en la
--      base, así que no hay forma de detectarlo con un trigger).
--
-- app.notify_trip_alert aplica un cooldown por (trip_id, alert_type) para
-- no saturar Telegram con la misma alerta en cada barrido de 5 minutos
-- mientras la condición se mantiene.
-- =========================================================================

create table public.trip_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  alert_type text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index trip_alerts_tenant_id_idx on public.trip_alerts (tenant_id);
create index trip_alerts_trip_cooldown_idx on public.trip_alerts (trip_id, alert_type, created_at desc);

alter table public.trip_alerts enable row level security;

create policy trip_alerts_select on public.trip_alerts
  for select to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'SEGURIDAD_PATRIMONIAL')
  );

-- Solo el Edge Function/triggers (vía SECURITY DEFINER) escriben esta tabla.

-- ---------------------------------------------------------------------
-- app.notify_trip_alert: punto único de disparo de alertas. Arma el
-- mensaje con contexto del viaje, aplica el cooldown, registra la alerta,
-- y encola la llamada HTTP al Edge Function que realmente envía por
-- Telegram (fire-and-forget vía pg_net, igual que el barrido de reportes
-- de turno de la Fase 6 — reutiliza los mismos secrets de Vault).
-- ---------------------------------------------------------------------
create or replace function app.notify_trip_alert(
  p_trip_id uuid,
  p_alert_type text,
  p_detail text,
  p_cooldown_minutes integer default 20
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
  v_message text;
  v_icon text;
  v_project_url text;
  v_service_role_key text;
  v_recent_count integer;
begin
  v_icon := case p_alert_type
    when 'FUERA_DE_GEOCERCA' then '🚨'
    when 'ATRASO' then '⏱️'
    when 'SIN_REPORTE' then '🔴'
    else '⚠️'
  end;

  select
    t.tenant_id,
    format('%s %s — %s (%s): %s', v_icon, coalesce(o.full_name, 'Operador'), t.route_name, coalesce(c.name, 'Cliente'), p_detail)
  into v_tenant_id, v_message
  from public.trips t
  left join public.operators o on o.id = t.operator_id
  left join public.clients c on c.id = t.client_id
  where t.id = p_trip_id;

  if v_tenant_id is null then
    return; -- viaje no existe; no debería pasar, pero no hay nada que notificar
  end if;

  select count(*) into v_recent_count
  from public.trip_alerts
  where trip_id = p_trip_id
    and alert_type = p_alert_type
    and created_at > now() - make_interval(mins => p_cooldown_minutes);

  if v_recent_count > 0 then
    return; -- ya se notificó este mismo tipo de alerta recientemente, evita spam
  end if;

  insert into public.trip_alerts (tenant_id, trip_id, alert_type, message)
  values (v_tenant_id, p_trip_id, p_alert_type, v_message);

  select decrypted_secret into v_project_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_service_role_key from vault.decrypted_secrets where name = 'service_role_key';

  if v_project_url is null or v_service_role_key is null then
    raise warning 'notify_trip_alert: faltan los secrets de Vault (project_url/service_role_key); alerta guardada pero no enviada.';
    return;
  end if;

  perform net.http_post(
    url := v_project_url || '/functions/v1/send-trip-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := jsonb_build_object('trip_id', p_trip_id, 'alert_type', p_alert_type, 'message', v_message),
    timeout_milliseconds := 10000
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Disparador 1: coordenada fuera de geocerca autorizada.
-- ---------------------------------------------------------------------
create or replace function app.trip_events_notify_geofence_violation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.geofence_validation_status = 'FUERA' then
    perform app.notify_trip_alert(
      new.trip_id,
      'FUERA_DE_GEOCERCA',
      format('reportó fuera de geocerca autorizada (lat %s, lng %s)', new.lat, new.lng)
    );
  end if;
  return new;
end;
$$;

create trigger trip_events_notify_geofence_violation
after insert on public.trip_events
for each row execute function app.trip_events_notify_geofence_violation();

-- ---------------------------------------------------------------------
-- Disparador 2: nuevo atraso calculado (Fase 5 ya filtra delay_minutes > 0).
-- ---------------------------------------------------------------------
create or replace function app.trip_delays_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app.notify_trip_alert(
    new.trip_id,
    'ATRASO',
    format(
      '%s min de atraso (esperado %s, real %s)',
      new.delay_minutes,
      to_char(new.expected_time, 'HH24:MI'),
      to_char(new.actual_time, 'HH24:MI')
    )
  );
  return new;
end;
$$;

create trigger trip_delays_notify
after insert on public.trip_delays
for each row execute function app.trip_delays_notify();

-- ---------------------------------------------------------------------
-- Disparador 3: silencio prolongado (rojo por tiempo, no por evento).
-- Replica en SQL la misma regla que src/lib/semaforo.ts usa en el
-- navegador (DETENIDO compara contra stop_without_evidence_minutes,
-- cualquier otro estatus activo contra yellow_max_minutes). Cooldown más
-- largo (30 min) porque, a diferencia de 1) y 2), esta condición persiste
-- barrido tras barrido mientras el operador no reporte nada.
-- ---------------------------------------------------------------------
create or replace function app.check_silent_trips()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip record;
  v_minutes_since numeric;
begin
  for v_trip in
    select
      t.id as trip_id,
      t.status,
      greatest(
        t.current_status_since,
        coalesce((select max(te.reported_at) from public.trip_events te where te.trip_id = t.id), t.current_status_since)
      ) as reference_time,
      case when t.status = 'DETENIDO' then pt.stop_without_evidence_minutes else pt.yellow_max_minutes end as limit_minutes
    from public.trips t
    join public.protocol_thresholds pt on pt.tenant_id = t.tenant_id
    where t.status in ('PROGRAMADO', 'EN_TRANSITO', 'DETENIDO')
  loop
    v_minutes_since := extract(epoch from (now() - v_trip.reference_time)) / 60;
    if v_minutes_since >= v_trip.limit_minutes then
      perform app.notify_trip_alert(
        v_trip.trip_id,
        'SIN_REPORTE',
        format('lleva %s min sin reportar (estatus %s)', round(v_minutes_since), v_trip.status),
        30
      );
    end if;
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'trip-silence-alert-sweep') then
    perform cron.unschedule('trip-silence-alert-sweep');
  end if;
end
$$;

select cron.schedule(
  'trip-silence-alert-sweep',
  '*/5 * * * *',
  $cron$ select app.check_silent_trips(); $cron$
);
