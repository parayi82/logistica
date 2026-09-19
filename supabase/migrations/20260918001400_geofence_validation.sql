-- =========================================================================
-- Fase 4: motor de geocercas — validación automática.
-- Cualquier trip_event que llegue con lat/lng (sin importar el canal o el
-- event_type) se valida contra las geocercas activas del cliente del viaje.
-- =========================================================================
create or replace function app.validate_trip_event_geofence()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_client_id uuid;
  v_geofence_id uuid;
begin
  if new.lat is null or new.lng is null then
    return new;
  end if;

  select client_id into v_client_id
  from public.trips
  where id = new.trip_id;

  select g.id into v_geofence_id
  from public.geofences g
  where g.tenant_id = new.tenant_id
    and g.client_id = v_client_id
    and g.active
    and st_contains(
      g.geom::geometry,
      st_setsrid(st_makepoint(new.lng, new.lat), 4326)
    )
  order by g.imported_at desc
  limit 1;

  new.geofence_match_id := v_geofence_id;
  new.geofence_validation_status := case
    when v_geofence_id is not null then 'DENTRO'
    else 'FUERA'
  end;

  return new;
end;
$$;

create trigger trip_events_validate_geofence
before insert or update of lat, lng on public.trip_events
for each row execute function app.validate_trip_event_geofence();
