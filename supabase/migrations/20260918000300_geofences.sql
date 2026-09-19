-- Geocercas de paraderos autorizados por cliente (importadas desde
-- Google My Maps -> GeoJSON, Fase 4). Se guarda el polígono con PostGIS
-- para poder validar coordenadas con ST_Contains / ST_DWithin.
create table public.geofences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  category text not null default 'PARADOR_AUTORIZADO',
  geom extensions.geography(Polygon, 4326) not null,
  source text not null default 'google_my_maps',
  imported_at timestamptz not null default now(),
  active boolean not null default true
);

create index geofences_tenant_id_idx on public.geofences (tenant_id);
create index geofences_client_id_idx on public.geofences (client_id);
create index geofences_geom_gix on public.geofences using gist (geom);
