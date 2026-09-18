import { supabase } from "@/lib/supabaseClient";
import { currentProfile, requireSession } from "@/lib/auth";
import { findCurrentShift } from "@/lib/currentShift";
import { computeSemaforo, minutesSince } from "@/lib/semaforo";
import type {
  ProtocolThresholds,
  Semaforo,
  Shift,
  TripDelayRow,
  TripEventRow,
  TripRow,
} from "@/lib/types";

const ACTIVE_STATUSES = ["PROGRAMADO", "EN_TRANSITO", "DETENIDO"] as const;

const tbody = document.getElementById("trips-tbody") as HTMLTableSectionElement;
const summaryRow = document.getElementById("summary-row") as HTMLDivElement;
const shiftTitle = document.getElementById("shift-title") as HTMLHeadingElement;
const userEmailEl = document.getElementById("user-email") as HTMLSpanElement;
const filterStatus = document.getElementById("filter-status") as HTMLSelectElement;
const filterSemaforo = document.getElementById("filter-semaforo") as HTMLSelectElement;
const logoutLink = document.getElementById("logout-link") as HTMLAnchorElement;

const justifyModal = document.getElementById("justify-modal") as HTMLDivElement;
const justifyModalContext = document.getElementById("justify-modal-context") as HTMLParagraphElement;
const justifyReasonInput = document.getElementById("justify-reason") as HTMLTextAreaElement;
const justifyModalError = document.getElementById("justify-modal-error") as HTMLDivElement;
const justifyCancelBtn = document.getElementById("justify-cancel") as HTMLButtonElement;
const justifyConfirmBtn = document.getElementById("justify-confirm") as HTMLButtonElement;

let currentShift: Shift | null = null;
let thresholds: ProtocolThresholds | undefined;
let trips: TripRow[] = [];
let canJustifyDelays = false;
let activeDelayId: string | null = null;
const lastEventByTrip = new Map<string, TripEventRow>();
const lastDelayByTrip = new Map<string, TripDelayRow>();

async function loadShiftsAndThresholds() {
  const [{ data: shifts, error: shiftsError }, { data: thresholdsRow }] = await Promise.all([
    supabase.from("shifts").select("*").eq("active", true),
    supabase.from("protocol_thresholds").select("*").maybeSingle(),
  ]);

  if (shiftsError) throw shiftsError;

  currentShift = findCurrentShift((shifts ?? []) as Shift[]);
  thresholds = (thresholdsRow ?? undefined) as ProtocolThresholds | undefined;

  shiftTitle.textContent = currentShift
    ? `Torre de Control — ${currentShift.name}`
    : "Torre de Control — Sin turno vigente";
}

async function loadTrips() {
  if (!currentShift) {
    trips = [];
    render();
    return;
  }

  const { data, error } = await supabase
    .from("trips")
    .select(
      "*, clients(name), operators(full_name, phone_e164), vehicles(plate)"
    )
    .eq("shift_id", currentShift.id)
    .in("status", ACTIVE_STATUSES as unknown as string[])
    .order("current_status_since", { ascending: true });

  if (error) throw error;
  trips = (data ?? []) as TripRow[];

  await Promise.all([loadLastEvents(), loadLastDelays()]);
  render();
}

async function loadLastEvents() {
  const tripIds = trips.map((t) => t.id);
  if (tripIds.length === 0) return;

  const { data, error } = await supabase
    .from("trip_events")
    .select("id, trip_id, event_type, reported_at, geofence_validation_status, lat, lng")
    .in("trip_id", tripIds)
    .order("reported_at", { ascending: false });

  if (error) throw error;

  lastEventByTrip.clear();
  for (const event of (data ?? []) as TripEventRow[]) {
    if (!lastEventByTrip.has(event.trip_id)) {
      lastEventByTrip.set(event.trip_id, event);
    }
  }
}

