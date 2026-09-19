-- Tenants: empresas transportistas que usan la plataforma
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'America/Mexico_City',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Perfiles de usuario (1:1 con auth.users). Se crean por un ADMIN o vía
-- service_role al invitar al usuario; no hay auto-signup público.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  role public.app_role not null,
  full_name text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index profiles_tenant_id_idx on public.profiles (tenant_id);

-- Clientes finales del tenant (dueños de la carga / paraderos autorizados)
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  code text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index clients_tenant_id_idx on public.clients (tenant_id);

-- Mapeo de usuarios CLIENTE_VIEW a los clientes que pueden ver
create table public.client_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (client_id, profile_id)
);

create index client_users_profile_id_idx on public.client_users (profile_id);

-- Operadores (choferes). No tienen cuenta en auth.users: interactúan
-- exclusivamente vía WhatsApp, identificados por su teléfono (Fase 3).
create table public.operators (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  full_name text not null,
  phone_e164 text not null,
  license_number text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, phone_e164)
);

create index operators_tenant_id_idx on public.operators (tenant_id);

-- Unidades / vehículos
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  plate text not null,
  economic_number text,
  vehicle_type text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, plate)
);

create index vehicles_tenant_id_idx on public.vehicles (tenant_id);

-- Turnos configurables por tenant (incluye hora de corte para el reporte)
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  starts_at time not null,
  ends_at time not null,
  cutoff_time time not null,
  timezone text not null default 'America/Mexico_City',
  days_of_week smallint[] not null default '{1,2,3,4,5,6,7}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index shifts_tenant_id_idx on public.shifts (tenant_id);

-- Umbrales de semáforo de cumplimiento, configurables por tenant (Fase 2)
create table public.protocol_thresholds (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  green_max_minutes integer not null default 15,
  yellow_max_minutes integer not null default 30,
  stop_without_evidence_minutes integer not null default 20,
  updated_at timestamptz not null default now()
);
