-- Catálogo configurable por tenant de puntos de protocolo a verificar
create table public.protocol_checklist_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null,
  description text not null,
  active boolean not null default true,
  unique (tenant_id, code)
);

create index protocol_checklist_items_tenant_id_idx on public.protocol_checklist_items (tenant_id);

-- Resultado de cada verificación de checklist por viaje
create table public.trip_compliance_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  checklist_item_id uuid not null references public.protocol_checklist_items (id) on delete cascade,
  status public.compliance_status not null default 'NA',
  checked_at timestamptz,
  checked_by uuid references public.profiles (id) on delete set null,
  notes text,
  unique (trip_id, checklist_item_id)
);

create index trip_compliance_checks_tenant_id_idx on public.trip_compliance_checks (tenant_id);
create index trip_compliance_checks_trip_id_idx on public.trip_compliance_checks (trip_id);

-- Reporte de turno generado en PDF y enviado por WhatsApp (Fase 6)
create table public.shift_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  shift_id uuid not null references public.shifts (id) on delete restrict,
  client_id uuid references public.clients (id) on delete set null,
  report_date date not null,
  generated_at timestamptz,
  pdf_storage_path text,
  sent_at timestamptz,
  sent_to jsonb,
  status public.shift_report_status not null default 'PENDIENTE',
  created_at timestamptz not null default now()
);

create index shift_reports_tenant_id_idx on public.shift_reports (tenant_id);
create index shift_reports_shift_id_idx on public.shift_reports (shift_id, report_date desc);
