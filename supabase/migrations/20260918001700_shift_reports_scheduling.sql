-- =========================================================================
-- Fase 6: soporte de base de datos para el reporte de turno automático.
-- =========================================================================

-- Un solo reporte por turno+fecha (siempre "consolidado", todos los
-- clientes del turno; client_id queda disponible para un futuro reporte
-- por cliente, que necesitaría revisar esta unicidad).
--
-- Un índice único PARCIAL (where client_id is null) sería más preciso,
-- pero PostgREST/supabase-js .upsert() genera `ON CONFLICT (columnas)`
-- sin poder expresar un WHERE ahí, así que un índice parcial no sirve
-- como arbiter para el upsert que hace el Edge Function. Por eso es un
-- constraint único normal.
alter table public.shift_reports
  add constraint shift_reports_shift_date_key unique (shift_id, report_date);

alter table public.shift_reports
  add column observations text;

comment on column public.shift_reports.observations is
  'Resumen generado automáticamente al crear el reporte; editable después por JEFATURA/ADMIN.';

-- Bucket privado para los PDFs de turno.
insert into storage.buckets (id, name, public)
values ('shift-reports', 'shift-reports', false)
on conflict (id) do nothing;

create policy shift_reports_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'shift-reports'
    and (storage.foldername(name))[1] = app.current_tenant_id()::text
    and app.current_role() in ('ADMIN', 'JEFATURA', 'SEGURIDAD_PATRIMONIAL')
  );

-- Solo el Edge Function (service_role) sube/borra reportes.

-- -------------------------------------------------------------------------
-- app.shifts_due_for_report: qué turnos ya cruzaron su hora de corte (en su
-- propio timezone y día de la semana) y todavía no tienen un reporte
-- GENERADO/ENVIADO para esa fecha. p_window_minutes acota la ventana hacia
-- atrás desde el corte (para no reprocesar turnos de hace muchas horas si
-- el cron se cae y se retrasa).
-- -------------------------------------------------------------------------
create or replace function app.shifts_due_for_report(p_window_minutes integer default 10)
returns table (shift_id uuid, tenant_id uuid, report_date date)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id as shift_id,
    s.tenant_id,
    (now() at time zone s.timezone)::date as report_date
  from public.shifts s
  where s.active
    and extract(isodow from (now() at time zone s.timezone))::int = any(s.days_of_week)
    and (now() at time zone s.timezone)::time
      between s.cutoff_time
      and (s.cutoff_time + make_interval(mins => p_window_minutes))
    and not exists (
      select 1
      from public.shift_reports r
      where r.shift_id = s.id
        and r.report_date = (now() at time zone s.timezone)::date
        and r.client_id is null
        and r.status in ('GENERADO', 'ENVIADO')
    )
$$;

-- No filtra por tenant del llamante (recorre todos a propósito, es el
-- barrido del scheduler): solo service_role, nunca "authenticated".
revoke all on function app.shifts_due_for_report(integer) from public;
grant execute on function app.shifts_due_for_report(integer) to service_role;

create or replace function public.shifts_due_for_report(p_window_minutes integer default 10)
returns table (shift_id uuid, tenant_id uuid, report_date date)
language sql
set search_path = public
as $$
  select * from app.shifts_due_for_report(p_window_minutes)
$$;

revoke all on function public.shifts_due_for_report(integer) from public;
grant execute on function public.shifts_due_for_report(integer) to service_role;
