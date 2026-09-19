import { supabase } from "@/lib/supabaseClient";
import { currentProfile, requireSession } from "@/lib/auth";
import type { DetentionLogRow, ProfileOption, ProviderRow, TripRow } from "@/lib/types";

const MANAGER_ROLES = new Set(["ADMIN", "JEFATURA", "MONITOR"]);
const ENCARGADO_ROLES = ["ADMIN", "JEFATURA", "MONITOR", "SEGURIDAD_PATRIMONIAL"];

const userEmailEl = document.getElementById("user-email") as HTMLSpanElement;
const logoutLink = document.getElementById("logout-link") as HTMLAnchorElement;

const newTripBtn = document.getElementById("new-trip-btn") as HTMLButtonElement;
const tripsTbody = document.getElementById("trips-tbody") as HTMLTableSectionElement;
const tripsEmptyState = document.getElementById("trips-empty-state") as HTMLParagraphElement;
const tripsEditColHeader = document.getElementById("trips-edit-col-header") as HTMLTableCellElement;

const downloadLogCsvBtn = document.getElementById("download-log-csv-btn") as HTMLButtonElement;
const logTbody = document.getElementById("log-tbody") as HTMLTableSectionElement;
const logEmptyState = document.getElementById("log-empty-state") as HTMLParagraphElement;

const tripModal = document.getElementById("trip-modal") as HTMLDivElement;
const tripModalTitle = document.getElementById("trip-modal-title") as HTMLHeadingElement;
const tripModalError = document.getElementById("trip-modal-error") as HTMLDivElement;
const tripFolioInput = document.getElementById("trip-folio") as HTMLInputElement;
const tripUnderProtocolInput = document.getElementById("trip-under-protocol") as HTMLInputElement;
const tripClientSelect = document.getElementById("trip-client") as HTMLSelectElement;
const tripShiftSelect = document.getElementById("trip-shift") as HTMLSelectElement;
const tripOperatorSelect = document.getElementById("trip-operator") as HTMLSelectElement;
const tripVehicleSelect = document.getElementById("trip-vehicle") as HTMLSelectElement;
const tripProviderSelect = document.getElementById("trip-provider") as HTMLSelectElement;
const tripEncargadoSelect = document.getElementById("trip-encargado") as HTMLSelectElement;
const tripModalitySelect = document.getElementById("trip-modality") as HTMLInputElement;
const tripTransportDocInput = document.getElementById("trip-transport-doc") as HTMLInputElement;
const tripRouteNameInput = document.getElementById("trip-route-name") as HTMLInputElement;
const tripScheduledDepartureInput = document.getElementById("trip-scheduled-departure") as HTMLInputElement;
const tripOriginInput = document.getElementById("trip-origin") as HTMLInputElement;
const tripDestinationInput = document.getElementById("trip-destination") as HTMLInputElement;
const newProviderNameInput = document.getElementById("new-provider-name") as HTMLInputElement;
const newProviderIndependentInput = document.getElementById("new-provider-independent") as HTMLInputElement;
const addProviderBtn = document.getElementById("add-provider-btn") as HTMLButtonElement;
const tripCancelBtn = document.getElementById("trip-cancel") as HTMLButtonElement;
const tripSaveBtn = document.getElementById("trip-save") as HTMLButtonElement;

const stopLocationModal = document.getElementById("stop-location-modal") as HTMLDivElement;
const stopLocationError = document.getElementById("stop-location-error") as HTMLDivElement;
const stopLocationInput = document.getElementById("stop-location-input") as HTMLTextAreaElement;
const stopLocationCancelBtn = document.getElementById("stop-location-cancel") as HTMLButtonElement;
const stopLocationSaveBtn = document.getElementById("stop-location-save") as HTMLButtonElement;

