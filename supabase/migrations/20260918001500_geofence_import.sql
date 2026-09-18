-- =========================================================================
-- Fase 4: motor de geocercas — importador GeoJSON (Google My Maps -> GeoJSON).
-- =========================================================================

-- Permite reimportar el mismo mapa (actualiza en vez de duplicar) usando el
-- nombre del parador como clave dentro del cliente.
alter table public.geofences
  add constraint geofences_tenant_client_name_key unique (tenant_id, client_id, name);

-- -------------------------------------------------------------------------
-- app.import_geofences: recorre un FeatureCollection GeoJSON y hace upsert
-- de cada feature como geocerca. Soporta:
--   - Polygon / MultiPolygon: se toman tal cual (típico de un polígono
--     dibujado a mano en Google My Maps).
--   - Point (+ propiedad "radius"/"radius_meters" en metros, default 100):
--     se convierte en un círculo vía ST_Buffer sobre geography (típico de
--     un "parador" marcado como pin en My Maps).
-- Devuelve una fila de resultado por feature para que la UI pueda mostrar
-- qué se importó, qué se omitió y por qué.
-- -------------------------------------------------------------------------
create or replace function app.import_geofences(
  p_client_id uuid,
  p_geojson jsonb,
  p_category text default 'PARADOR_AUTORIZADO',
  p_source text default 'google_my_maps'
)
returns table (feature_name text, status text, detail text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
  v_feature jsonb;
  v_geometry jsonb;
  v_props jsonb;
  v_name text;
  v_radius double precision;
  v_geom geometry;
  v_type text;
begin
  select tenant_id into v_tenant_id from public.clients where id = p_client_id;
  if v_tenant_id is null then
    raise exception 'import_geofences: el cliente % no existe', p_client_id;
  end if;
  if v_tenant_id <> app.current_tenant_id() or not app.is_admin() then
    raise exception 'import_geofences: no autorizado';
  end if;

  if (p_geojson ->> 'type') is distinct from 'FeatureCollection' then
    raise exception 'import_geofences: se espera un GeoJSON de tipo FeatureCollection';
  end if;

  for v_feature in select * from jsonb_array_elements(coalesce(p_geojson -> 'features', '[]'::jsonb))
  loop
    v_props := coalesce(v_feature -> 'properties', '{}'::jsonb);
    v_geometry := v_feature -> 'geometry';
    v_type := v_geometry ->> 'type';
    v_name := coalesce(nullif(v_props ->> 'name', ''), nullif(v_props ->> 'Name', ''), 'Parador sin nombre');

    begin
      if v_type = 'Point' then
        v_radius := coalesce(
          (v_props ->> 'radius')::double precision,
          (v_props ->> 'radius_meters')::double precision,
          100
        );
        v_geom := st_buffer(
          st_setsrid(st_geomfromgeojson(v_geometry::text), 4326)::geography,
          v_radius
        )::geometry;
      elsif v_type in ('Polygon', 'MultiPolygon') then
        v_geom := st_setsrid(st_geomfromgeojson(v_geometry::text), 4326);
      else
        feature_name := v_name;
        status := 'omitido';
        detail := format('tipo de geometría no soportado: %s', coalesce(v_type, 'null'));
        return next;
        continue;
      end if;

      insert into public.geofences (tenant_id, client_id, name, category, geom, source, active, imported_at)
      values (v_tenant_id, p_client_id, v_name, p_category, v_geom::geography, p_source, true, now())
      on conflict (tenant_id, client_id, name) do update
        set geom = excluded.geom,
            category = excluded.category,
            source = excluded.source,
            active = true,
            imported_at = now();

      feature_name := v_name;
      status := 'ok';
      detail := null;
      return next;
    exception when others then
      feature_name := v_name;
      status := 'error';
      detail := sqlerrm;
      return next;
    end;
  end loop;

  return;
end;
$$;

-- A diferencia de record_trip_event, esta función SÍ valida internamente
-- tenant + rol del llamante, así que es seguro exponerla a "authenticated"
-- (solo un ADMIN de ese tenant puede importar geocercas de sus clientes).
revoke all on function app.import_geofences(uuid, jsonb, text, text) from public;
grant execute on function app.import_geofences(uuid, jsonb, text, text) to authenticated, service_role;

-- Wrapper en "public" porque PostgREST solo expone ese schema (ver
-- supabase/config.toml). Mismo motivo que public.record_trip_event.
create or replace function public.import_geofences(
  p_client_id uuid,
  p_geojson jsonb,
  p_category text default 'PARADOR_AUTORIZADO',
  p_source text default 'google_my_maps'
)
returns table (feature_name text, status text, detail text)
language sql
set search_path = public
as $$
  select * from app.import_geofences(p_client_id, p_geojson, p_category, p_source)
$$;

revoke all on function public.import_geofences(uuid, jsonb, text, text) from public;
grant execute on function public.import_geofences(uuid, jsonb, text, text) to authenticated, service_role;

-- -------------------------------------------------------------------------
-- Vista de solo lectura para pintar las geocercas en un mapa desde el
-- dashboard. security_invoker=true: aplica las policies de RLS de
-- geofences bajo la identidad de quien consulta (no del dueño de la vista).
-- -------------------------------------------------------------------------
create view public.geofences_geojson
with (security_invoker = true)
as
select
  id,
  tenant_id,
  client_id,
  name,
  category,
  active,
  source,
  imported_at,
  extensions.st_asgeojson(geom::extensions.geometry)::json as geometry
from public.geofences;

grant select on public.geofences_geojson to authenticated;
