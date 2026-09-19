-- Viajes
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete restrict,
  shift_id uuid not null references public.shifts (id) on delete restrict,
  operator_id uuid not null references public.operators (id) on delete restrict,
  vehicle_id uuid not null references public.vehicles (id) on delete restrict,
  route_name text not null,
  origin text not null,
  destination text not null,
  status public.trip_status not null default 'PROGRAMADO',
  scheduled_departure timestamptz,
  actual_departure timestamptz,
  scheduled_arrival timestamptz,
  actual_arrival timestamptz,
  current_status_since timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index trips_tenant_id_idx on public.trips (tenant_id);
create index trips_client_id_idx on public.trips (client_id);
create index trips_shift_id_idx on public.trips (shift_id);
create index trips_status_idx on public.trips (status);

-- Paradas/checkpoints esperados de la ruta (para comparar hora esperada
-- vs. hora real de reinicio y calcular atrasos en la Fase 5)
create table public.trip_checkpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  geofence_id uuid references public.geofences (id) on delete set null,
  sequence integer not null,
  expected_arrival_time timestamptz,
  expected_departure_time timestamptz,
  actual_arrival_time timestamptz,
  actual_departure_time timestamptz,
  status text not null default 'PENDIENTE',
  unique (trip_id, sequence)
);

create index trip_checkpoints_tenant_id_idx on public.trip_checkpoints (tenant_id);
create index trip_checkpoints_trip_id_idx on public.trip_checkpoints (trip_id);
