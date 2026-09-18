import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { computeShiftWindow } from "./window.ts";
import type { ChecklistRow, CoordinateCheckRow, RestartRow, ShiftReportData, StopRow } from "./types.ts";

type Db = ReturnType<typeof supabaseAdmin>;

interface RawTrip {
  id: string;
  client_id: string;
  route_name: string;
  operators: { full_name: string } | null;
  vehicles: { plate: string } | null;
}

interface RawTripEvent {
  id: string;
  trip_id: string;
  event_type: string;
  reported_at: string;
  lat: number | null;
  lng: number | null;
  geofence_match_id: string | null;
  geofence_validation_status: "DENTRO" | "FUERA" | "SIN_VALIDAR";
}

export async function gatherShiftReportData(
  db: Db,
  shiftId: string,
  cutoffInstant: Date
): Promise<ShiftReportData> {
  const { data: shift, error: shiftError } = await db
    .from("shifts")
    .select("id, tenant_id, name, timezone, starts_at, ends_at, cutoff_time")
    .eq("id", shiftId)
    .single();
  if (shiftError) throw shiftError;

  const { data: tenant, error: tenantError } = await db
    .from("tenants")
    .select("name")
    .eq("id", shift.tenant_id)
    .single();
  if (tenantError) throw tenantError;

  const window = computeShiftWindow(shift, cutoffInstant);

  const { data: tripsData, error: tripsError } = await db
    .from("trips")
    .select("id, client_id, route_name, operators(full_name), vehicles(plate)")
    .eq("shift_id", shiftId)
    .neq("status", "CANCELADO")
    .lte("created_at", window.end.toISOString())
    .gte("created_at", new Date(window.start.getTime() - 24 * 60 * 60_000).toISOString());
  if (tripsError) throw tripsError;

  const trips = (tripsData ?? []) as unknown as RawTrip[];
  const tripIds = trips.map((t) => t.id);
  const tripById = new Map(trips.map((t) => [t.id, t]));

  if (tripIds.length === 0) {
    return emptyReport(tenant.name, shift.name, shift.timezone, window, cutoffInstant);
  }

  const { data: allEvents, error: eventsError } = await db
    .from("trip_events")
    .select("id, trip_id, event_type, reported_at, lat, lng, geofence_match_id, geofence_validation_status")
    .in("trip_id", tripIds)
    .lte("reported_at", window.end.toISOString())
    .order("reported_at", { ascending: true });
  if (eventsError) throw eventsError;

  const events = (allEvents ?? []) as RawTripEvent[];
  const eventsByTrip = new Map<string, RawTripEvent[]>();
  for (const e of events) {
    const list = eventsByTrip.get(e.trip_id) ?? [];
    list.push(e);
    eventsByTrip.set(e.trip_id, list);
  }

  const inWindow = (e: RawTripEvent) => {
    const t = new Date(e.reported_at).getTime();
    return t >= window.start.getTime() && t <= window.end.getTime();
  };

  const clientIds = Array.from(new Set(trips.map((t) => t.client_id)));
  const { data: geofences } = await db.from("geofences").select("id, name").in("client_id", clientIds);
  const geofenceNameById = new Map((geofences ?? []).map((g) => [g.id, g.name]));

  const eventIds = events.map((e) => e.id);
  const { data: delays } = await db.from("trip_delays").select("trip_event_id, delay_minutes").in("trip_event_id", eventIds);
  const delayMinutesByEventId = new Map((delays ?? []).map((d) => [d.trip_event_id, d.delay_minutes]));

  const tripLabel = (tripId: string) => {
    const trip = tripById.get(tripId);
    return {
      operator: trip?.operators?.full_name ?? "—",
      vehicle: trip?.vehicles?.plate ?? "—",
      route: trip?.route_name ?? "—",
    };
  };

  const restartsWithoutEvidence: RestartRow[] = [];
  const stops: StopRow[] = [];
  const coordinateChecks: CoordinateCheckRow[] = [];

  for (const [tripId, tripEvents] of eventsByTrip) {
    const label = tripLabel(tripId);

    for (let i = 0; i < tripEvents.length; i++) {
      const event = tripEvents[i];

      if (event.event_type === "REINICIO" && inWindow(event)) {
        const priorDetencion = [...tripEvents].reverse().find(
          (e) => e.event_type === "DETENCION" && new Date(e.reported_at) < new Date(event.reported_at)
        );
        if (priorDetencion) {
          const hasEvidence = tripEvents.some(
            (e) =>
              e.event_type === "EVIDENCIA" &&
              new Date(e.reported_at) >= new Date(priorDetencion.reported_at) &&
              new Date(e.reported_at) <= new Date(event.reported_at)
          );
          if (!hasEvidence) {
            restartsWithoutEvidence.push({
              ...label,
              stoppedAt: new Date(priorDetencion.reported_at),
              resumedAt: new Date(event.reported_at),
              minutes: minutesBetween(priorDetencion.reported_at, event.reported_at),
            });
          }
        }
      }

      if (event.event_type === "DETENCION" && inWindow(event)) {
        const nextReinicio = tripEvents
          .slice(i + 1)
          .find((e) => e.event_type === "REINICIO");
        stops.push({
          ...label,
          stoppedAt: new Date(event.reported_at),
          resumedAt: nextReinicio ? new Date(nextReinicio.reported_at) : null,
          durationMinutes: nextReinicio ? minutesBetween(event.reported_at, nextReinicio.reported_at) : null,
          delayMinutes: nextReinicio ? delayMinutesByEventId.get(nextReinicio.id) ?? null : null,
        });
      }

      if (event.lat != null && event.lng != null && inWindow(event)) {
        coordinateChecks.push({
          operator: label.operator,
          route: label.route,
          reportedAt: new Date(event.reported_at),
          lat: event.lat,
          lng: event.lng,
          status: event.geofence_validation_status,
          geofenceName: event.geofence_match_id ? geofenceNameById.get(event.geofence_match_id) ?? null : null,
        });
      }
    }
  }

  const checklist = await gatherChecklist(db, shift.tenant_id, tripIds);
  const nonComplianceCount =
    restartsWithoutEvidence.length + coordinateChecks.filter((c) => c.status === "FUERA").length +
    stops.filter((s) => (s.delayMinutes ?? 0) > 0).length;

  return {
    tenantName: tenant.name,
    shiftName: shift.name,
    timezone: shift.timezone,
    windowStart: window.start,
    windowEnd: window.end,
    generatedAt: cutoffInstant,
    restartsWithoutEvidence,
    stops,
    coordinateChecks,
    checklist,
    observations: `Se registraron ${trips.length} viaje(s) y ${events.length} evento(s) en este turno. ${nonComplianceCount} incumplimiento(s) detectado(s) automáticamente.`,
  };
}

