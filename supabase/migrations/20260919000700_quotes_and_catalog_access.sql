-- =========================================================================
-- Fase 14: alta de catálogos (clientes/operadores/vehículos) desde el
-- dashboard -antes solo ADMIN por SQL manual- y cotizaciones para enlazar
-- cliente + proveedor + camionero + unidad antes de confirmar el viaje.
-- =========================================================================

-- clients/operators/vehicles eran "for all ... is_admin()" (una sola policy
-- que cubre select/insert/update/delete); se reemplazan por el mismo
-- patrón ya usado en trips/providers: select amplio, insert/update para
-- ADMIN/JEFATURA/MONITOR, delete solo ADMIN.
drop policy if exists clients_write_admin on public.clients;
drop policy if exists operators_write_admin on public.operators;
drop policy if exists vehicles_write_admin on public.vehicles;

create policy clients_insert_operativo on public.clients
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  );

create policy clients_update_operativo on public.clients
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  )
  with check (tenant_id = app.current_tenant_id());

create policy clients_delete_admin on public.clients
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin());

create policy operators_insert_operativo on public.operators
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  );

create policy operators_update_operativo on public.operators
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  )
  with check (tenant_id = app.current_tenant_id());

create policy operators_delete_admin on public.operators
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin());

create policy vehicles_insert_operativo on public.vehicles
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  );

create policy vehicles_update_operativo on public.vehicles
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  )
  with check (tenant_id = app.current_tenant_id());

create policy vehicles_delete_admin on public.vehicles
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin());

-- -------------------------------------------------------------------------
-- Cotizaciones: registran la intención de un viaje (cliente + proveedor +
-- camionero + unidad propuestos, con tarifa) antes de confirmarlo como
-- viaje real. "Convertir a viaje" (desde el frontend) crea la fila en
-- trips y enlaza converted_trip_id; no hay trigger automático porque
-- confirmar un viaje real todavía necesita datos que la cotización no
-- tiene (turno, fecha de salida exacta).
-- -------------------------------------------------------------------------
create type public.quote_status as enum (
  'PENDIENTE',
  'APROBADA',
  'RECHAZADA',
  'CONVERTIDA'
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete restrict,
  provider_id uuid references public.providers (id) on delete set null,
  operator_id uuid references public.operators (id) on delete set null,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  route_name text,
  origin text,
  destination text,
  rate numeric(12, 2),
  currency text not null default 'MXN',
  status public.quote_status not null default 'PENDIENTE',
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  converted_trip_id uuid references public.trips (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index quotes_tenant_id_idx on public.quotes (tenant_id);
create index quotes_status_idx on public.quotes (status);

create trigger quotes_set_updated_at
  before update on public.quotes
  for each row
  execute function app.set_updated_at();

alter table public.quotes enable row level security;

-- Igual que la bitácora de protocolo: información operativa/comercial
-- interna, sin policy de select para CLIENTE_VIEW (no ve cotizaciones).
create policy quotes_select on public.quotes
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.current_role() <> 'CLIENTE_VIEW');

create policy quotes_insert_operativo on public.quotes
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  );

create policy quotes_update_operativo on public.quotes
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  )
  with check (tenant_id = app.current_tenant_id());

create policy quotes_delete_admin on public.quotes
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin());
