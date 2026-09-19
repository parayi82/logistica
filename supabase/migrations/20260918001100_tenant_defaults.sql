-- Aprovisiona automáticamente los umbrales de semáforo por defecto al
-- crear un tenant, para que el dashboard (Fase 2) siempre tenga una fila
-- de protocol_thresholds que leer.
create or replace function app.seed_tenant_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.protocol_thresholds (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;
  return new;
end;
$$;

create trigger tenants_seed_defaults
after insert on public.tenants
for each row execute function app.seed_tenant_defaults();