async function loadLastDelays() {
  const tripIds = trips.map((t) => t.id);
  if (tripIds.length === 0) return;

  const { data, error } = await supabase
    .from("trip_delays")
    .select("id, trip_id, delay_minutes, justified, reason, created_at")
    .in("trip_id", tripIds)
    .order("created_at", { ascending: false });

  if (error) throw error;

  lastDelayByTrip.clear();
  for (const delay of (data ?? []) as TripDelayRow[]) {
    if (!lastDelayByTrip.has(delay.trip_id)) {
      lastDelayByTrip.set(delay.trip_id, delay);
    }
  }
}

function statusLabel(status: TripRow["status"]): string {
  const labels: Record<TripRow["status"], string> = {
    PROGRAMADO: "Programado",
    EN_TRANSITO: "En tránsito",
    DETENIDO: "Detenido",
    FINALIZADO: "Finalizado",
    CANCELADO: "Cancelado",
  };
  return labels[status];
}

function render() {
  const statusFilter = filterStatus.value;
  const semaforoFilter = filterSemaforo.value as Semaforo | "";
  const now = new Date();

  const rows = trips
    .map((trip) => {
      const lastEvent = lastEventByTrip.get(trip.id);
      const delay = lastDelayByTrip.get(trip.id);
      const semaforo = computeSemaforo(trip, lastEvent, thresholds, now);
      return { trip, lastEvent, delay, semaforo };
    })
    .filter((r) => !statusFilter || r.trip.status === statusFilter)
    .filter((r) => !semaforoFilter || r.semaforo === semaforoFilter);

  renderSummary(rows.map((r) => r.semaforo));

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-state">Sin viajes activos que coincidan con el filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map(({ trip, lastEvent, delay, semaforo }) => {
      const referenceTime = lastEvent?.reported_at ?? trip.current_status_since;
      const geofenceLabel = lastEvent?.geofence_validation_status ?? "SIN_VALIDAR";
      const delayLabel = renderDelayCell(delay);

      return `
        <tr>
          <td><span class="semaforo"><span class="dot ${semaforo}"></span>${semaforo}</span></td>
          <td>${escapeHtml(trip.operators?.full_name ?? "—")}</td>
          <td>${escapeHtml(trip.vehicles?.plate ?? "—")}</td>
          <td>${escapeHtml(trip.clients?.name ?? "—")}</td>
          <td>${escapeHtml(trip.route_name)}</td>
          <td>${statusLabel(trip.status)}</td>
          <td>${minutesSince(referenceTime, now)} min</td>
          <td>${lastEvent ? lastEvent.event_type : "—"}</td>
          <td>${geofenceLabel}</td>
          <td>${delayLabel}</td>
        </tr>
      `;
    })
    .join("");
}

function renderSummary(semaforos: Semaforo[]) {
  const counts: Record<Semaforo, number> = { verde: 0, amarillo: 0, rojo: 0 };
  for (const s of semaforos) counts[s]++;

  summaryRow.innerHTML = `
    <div class="summary-chip"><span class="dot verde"></span>${counts.verde} en regla</div>
    <div class="summary-chip"><span class="dot amarillo"></span>${counts.amarillo} por revisar</div>
    <div class="summary-chip"><span class="dot rojo"></span>${counts.rojo} incumplimientos</div>
    <div class="summary-chip">${semaforos.length} viajes activos</div>
  `;
}

