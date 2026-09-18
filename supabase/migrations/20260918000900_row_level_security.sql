-- =========================================================================
-- Row Level Security: aislamiento por tenant y por rol en todas las tablas.
-- service_role (usado por Edge Functions / jobs) ignora RLS por diseño de
-- Supabase, por lo que estas policies aplican a los clientes anon/authenticated.
-- =========================================================================

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.client_users enable row level security;
alter table public.operators enable row level security;
alter table public.vehicles enable row level security;
alter table public.shifts enable row level security;
alter table public.protocol_thresholds enable row level security;
alter table public.geofences enable row level security;
alter table public.trips enable row level security;
alter table public.trip_checkpoints enable row level security;
alter table public.trip_events enable row level security;
alter table public.trip_delays enable row level security;
alter table public.trip_evidence enable row level security;
alter table public.protocol_checklist_items enable row level security;
alter table public.trip_compliance_checks enable row level security;
alter table public.shift_reports enable row level security;
alter table public.whatsapp_contacts enable row level security;
alter table public.whatsapp_conversation_state enable row level security;
alter table public.audit_log enable row level security;

-- Salvaguarda: solo un ADMIN puede cambiar role/tenant_id/active de un perfil,
-- incluso si la policy de UPDATE permitiera al propio usuario editar su fila.
create or replace function app.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if app.is_admin() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.tenant_id is distinct from old.tenant_id
     or new.active is distinct from old.active then
    raise exception 'Solo un ADMIN puede modificar role, tenant_id o active de un perfil';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_privileged_fields
before update on public.profiles
for each row execute function app.protect_profile_privileged_fields();

-- ---------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------
create policy tenants_select on public.tenants
  for select to authenticated
  using (id = app.current_tenant_id());

create policy tenants_update_admin on public.tenants
  for update to authenticated
  using (id = app.current_tenant_id() and app.is_admin())
  with check (id = app.current_tenant_id() and app.is_admin());

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and (app.current_role() <> 'CLIENTE_VIEW' or id = auth.uid())
  );

create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

create policy profiles_update on public.profiles
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and (app.is_admin() or id = auth.uid())
  )
  with check (tenant_id = app.current_tenant_id());

create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin());

-- ---------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------
create policy clients_select on public.clients
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.can_view_client(id));

create policy clients_write_admin on public.clients
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

-- ---------------------------------------------------------------------
-- client_users
-- ---------------------------------------------------------------------
create policy client_users_select on public.client_users
  for select to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and (app.is_admin() or profile_id = auth.uid())
  );

create policy client_users_write_admin on public.client_users
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

-- ---------------------------------------------------------------------
-- Catálogos operativos: operators, vehicles, shifts, protocol_thresholds,
-- protocol_checklist_items. Visibles para todos los roles internos del
-- tenant (no para CLIENTE_VIEW); solo ADMIN los administra.
-- ---------------------------------------------------------------------
create policy operators_select on public.operators
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.current_role() <> 'CLIENTE_VIEW');

create policy operators_write_admin on public.operators
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

create policy vehicles_select on public.vehicles
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.current_role() <> 'CLIENTE_VIEW');

create policy vehicles_write_admin on public.vehicles
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

create policy shifts_select on public.shifts
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.current_role() <> 'CLIENTE_VIEW');

create policy shifts_write_admin on public.shifts
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

create policy protocol_thresholds_select on public.protocol_thresholds
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.current_role() <> 'CLIENTE_VIEW');

create policy protocol_thresholds_write_admin on public.protocol_thresholds
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

create policy protocol_checklist_items_select on public.protocol_checklist_items
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.current_role() <> 'CLIENTE_VIEW');

create policy protocol_checklist_items_write_admin on public.protocol_checklist_items
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

-- ---------------------------------------------------------------------
-- geofences
-- ---------------------------------------------------------------------
create policy geofences_select on public.geofences
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.can_view_client(client_id));

create policy geofences_write_admin on public.geofences
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

-- ---------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------
create policy trips_select on public.trips
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.can_view_client(client_id));

create policy trips_insert_operativo on public.trips
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  );

create policy trips_update_operativo on public.trips
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  )
  with check (tenant_id = app.current_tenant_id());

create policy trips_delete_admin on public.trips
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin());

