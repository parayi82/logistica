-- =========================================================================
-- Fase 6: programación del job que dispara generate-shift-report.
--
-- No hay una sola "hora de corte" global (cada shift tiene la suya, en su
-- propio timezone), así que en vez de un cron por turno, este job corre
-- cada 5 minutos y delega en la Edge Function (vía
-- app.shifts_due_for_report) decidir qué turnos ya cruzaron su corte.
--
-- Nunca se hardcodea la project URL ni la service_role key aquí: se leen
-- de Supabase Vault en tiempo de ejecución. Ver README para el comando de
-- una sola vez que crea esos secrets después de desplegar (vault.create_secret).
-- =========================================================================

-- En Supabase, pg_cron/pg_net normalmente ya están disponibles para
-- CREATE EXTENSION sin tocar configuración del servidor. Si esta línea
-- falla con un error de permisos, actívalos primero desde el Dashboard:
-- Database → Extensions → pg_cron / pg_net.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'generate-shift-report-sweep') then
    perform cron.unschedule('generate-shift-report-sweep');
  end if;
end
$$;

select cron.schedule(
  'generate-shift-report-sweep',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/generate-shift-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  ) as request_id;
  $cron$
);
