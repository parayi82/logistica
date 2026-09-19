-- =========================================================================
-- Corrige un bug real introducido por la Fase 9: `create or replace
-- function app.notify_trip_alert(...)` con un 5º parámetro nuevo
-- (p_target_roles) NO reemplaza la versión de 4 parámetros de la Fase 8 —
-- Postgres solo reemplaza una función si la firma (tipos de parámetros)
-- es idéntica; con una firma distinta, crea una SEGUNDA función con el
-- mismo nombre (overload) en vez de sustituir la anterior.
--
-- Resultado: quedaron 2 versiones de app.notify_trip_alert coexistiendo.
-- Cualquier llamada con exactamente 4 argumentos (como la de
-- app.check_silent_trips, de la Fase 8) se volvió ambigua para Postgres
-- (¿la de 4 parámetros exacta, o la de 5 usando el default del último?),
-- y empezó a fallar con "function ... is not unique" — rompiendo el
-- barrido completo de alertas de las Fases 8 y 9 desde que se aplicó la
-- migración de la Fase 9, sin que ningún error apareciera al migrar (el
-- error solo ocurre en tiempo de ejecución del cron, al intentar llamar
-- la función).
-- =========================================================================

drop function if exists app.notify_trip_alert(uuid, text, text, integer);
