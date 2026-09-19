-- Bucket privado para evidencia fotográfica de viajes. Convención de ruta:
-- {tenant_id}/{trip_id}/{archivo}. El Edge Function de WhatsApp sube aquí
-- con service_role; el dashboard puede leer/subir según el mismo criterio
-- de visibilidad que trip_evidence.
insert into storage.buckets (id, name, public)
values ('trip-evidence', 'trip-evidence', false)
on conflict (id) do nothing;

create policy trip_evidence_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'trip-evidence'
    and (storage.foldername(name))[1] = app.current_tenant_id()::text
    and exists (
      select 1 from public.trips t
      where t.id = ((storage.foldername(name))[2])::uuid
        and app.can_view_client(t.client_id)
    )
  );

create policy trip_evidence_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'trip-evidence'
    and (storage.foldername(name))[1] = app.current_tenant_id()::text
    and app.current_role() in ('ADMIN', 'JEFATURA', 'MONITOR')
  );

create policy trip_evidence_storage_delete_admin on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'trip-evidence'
    and (storage.foldername(name))[1] = app.current_tenant_id()::text
    and app.is_admin()
  );