function renderDelayCell(delay: TripDelayRow | undefined): string {
  if (!delay) return "—";

  if (delay.justified) {
    const title = delay.reason ? ` title="${escapeHtml(delay.reason)}"` : "";
    return `${delay.delay_minutes} min <span class="meta"${title}>(justificado)</span>`;
  }

  if (!canJustifyDelays) {
    return `${delay.delay_minutes} min`;
  }

  return `${delay.delay_minutes} min · <button type="button" class="link-btn" data-justify-delay-id="${delay.id}">Justificar</button>`;
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function openJustifyModal(delayId: string): void {
  const delay = trips
    .map((t) => lastDelayByTrip.get(t.id))
    .find((d) => d?.id === delayId);
  const trip = delay ? trips.find((t) => t.id === delay.trip_id) : undefined;

  activeDelayId = delayId;
  justifyReasonInput.value = "";
  justifyModalError.textContent = "";
  justifyModalContext.textContent = trip
    ? `${trip.operators?.full_name ?? "Operador"} — ${trip.route_name} (${delay?.delay_minutes} min de atraso)`
    : `${delay?.delay_minutes ?? "?"} min de atraso`;
  justifyModal.hidden = false;
  justifyReasonInput.focus();
}

function closeJustifyModal(): void {
  activeDelayId = null;
  justifyModal.hidden = true;
}

async function confirmJustify(): Promise<void> {
  if (!activeDelayId) return;
  const reason = justifyReasonInput.value.trim();
  if (!reason) {
    justifyModalError.textContent = "Escribe un motivo antes de guardar.";
    return;
  }

  justifyConfirmBtn.disabled = true;
  const { data: session } = await supabase.auth.getSession();

  const { data, error } = await supabase
    .from("trip_delays")
    .update({ justified: true, reason, justified_by: session.session?.user.id })
    .eq("id", activeDelayId)
    .select("id, trip_id, delay_minutes, justified, reason, created_at")
    .single();

  justifyConfirmBtn.disabled = false;

  if (error) {
    justifyModalError.textContent = `No se pudo guardar: ${error.message}`;
    return;
  }

  lastDelayByTrip.set(data.trip_id, data as TripDelayRow);
  closeJustifyModal();
  render();
}

function subscribeRealtime() {
  supabase
    .channel("torre-control-trips")
    .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => {
      loadTrips().catch(console.error);
    })
    .subscribe();

  supabase
    .channel("torre-control-events")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "trip_events" }, (payload) => {
      const event = payload.new as TripEventRow;
      const existing = lastEventByTrip.get(event.trip_id);
      if (!existing || new Date(event.reported_at) >= new Date(existing.reported_at)) {
        lastEventByTrip.set(event.trip_id, event);
      }
      render();
    })
    .subscribe();

  supabase
    .channel("torre-control-delays")
    .on("postgres_changes", { event: "*", schema: "public", table: "trip_delays" }, (payload) => {
      if (payload.eventType === "DELETE") return;
      const delay = payload.new as TripDelayRow;
      const existing = lastDelayByTrip.get(delay.trip_id);
      // Reemplaza si es más reciente, o si es una actualización (ej. justificación)
      // del mismo atraso que ya estábamos mostrando.
      if (!existing || existing.id === delay.id || new Date(delay.created_at) >= new Date(existing.created_at)) {
        lastDelayByTrip.set(delay.trip_id, delay);
      }
      render();
    })
    .subscribe();
}

async function init() {
  const session = await requireSession();
  userEmailEl.textContent = session.user.email ?? "";

  const profile = await currentProfile(session.user.id);
  canJustifyDelays = profile.role === "ADMIN" || profile.role === "JEFATURA";

  filterStatus.addEventListener("change", render);
  filterSemaforo.addEventListener("change", render);
  logoutLink.addEventListener("click", async (event) => {
    event.preventDefault();
    await supabase.auth.signOut();
    window.location.href = "/login.html";
  });

  tbody.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-justify-delay-id]");
    if (target) openJustifyModal(target.dataset.justifyDelayId!);
  });
  justifyCancelBtn.addEventListener("click", closeJustifyModal);
  justifyConfirmBtn.addEventListener("click", () => confirmJustify().catch(console.error));
  justifyModal.addEventListener("click", (event) => {
    if (event.target === justifyModal) closeJustifyModal();
  });

  await loadShiftsAndThresholds();
  await loadTrips();
  subscribeRealtime();

  // Recalcula el semáforo periódicamente aunque no lleguen eventos nuevos
  setInterval(render, 30_000);
  // Re-evalúa qué turno está vigente cada 5 minutos (cambio de turno)
  setInterval(async () => {
    await loadShiftsAndThresholds();
    await loadTrips();
  }, 5 * 60_000);
}

init().catch((error) => {
  if ((error as Error).message !== "no session") {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="10" class="empty-state">Error cargando el dashboard: ${escapeHtml(
      (error as Error).message
    )}</td></tr>`;
  }
});
