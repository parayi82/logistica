-- =========================================================================
-- Fase 12: prueba de entrega (POD). Extiende el flujo de "Evidencia" del
-- bot con un paso específico de cierre de viaje: foto + nombre de quien
-- recibió la carga. A diferencia de EVIDENCIA (que no cambia el estatus
-- del viaje), ENTREGA sí lo hace: marca el viaje como FINALIZADO.
-- =========================================================================

alter type public.trip_event_type add value if not exists 'ENTREGA';
alter type public.evidence_type add value if not exists 'POD';

-- Misma firma exacta que la definición original (Fase 3) — create or
-- replace SÍ reemplaza correctamente aquí porque no cambian los
-- parámetros, solo el CASE interno. (Ver la migración de la Fase 9 para
-- el bug real que pasa cuando SÍ cambia la firma: ese caso necesita un
-- drop function explícito, este no.)
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
