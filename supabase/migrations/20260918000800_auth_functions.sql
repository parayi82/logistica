-- Funciones auxiliares para RLS. SECURITY DEFINER + search_path fijo para
-- evitar recursión de RLS al consultar profiles/client_users, y para
-- prevenir "search path hijacking".

create or replace function app.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

create or replace function app.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
as $$
  select app.current_role() = 'ADMIN'
$$;

create or replace function app.has_client_access(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.client_users cu
    where cu.profile_id = auth.uid()
      and cu.client_id = p_client_id
  )
$$;

-- true si el usuario actual puede ver filas de este client_id: cualquier
-- rol operativo del tenant, o un CLIENTE_VIEW con acceso explícito.
create or replace function app.can_view_client(p_client_id uuid)
returns boolean
language sql
stable
as $$
  select case
    when app.current_role() = 'CLIENTE_VIEW' then app.has_client_access(p_client_id)
    else true
  end
$$;

revoke all on function app.current_tenant_id() from public;
revoke all on function app.current_role() from public;
revoke all on function app.is_admin() from public;
revoke all on function app.has_client_access(uuid) from public;
revoke all on function app.can_view_client(uuid) from public;

grant execute on function app.current_tenant_id() to authenticated;
grant execute on function app.current_role() to authenticated;
grant execute on function app.is_admin() to authenticated;
grant execute on function app.has_client_access(uuid) to authenticated;
grant execute on function app.can_view_client(uuid) to authenticated;
