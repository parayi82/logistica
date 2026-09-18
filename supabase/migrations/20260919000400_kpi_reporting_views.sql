-- =========================================================================
-- Fase 10: KPIs históricos (cumplimiento/atrasos por operador, cliente y
-- ruta a lo largo del tiempo, no solo el turno vigente).
--
-- En vez de una función de agregación parametrizada (más rígida: cada
-- combinación de agrupación/filtro nuevo requeriría tocar SQL), se
-- exponen 2 vistas "planas" con security_invoker=true (respetan las
-- policies de RLS de quien consulta, igual que geofences_geojson de la
-- Fase 4) con el contexto de operador/cliente/ruta ya resuelto. El
-- dashboard filtra por rango de fechas vía .gte()/.lte() y agrupa/agrega
-- en el navegador — flexible sin tener que anticipar cada reporte posible.
-- =========================================================================

create view public.trip_delays_report
with (security_invoker = true)
as
select
  td.id,
  td.tenant_id,
  td.trip_id,
  td.delay_minutes,
  td.justified,
  td.created_at,
  t.route_name,
  t.client_id,
  t.operator_id,
  c.name as client_name,
  o.full_name as operator_name
from public.trip_delays td
join public.trips t on t.id = td.trip_id
left join public.clients c on c.id = t.client_id
left join public.operators o on o.id = t.operator_id;

create view public.trip_alerts_report
with (security_invoker = true)
as
select
  ta.id,
  ta.tenant_id,
  ta.trip_id,
  ta.alert_type,
  ta.created_at,
  t.route_name,
  t.client_id,
  t.operator_id,
  c.name as client_name,
  o.full_name as operator_name
from public.trip_alerts ta
join public.trips t on t.id = ta.trip_id
left join public.clients c on c.id = t.client_id
left join public.operators o on o.id = t.operator_id;