let canManage = false;
let tenantId = "";
let trips: TripRow[] = [];
let providers: ProviderRow[] = [];
let profilesForEncargado: ProfileOption[] = [];
let profileNameById = new Map<string, string>();
let editingTripId: string | null = null;
let editingStopEventId: string | null = null;
let lastLogRows: DetentionLogRow[] = [];

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function csvEscape(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function yesNo(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value ? "Sí" : "No";
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-MX");
}

// ---------------------------------------------------------------------
// Datos de referencia para los selects del formulario de viaje.
// ---------------------------------------------------------------------
async function loadReferenceData(): Promise<void> {
  const [clientsRes, shiftsRes, operatorsRes, vehiclesRes, providersRes, profilesRes] = await Promise.all([
    supabase.from("clients").select("id, name").eq("active", true).order("name"),
    supabase.from("shifts").select("id, name").eq("active", true).order("name"),
    supabase.from("operators").select("id, full_name").eq("active", true).order("full_name"),
    supabase.from("vehicles").select("id, plate, economic_number").eq("active", true).order("plate"),
    supabase.from("providers").select("id, tenant_id, name, is_independent, active").eq("active", true).order("name"),
    supabase.from("profiles").select("id, full_name, role").in("role", ENCARGADO_ROLES).eq("active", true).order("full_name"),
  ]);
  for (const res of [clientsRes, shiftsRes, operatorsRes, vehiclesRes, providersRes, profilesRes]) {
    if (res.error) throw res.error;
  }

  providers = (providersRes.data ?? []) as ProviderRow[];
  profilesForEncargado = (profilesRes.data ?? []) as ProfileOption[];
  profileNameById = new Map(profilesForEncargado.map((p) => [p.id, p.full_name]));

  fillSelect(tripClientSelect, (clientsRes.data ?? []) as { id: string; name: string }[], (c) => c.name);
  fillSelect(tripShiftSelect, (shiftsRes.data ?? []) as { id: string; name: string }[], (s) => s.name);
  fillSelect(tripOperatorSelect, (operatorsRes.data ?? []) as { id: string; full_name: string }[], (o) => o.full_name);
  fillSelect(
    tripVehicleSelect,
    (vehiclesRes.data ?? []) as { id: string; plate: string; economic_number: string | null }[],
    (v) => (v.economic_number ? `${v.plate} (${v.economic_number})` : v.plate)
  );
  fillProviderSelect();
  fillSelect(tripEncargadoSelect, profilesForEncargado, (p) => p.full_name, true);
}

function fillSelect<T extends { id: string }>(
  select: HTMLSelectElement,
  items: T[],
  label: (item: T) => string,
  optional = false
): void {
  const placeholder = optional ? `<option value="">Sin encargado</option>` : `<option value="">Selecciona…</option>`;
  select.innerHTML = placeholder + items.map((item) => `<option value="${item.id}">${escapeHtml(label(item))}</option>`).join("");
}

function fillProviderSelect(): void {
  tripProviderSelect.innerHTML =
    `<option value="">Sin proveedor</option>` +
    providers
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}${p.is_independent ? " (Independiente)" : ""}</option>`)
      .join("");
}

// ---------------------------------------------------------------------
// Tabla A: viajes bajo protocolo (alta / edición).
// ---------------------------------------------------------------------
async function loadTrips(): Promise<void> {
  const { data, error } = await supabase
    .from("trips")
    .select("*, clients(name), operators(full_name), vehicles(plate), providers(name, is_independent)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  trips = (data ?? []) as TripRow[];
  renderTrips();
}

function renderTrips(): void {
  if (trips.length === 0) {
    tripsEmptyState.textContent = "Todavía no hay viajes registrados.";
    tripsEmptyState.hidden = false;
    tripsTbody.innerHTML = "";
    return;
  }
  tripsEmptyState.hidden = true;

  tripsTbody.innerHTML = trips
    .map(
      (t) => `
        <tr>
          <td>${escapeHtml(t.folio ?? "—")}</td>
          <td>${escapeHtml(t.clients?.name ?? "—")}</td>
          <td>${escapeHtml(t.providers?.name ?? "—")}</td>
          <td>${escapeHtml(t.operators?.full_name ?? "—")}</td>
          <td>${escapeHtml(t.vehicles?.plate ?? "—")}</td>
          <td>${escapeHtml(t.route_name)}</td>
          <td>${escapeHtml(t.status)}</td>
          ${canManage ? `<td><button type="button" class="link-btn" data-edit-trip-id="${t.id}">Editar</button></td>` : ""}
        </tr>
      `
    )
    .join("");
}

function resetTripForm(): void {
  tripModalError.textContent = "";
  tripFolioInput.value = "";
  tripUnderProtocolInput.checked = true;
  tripClientSelect.value = "";
  tripShiftSelect.value = "";
  tripOperatorSelect.value = "";
  tripVehicleSelect.value = "";
  tripProviderSelect.value = "";
  tripEncargadoSelect.value = "";
  tripModalitySelect.value = "";
  tripTransportDocInput.value = "";
  tripRouteNameInput.value = "";
  tripScheduledDepartureInput.value = "";
  tripOriginInput.value = "";
  tripDestinationInput.value = "";
  newProviderNameInput.value = "";
  newProviderIndependentInput.checked = false;
}

function openTripModal(trip?: TripRow): void {
  resetTripForm();
  editingTripId = trip?.id ?? null;
  tripModalTitle.textContent = trip ? "Editar viaje" : "Nuevo viaje";

  if (trip) {
    tripFolioInput.value = trip.folio ?? "";
    tripUnderProtocolInput.checked = trip.under_protocol;
    tripClientSelect.value = trip.client_id;
    tripShiftSelect.value = trip.shift_id;
    tripOperatorSelect.value = trip.operator_id;
    tripVehicleSelect.value = trip.vehicle_id;
    tripProviderSelect.value = trip.provider_id ?? "";
    tripEncargadoSelect.value = trip.encargado_id ?? "";
    tripModalitySelect.value = trip.modality ?? "";
    tripTransportDocInput.value = trip.transport_doc ?? "";
    tripRouteNameInput.value = trip.route_name;
    tripScheduledDepartureInput.value = trip.scheduled_departure ? trip.scheduled_departure.slice(0, 16) : "";
    tripOriginInput.value = trip.origin;
    tripDestinationInput.value = trip.destination;
  }

  tripModal.hidden = false;
}

function closeTripModal(): void {
  tripModal.hidden = true;
  editingTripId = null;
}

async function addProviderQuick(): Promise<void> {
  const name = newProviderNameInput.value.trim();
  if (!name) {
    tripModalError.textContent = "Escribe el nombre del proveedor nuevo antes de agregarlo.";
    return;
  }
  addProviderBtn.disabled = true;
  try {
    const { data, error } = await supabase
      .from("providers")
      .insert({ tenant_id: tenantId, name, is_independent: newProviderIndependentInput.checked })
      .select("id, tenant_id, name, is_independent, active")
      .single();
    if (error) throw error;
    providers.push(data as ProviderRow);
    fillProviderSelect();
    tripProviderSelect.value = (data as ProviderRow).id;
    newProviderNameInput.value = "";
    newProviderIndependentInput.checked = false;
    tripModalError.textContent = "";
  } catch (error) {
    tripModalError.textContent = `No se pudo agregar el proveedor: ${(error as Error).message}`;
  } finally {
    addProviderBtn.disabled = false;
  }
}

async function saveTrip(): Promise<void> {
  if (
    !tripClientSelect.value ||
    !tripShiftSelect.value ||
    !tripOperatorSelect.value ||
    !tripVehicleSelect.value ||
    !tripRouteNameInput.value.trim() ||
    !tripOriginInput.value.trim() ||
    !tripDestinationInput.value.trim()
  ) {
    tripModalError.textContent = "Completa cliente, turno, operador, unidad, ruta, origen y destino.";
    return;
  }

  const payload = {
    tenant_id: tenantId,
    client_id: tripClientSelect.value,
    shift_id: tripShiftSelect.value,
    operator_id: tripOperatorSelect.value,
    vehicle_id: tripVehicleSelect.value,
    provider_id: tripProviderSelect.value || null,
    encargado_id: tripEncargadoSelect.value || null,
    folio: tripFolioInput.value.trim() || null,
    under_protocol: tripUnderProtocolInput.checked,
    modality: tripModalitySelect.value.trim() || null,
    transport_doc: tripTransportDocInput.value.trim() || null,
    route_name: tripRouteNameInput.value.trim(),
    origin: tripOriginInput.value.trim(),
    destination: tripDestinationInput.value.trim(),
    scheduled_departure: tripScheduledDepartureInput.value ? new Date(tripScheduledDepartureInput.value).toISOString() : null,
  };

  tripSaveBtn.disabled = true;
  try {
    if (editingTripId) {
      const { error } = await supabase.from("trips").update(payload).eq("id", editingTripId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("trips").insert(payload);
      if (error) throw error;
    }
    closeTripModal();
    await Promise.all([loadTrips(), loadDetentionLog()]);
  } catch (error) {
    tripModalError.textContent = `No se pudo guardar: ${(error as Error).message}`;
  } finally {
    tripSaveBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Tabla B: bitácora de detenciones (una fila por evento DETENCION, con
// los datos del viaje ya resueltos — el mismo layout que la hoja de
// cálculo de protocolo de seguridad que ya usa el cliente).
// ---------------------------------------------------------------------
async function loadDetentionLog(): Promise<void> {
  const { data, error } = await supabase
    .from("trip_events")
    .select(
      "id, trip_id, reported_at, notes, engine_off, stop_location_name, lat, lng, " +
        "trips(folio, under_protocol, modality, transport_doc, origin, destination, scheduled_departure, status, updated_at, route_name, encargado_id, " +
        "clients(name), operators(full_name), vehicles(plate, economic_number, box_has_gps), providers(name, is_independent))"
    )
    .eq("event_type", "DETENCION")
    .order("reported_at", { ascending: false })
    .limit(300);
  if (error) throw error;

  const rows = (data ?? []) as unknown as DetentionLogRow[];
  const tripIds = Array.from(new Set(rows.map((r) => r.trip_id)));

  let reinicios: { trip_id: string; reported_at: string }[] = [];
  if (tripIds.length > 0) {
    const { data: reinicioData, error: reinicioError } = await supabase
      .from("trip_events")
      .select("trip_id, reported_at")
      .eq("event_type", "REINICIO")
      .in("trip_id", tripIds)
      .order("reported_at", { ascending: true });
    if (reinicioError) throw reinicioError;
    reinicios = (reinicioData ?? []) as { trip_id: string; reported_at: string }[];
  }

  for (const row of rows) {
    const nextReinicio = reinicios.find((r) => r.trip_id === row.trip_id && r.reported_at > row.reported_at);
    row.reinicio_at = nextReinicio?.reported_at ?? null;
  }

  lastLogRows = rows;
  renderLog();
}

function renderLog(): void {
  if (lastLogRows.length === 0) {
    logEmptyState.textContent = "Todavía no hay detenciones registradas.";
    logEmptyState.hidden = false;
    logTbody.innerHTML = "";
    return;
  }
  logEmptyState.hidden = true;

  logTbody.innerHTML = lastLogRows
    .map((row) => {
      const t = row.trips as unknown as {
        folio: string | null;
        under_protocol: boolean;
        modality: string | null;
        transport_doc: string | null;
        origin: string;
        destination: string;
        scheduled_departure: string | null;
        status: string;
        updated_at: string;
        route_name: string;
        encargado_id: string | null;
        clients?: { name: string } | null;
        operators?: { full_name: string } | null;
        vehicles?: { plate: string; economic_number: string | null; box_has_gps: boolean } | null;
        providers?: { name: string; is_independent: boolean } | null;
      } | null;

      const coords = row.lat != null && row.lng != null ? `${row.lat.toFixed(5)}, ${row.lng.toFixed(5)}` : "—";
      const encargadoName = t?.encargado_id ? (profileNameById.get(t.encargado_id) ?? "—") : "—";

      return `
        <tr>
          <td>${yesNo(t?.under_protocol)}</td>
          <td>${escapeHtml(t?.folio ?? "—")}</td>
          <td>${escapeHtml(t?.clients?.name ?? "—")}</td>
          <td>${escapeHtml(t?.providers?.name ?? "—")}</td>
          <td>${yesNo(t?.providers?.is_independent ?? null)}</td>
          <td>${escapeHtml(t?.operators?.full_name ?? "—")}</td>
          <td>${escapeHtml(t?.modality ?? "—")}</td>
          <td>${escapeHtml(t?.vehicles?.plate ?? "—")}</td>
          <td>${yesNo(t?.vehicles?.box_has_gps ?? null)}</td>
          <td>${escapeHtml(t?.vehicles?.economic_number ?? "—")}</td>
          <td>${escapeHtml(t?.transport_doc ?? "—")}</td>
          <td>${escapeHtml(t?.origin ?? "—")}</td>
          <td>${escapeHtml(t?.destination ?? "—")}</td>
          <td>${fmtDate(t?.scheduled_departure)}</td>
          <td>${escapeHtml(encargadoName)}</td>
          <td>${escapeHtml(t?.status ?? "—")}</td>
          <td>${fmtDate(t?.updated_at)}</td>
          <td>
            ${escapeHtml(row.stop_location_name ?? "—")}
            ${canManage ? `<button type="button" class="link-btn" data-edit-stop-id="${row.id}" data-current="${escapeHtml(row.stop_location_name ?? "")}">Editar</button>` : ""}
          </td>
          <td>${coords}</td>
          <td>${escapeHtml(row.notes ?? "—")}</td>
          <td>${fmtDate(row.reinicio_at)}</td>
          <td>${yesNo(row.engine_off)}</td>
        </tr>
      `;
    })
    .join("");
}

function openStopLocationModal(eventId: string, current: string): void {
  editingStopEventId = eventId;
  stopLocationError.textContent = "";
  stopLocationInput.value = current;
  stopLocationModal.hidden = false;
}

function closeStopLocationModal(): void {
  stopLocationModal.hidden = true;
  editingStopEventId = null;
}

async function saveStopLocation(): Promise<void> {
  if (!editingStopEventId) return;
  stopLocationSaveBtn.disabled = true;
  try {
    const { error } = await supabase
      .from("trip_events")
      .update({ stop_location_name: stopLocationInput.value.trim() || null })
      .eq("id", editingStopEventId);
    if (error) throw error;
    closeStopLocationModal();
    await loadDetentionLog();
  } catch (error) {
    stopLocationError.textContent = `No se pudo guardar: ${(error as Error).message}`;
  } finally {
    stopLocationSaveBtn.disabled = false;
  }
}

function downloadLogCsv(): void {
  const headers = [
    "BAJO PROTOCOLO",
    "Folio",
    "Cliente",
    "Proveedor",
    "Prv. Independiente",
    "Operador",
    "Modalidad",
    "Placa",
    "Caja con GPS",
    "ECO",
    "Doc. Transporte",
    "Origen",
    "Destino",
    "Fecha",
    "Encargado",
    "Estatus",
    "Modificado",
    "LUGAR DE DETENCION",
    "COORDENADAS",
    "MOTIVO",
    "HORARIO DE REINICIO",
    "PARO DE MOTOR",
  ];

  const lines = [headers.map(csvEscape).join(",")];
  for (const row of lastLogRows) {
    const t = row.trips as unknown as {
      folio: string | null;
      under_protocol: boolean;
      modality: string | null;
      transport_doc: string | null;
      origin: string;
      destination: string;
      scheduled_departure: string | null;
      status: string;
      updated_at: string;
      encargado_id: string | null;
      clients?: { name: string } | null;
      operators?: { full_name: string } | null;
      vehicles?: { plate: string; economic_number: string | null; box_has_gps: boolean } | null;
      providers?: { name: string; is_independent: boolean } | null;
    } | null;
    const coords = row.lat != null && row.lng != null ? `${row.lat.toFixed(5)}, ${row.lng.toFixed(5)}` : "";
    const encargadoName = t?.encargado_id ? (profileNameById.get(t.encargado_id) ?? "") : "";

    const cols = [
      yesNo(t?.under_protocol),
      t?.folio ?? "",
      t?.clients?.name ?? "",
      t?.providers?.name ?? "",
      yesNo(t?.providers?.is_independent ?? null),
      t?.operators?.full_name ?? "",
      t?.modality ?? "",
      t?.vehicles?.plate ?? "",
      yesNo(t?.vehicles?.box_has_gps ?? null),
      t?.vehicles?.economic_number ?? "",
      t?.transport_doc ?? "",
      t?.origin ?? "",
      t?.destination ?? "",
      fmtDate(t?.scheduled_departure),
      encargadoName,
      t?.status ?? "",
      fmtDate(t?.updated_at),
      row.stop_location_name ?? "",
      coords,
      row.notes ?? "",
      fmtDate(row.reinicio_at),
      yesNo(row.engine_off),
    ];
    lines.push(cols.map(csvEscape).join(","));
  }

  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bitacora-protocolo-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function init(): Promise<void> {
  const session = await requireSession();
  userEmailEl.textContent = session.user.email ?? "";

  const profile = await currentProfile(session.user.id);
  // Esta bitácora expone detalle operativo interno (motivo de detención,
  // paro de motor, encargado) más sensible que los KPIs agregados de
  // reportes.html; a diferencia de esa página, aquí no se le baja el
  // detalle a CLIENTE_VIEW, se le niega la página completa.
  if (profile.role === "CLIENTE_VIEW") {
    window.location.href = "/dashboard.html";
    return;
  }
  tenantId = profile.tenant_id;
  canManage = MANAGER_ROLES.has(profile.role);
  newTripBtn.hidden = !canManage;
  tripsEditColHeader.hidden = !canManage;

  await loadReferenceData();
  await Promise.all([loadTrips(), loadDetentionLog()]);

  newTripBtn.addEventListener("click", () => openTripModal());
  tripCancelBtn.addEventListener("click", closeTripModal);
  tripSaveBtn.addEventListener("click", () => saveTrip().catch(console.error));
  addProviderBtn.addEventListener("click", () => addProviderQuick().catch(console.error));
  tripModal.addEventListener("click", (event) => {
    if (event.target === tripModal) closeTripModal();
  });

  tripsTbody.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-edit-trip-id]");
    if (!target) return;
    const trip = trips.find((t) => t.id === target.dataset.editTripId);
    if (trip) openTripModal(trip);
  });

  logTbody.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-edit-stop-id]");
    if (!target) return;
    openStopLocationModal(target.dataset.editStopId!, target.dataset.current ?? "");
  });

  stopLocationCancelBtn.addEventListener("click", closeStopLocationModal);
  stopLocationSaveBtn.addEventListener("click", () => saveStopLocation().catch(console.error));
  stopLocationModal.addEventListener("click", (event) => {
    if (event.target === stopLocationModal) closeStopLocationModal();
  });

  downloadLogCsvBtn.addEventListener("click", downloadLogCsv);

  logoutLink.addEventListener("click", async (event) => {
    event.preventDefault();
    await supabase.auth.signOut();
    window.location.href = "/login.html";
  });
}

init().catch((error) => {
  if ((error as Error).message !== "no session") {
    console.error(error);
    tripsTbody.innerHTML = `<tr><td colspan="8" class="empty-state">Error cargando la página: ${escapeHtml(
      (error as Error).message
    )}</td></tr>`;
  }
});