async function gatherChecklist(db: Db, tenantId: string, tripIds: string[]): Promise<ChecklistRow[]> {
  const { data: items } = await db
    .from("protocol_checklist_items")
    .select("id, code, description")
    .eq("tenant_id", tenantId)
    .eq("active", true);

  if (!items || items.length === 0) return [];

  const { data: checks } = await db
    .from("trip_compliance_checks")
    .select("checklist_item_id, status")
    .in("trip_id", tripIds);

  return items.map((item) => {
    const relevant = (checks ?? []).filter((c) => c.checklist_item_id === item.id);
    const cumple = relevant.filter((c) => c.status === "CUMPLE").length;
    const noCumple = relevant.filter((c) => c.status === "NO_CUMPLE").length;
    const na = relevant.filter((c) => c.status === "NA").length;
    return {
      code: item.code,
      description: item.description,
      summary: relevant.length === 0 ? "Sin evaluar" : `${cumple} CUMPLE / ${noCumple} NO_CUMPLE / ${na} NA`,
    };
  });
}

function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);
}

function emptyReport(
  tenantName: string,
  shiftName: string,
  timezone: string,
  window: { start: Date; end: Date },
  generatedAt: Date
): ShiftReportData {
  return {
    tenantName,
    shiftName,
    timezone,
    windowStart: window.start,
    windowEnd: window.end,
    generatedAt,
    restartsWithoutEvidence: [],
    stops: [],
    coordinateChecks: [],
    checklist: [],
    observations: "No se registraron viajes en este turno.",
  };
}
