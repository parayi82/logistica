-- =========================================================================
-- Fase 5: cálculo automático de atrasos.
--
-- "Hora esperada previamente registrada" se resuelve en dos niveles:
--   1) Si el viaje tiene checkpoints (trip_checkpoints) planeados, se usa
--      expected_departure_time del checkpoint donde el operador está
--      detenido (más preciso: viene de la planeación del despacho).
--   2) Si no hay checkpoints (tenant que todavía no los usa), se usa la
--      última DETENCION del viaje + protocol_thresholds.max_stop_minutes
--      (tiempo máximo de detención permitido por protocolo).
-- Sin ninguna de las dos referencias, no hay nada contra qué comparar y no
-- se genera atraso.
-- =========================================================================

alter table public.protocol_thresholds
  add column max_stop_minutes integer not null default 60;

comment on column public.protocol_thresholds.max_stop_minutes is
  'Minutos máximos de detención permitidos por protocolo antes de que un REINICIO se considere atrasado (fallback cuando el viaje no tiene trip_checkpoints planeados).';

create or replace function app.progress_trip_checkpoint_and_delay()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkpoint public.trip_checkpoints;
  v_expected timestamptz;
  v_last_detencion timestamptz;
  v_max_stop_minutes integer;
  v_delay_minutes integer;
begin
  if new.event_type = 'DETENCION' then
    -- Marca la llegada al siguiente checkpoint planeado que siga pendiente.
    update public.trip_checkpoints
    set actual_arrival_time = new.reported_at,
        status = 'EN_PARADA'
    where id = (
      select id from public.trip_checkpoints
      where trip_id = new.trip_id and actual_arrival_time is null
      order by sequence asc
      limit 1
    );
    return new;
  end if;

  if new.event_type <> 'REINICIO' then
    return new;
  end if;

  -- Checkpoint en el que el operador estaba detenido (llegó, no ha salido).
  select *
  into v_checkpoint
  from public.trip_checkpoints
  where trip_id = new.trip_id
    and actual_arrival_time is not null
    and actual_departure_time is null
  order by sequence asc
  limit 1;

  if found then
    update public.trip_checkpoints
    set actual_departure_time = new.reported_at,
        status = 'COMPLETADO'
    where id = v_checkpoint.id;
  end if;

  if found and v_checkpoint.expected_departure_time is not null then
    v_expected := v_checkpoint.expected_departure_time;
  else
    select reported_at
    into v_last_detencion
    from public.trip_events
    where trip_id = new.trip_id
      and event_type = 'DETENCION'
      and reported_at < new.reported_at
    order by reported_at desc
    limit 1;

    if v_last_detencion is null then
      return new; -- nada contra qué comparar
    end if;

    select max_stop_minutes into v_max_stop_minutes
    from public.protocol_thresholds
    where tenant_id = new.tenant_id;

    v_expected := v_last_detencion + make_interval(mins => coalesce(v_max_stop_minutes, 60));
  end if;

  v_delay_minutes := greatest(0, round(extract(epoch from (new.reported_at - v_expected)) / 60))::integer;

  if v_delay_minutes > 0 then
    insert into public.trip_delays (tenant_id, trip_id, trip_event_id, expected_time, actual_time, delay_minutes)
    values (new.tenant_id, new.trip_id, new.id, v_expected, new.reported_at, v_delay_minutes)
    on conflict (trip_event_id) do nothing;
  end if;

  return new;
end;
$$;

create trigger trip_events_progress_checkpoint_and_delay
after insert on public.trip_events
for each row execute function app.progress_trip_checkpoint_and_delay();