-- ---------------------------------------------------------------------
-- trip_checkpoints (visibilidad heredada del viaje)
-- ---------------------------------------------------------------------
create policy trip_checkpoints_select on public.trip_checkpoints
  for select to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and exists (
      select 1 from public.trips t
      where t.id = trip_checkpoints.trip_id
        and app.can_view_client(t.client_id)
    )
  );

create policy trip_checkpoints_write_operativo on public.trip_checkpoints
  for all to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  )
  with check (tenant_id = app.current_tenant_id());

-- ---------------------------------------------------------------------
-- trip_events: log operativo, tratado como append-only desde el cliente
-- (solo ADMIN puede corregir/eliminar un evento mal registrado).
-- ---------------------------------------------------------------------
create policy trip_events_select on public.trip_events
  for select to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and exists (
      select 1 from public.trips t
      where t.id = trip_events.trip_id
        and app.can_view_client(t.client_id)
    )
  );

create policy trip_events_insert_operativo on public.trip_events
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  );

create policy trip_events_update_admin on public.trip_events
  for update to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id());

create policy trip_events_delete_admin on public.trip_events
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin());

-- ---------------------------------------------------------------------
-- trip_delays
-- ---------------------------------------------------------------------
create policy trip_delays_select on public.trip_delays
  for select to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and exists (
      select 1 from public.trips t
      where t.id = trip_delays.trip_id
        and app.can_view_client(t.client_id)
    )
  );

create policy trip_delays_insert_operativo on public.trip_delays
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  );

create policy trip_delays_update_justificacion on public.trip_delays
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA')
  )
  with check (tenant_id = app.current_tenant_id());

create policy trip_delays_delete_admin on public.trip_delays
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin());

-- ---------------------------------------------------------------------
-- trip_evidence
-- ---------------------------------------------------------------------
create policy trip_evidence_select on public.trip_evidence
  for select to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and exists (
      select 1 from public.trips t
      where t.id = trip_evidence.trip_id
        and app.can_view_client(t.client_id)
    )
  );

create policy trip_evidence_insert_operativo on public.trip_evidence
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  );

create policy trip_evidence_delete_admin on public.trip_evidence
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin());

-- ---------------------------------------------------------------------
-- trip_compliance_checks
-- ---------------------------------------------------------------------
create policy trip_compliance_checks_select on public.trip_compliance_checks
  for select to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and exists (
      select 1 from public.trips t
      where t.id = trip_compliance_checks.trip_id
        and app.can_view_client(t.client_id)
    )
  );

create policy trip_compliance_checks_write_operativo on public.trip_compliance_checks
  for all to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  )
  with check (tenant_id = app.current_tenant_id());

-- ---------------------------------------------------------------------
-- shift_reports
-- ---------------------------------------------------------------------
create policy shift_reports_select on public.shift_reports
  for select to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and (
      app.current_role() <> 'CLIENTE_VIEW'
      or (client_id is not null and app.has_client_access(client_id))
    )
  );

create policy shift_reports_write_admin on public.shift_reports
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

-- ---------------------------------------------------------------------
-- whatsapp_contacts / whatsapp_conversation_state
-- Estas tablas las escribe principalmente el Edge Function del webhook
-- con service_role (bypassa RLS). Desde el dashboard solo son visibles
-- para ADMIN/JEFATURA con fines de soporte/depuración.
-- ---------------------------------------------------------------------
create policy whatsapp_contacts_select on public.whatsapp_contacts
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.current_role() in ('ADMIN', 'JEFATURA'));

create policy whatsapp_contacts_write_admin on public.whatsapp_contacts
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

create policy whatsapp_conversation_state_select on public.whatsapp_conversation_state
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.current_role() in ('ADMIN', 'JEFATURA'));

create policy whatsapp_conversation_state_write_admin on public.whatsapp_conversation_state
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

-- ---------------------------------------------------------------------
-- audit_log: log inmutable desde el cliente (append-only). Nadie puede
-- actualizarlo ni borrarlo vía RLS; solo service_role/superuser.
-- ---------------------------------------------------------------------
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.current_role() in ('ADMIN', 'JEFATURA', 'SEGURIDAD_PATRIMONIAL'));

create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id());
