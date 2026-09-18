-- =========================================================================
-- Fase 9: escalamiento automático a SEGURIDAD_PATRIMONIAL.
--
-- Se apoya en la Fase 8 (mismo app.notify_trip_alert / send-trip-alert),
-- pero es una señal distinta: la alerta "SIN_REPORTE" de la Fase 8 detecta
-- silencio (nadie reportó nada), sin importar si hay evidencia. Esta
-- detecta específicamente un viaje DETENIDO que ya lleva más tiempo del
-- permitido *sin evidencia fotográfica adjunta* durante esa detención —
-- una señal más seria (posible incidente, no solo demora) que se dirige
-- solo a Seguridad Patrimonial, no a Jefatura.
-- =========================================================================

alter table public.protocol_thresholds
  add column security_escalation_minutes integer not null default 45;

comment on column public.protocol_thresholds.security_escalation_minutes is
  'Minutos DETENIDO sin evidencia adjunta antes de escalar automáticamente a Seguridad Patrimonial (Fase 9). Suele ser mayor que stop_without_evidence_minutes: ese ya generó la alerta general de la Fase 8, esta es la escalada si nadie resolvió el pendiente.';

-- ---------------------------------------------------------------------
-- app.notify_trip_alert ahora acepta a quién dirigir la alerta (por
-- defecto los mismos 2 roles de siempre, para no romper los disparadores
-- de la Fase 8 que no pasan este argumento).
-- ---------------------------------------------------------------------
create or replace function app.notify_trip_alert(
  p_trip_id uuid,
  p_alert_type text,
  p_detail text,
  p_cooldown_minutes integer default 20,
  p_target_roles text[] default array['JEFATURA', 'SEGURIDAD_PATRIMONIAL']
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
    when 'ESCALAMIENTO_SEGURIDAD' then '🛑'
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
    return;
  end if;

  select count(*) into v_recent_count
  from public.trip_alerts
  where trip_id = p_trip_id
    and alert_type = p_alert_type
    and created_at > now() - make_interval(mins => p_cooldown_minutes);

  if v_recent_count > 0 then
    return;
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
    body := jsonb_build_object(
      'trip_id', p_trip_id,
      'alert_type', p_alert_type,
      'message', v_message,
      'target_roles', to_jsonb(p_target_roles)
    ),
    timeout_milliseconds := 10000
  );
end;
$$;

-- ---------------------------------------------------------------------
-- app.check_stopped_without_evidence: barrido periódico (se agrega al
-- mismo cron de la Fase 8, ver más abajo). Un viaje DETENIDO escala solo
-- si, desde que entró a ese estatus (current_status_since — solo cambia
-- con eventos DETENCION/EN_TRANSITO/REINICIO), pasó el umbral Y no se
-- subió ninguna evidencia ligada a un evento posterior a ese momento.
-- ---------------------------------------------------------------------
create or replace function app.check_stopped_without_evidence()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip record;
  v_minutes_stopped numeric;
begin
  for v_trip in
    select
      t.id as trip_id,
      t.current_status_since,
      pt.security_escalation_minutes
    from public.trips t
    join public.protocol_thresholds pt on pt.tenant_id = t.tenant_id
    where t.status = 'DETENIDO'
  loop
    v_minutes_stopped := extract(epoch from (now() - v_trip.current_status_since)) / 60;
    if v_minutes_stopped < v_trip.security_escalation_minutes then
      continue;
    end if;

    if exists (
      select 1
      from public.trip_evidence ev
      join public.trip_events te on te.id = ev.trip_event_id
      where te.trip_id = v_trip.trip_id
        and ev.uploaded_at >= v_trip.current_status_since
    ) then
      continue; -- ya hay evidencia de esta detención, no escala
    end if;

    perform app.notify_trip_alert(
      v_trip.trip_id,
      'ESCALAMIENTO_SEGURIDAD',
      format('lleva %s min DETENIDO sin evidencia adjunta — requiere atención de Seguridad Patrimonial', round(v_minutes_stopped)),
      30,
      array['SEGURIDAD_PATRIMONIAL']
    );
  end loop;
end;
$$;

-- Reprograma el mismo barrido de la Fase 8 para que también corra este
-- segundo chequeo cada 5 minutos (mismo cron.job, no uno nuevo).
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
  $cron$ select app.check_silent_trips(); select app.check_stopped_without_evidence(); $cron$
);
