-- Eventos reportados por el operador (vía WhatsApp, dashboard o API)
create table public.trip_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  operator_id uuid references public.operators (id) on delete set null,
  event_type public.trip_event_type not null,
  reported_at timestamptz not null default now(),
  reported_via public.report_channel not null default 'dashboard',
  lat double precision,
  lng double precision,
  geofence_match_id uuid references public.geofences (id) on delete set null,
  geofence_validation_status public.geofence_validation_status not null default 'SIN_VALIDAR',
  raw_payload jsonb,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index trip_events_tenant_id_idx on public.trip_events (tenant_id);
create index trip_events_trip_id_idx on public.trip_events (trip_id, reported_at desc);
create index trip_events_event_type_idx on public.trip_events (event_type);

-- Atrasos calculados automáticamente al recibir un evento REINICIO (Fase 5)
create table public.trip_delays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  trip_event_id uuid not null references public.trip_events (id) on delete cascade,
  expected_time timestamptz not null,
  actual_time timestamptz not null,
  delay_minutes integer not null,
  reason text,
  justified boolean not null default false,
  justified_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (trip_event_id)
);

create index trip_delays_tenant_id_idx on public.trip_delays (tenant_id);
create index trip_delays_trip_id_idx on public.trip_delays (trip_id);

-- Evidencia (fotos / ubicación) adjunta a un evento
create table public.trip_evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  trip_event_id uuid not null references public.trip_events (id) on delete cascade,
  evidence_type public.evidence_type not null,
  storage_path text not null,
  uploaded_at timestamptz not null default now()
);

create index trip_evidence_tenant_id_idx on public.trip_evidence (tenant_id);
create index trip_evidence_trip_id_idx on public.trip_evidence (trip_id);
