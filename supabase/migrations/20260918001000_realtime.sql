-- Habilita Supabase Realtime para las tablas que alimentan el dashboard de
-- la torre de control (Fase 2).
alter table public.trips replica identity full;
alter table public.trip_events replica identity full;
alter table public.trip_delays replica identity full;

alter publication supabase_realtime add table public.trips;
alter publication supabase_realtime add table public.trip_events;
alter publication supabase_realtime add table public.trip_delays;
