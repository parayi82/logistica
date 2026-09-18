import { supabase } from "@/lib/supabaseClient";
import { currentProfile, requireSession } from "@/lib/auth";
import type {
  KpiGroupStats,
  ReportGroupBy,
  TripAlertReportRow,
  TripDelayReportRow,
} from "@/lib/types";

const userEmailEl = document.getElementById("user-email") as HTMLSpanElement;
const fromInput = document.getElementById("from-date") as HTMLInputElement;
const toInput = document.getElementById("to-date") as HTMLInputElement;
const groupBySelect = document.getElementById("group-by") as HTMLSelectElement;
const runBtn = document.getElementById("run-report-btn") as HTMLButtonElement;
const summaryRow = document.getElementById("summary-row") as HTMLDivElement;
const emptyState = document.getElementById("report-empty-state") as HTMLParagraphElement;
const tbody = document.getElementById("report-tbody") as HTMLTableSectionElement;
const groupColHeader = document.getElementById("group-col-header") as HTMLTableCellElement;
const logoutLink = document.getElementById("logout-link") as HTMLAnchorElement;

const GROUP_LABELS: Record<ReportGroupBy, string> = {
  operator: "Operador",
  client: "Cliente",
  route: "Ruta",
};

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function groupKeyAndLabel(
  groupBy: ReportGroupBy,
  row: { operator_id: string | null; operator_name: string | null; client_id: string | null; client_name: string | null; route_name: string }
): { key: string; label: string } {
  if (groupBy === "operator") {
    return { key: row.operator_id ?? "sin-operador", label: row.operator_name ?? "Sin operador" };
  }
  if (groupBy === "client") {
    return { key: row.client_id ?? "sin-cliente", label: row.client_name ?? "Sin cliente" };
  }
  return { key: row.route_name, label: row.route_name };
}

async function loadDelays(fromIso: string, toIso: string): Promise<TripDelayReportRow[]> {
  const { data, error } = await supabase
    .from("trip_delays_report")
    .select("*")
    .gte("created_at", fromIso)
    .lte("created_at", toIso);
  if (error) throw error;
  return (data ?? []) as TripDelayReportRow[];
}

async function loadAlerts(fromIso: string, toIso: string): Promise<TripAlertReportRow[]> {
  const { data, error } = await supabase
    .from("trip_alerts_report")
    .select("*")
    .gte("created_at", fromIso)
    .lte("created_at", toIso);
  if (error) throw error;
  return (data ?? []) as TripAlertReportRow[];
}

function aggregate(
  groupBy: ReportGroupBy,
  delays: TripDelayReportRow[],
  alerts: TripAlertReportRow[]
): KpiGroupStats[] {
  const stats = new Map<string, KpiGroupStats & { delayMinutesSum: number; delayCount: number; tripIds: Set<string> }>();

  const getEntry = (key: string, label: string) => {
    let entry = stats.get(key);
    if (!entry) {
      entry = {
        key,
        label,
        tripsWithDelay: 0,
        avgDelayMinutes: 0,
        delaysJustified: 0,
        delaysUnjustified: 0,
        fueraDeGeocerca: 0,
        escalamientosSeguridad: 0,
        delayMinutesSum: 0,
        delayCount: 0,
        tripIds: new Set<string>(),
      };
      stats.set(key, entry);
    }
    return entry;
  };

  for (const row of delays) {
    const { key, label } = groupKeyAndLabel(groupBy, row);
    const entry = getEntry(key, label);
    entry.tripIds.add(row.trip_id);
    entry.delayMinutesSum += row.delay_minutes;
    entry.delayCount += 1;
    if (row.justified) entry.delaysJustified += 1;
    else entry.delaysUnjustified += 1;
  }

  for (const row of alerts) {
    const { key, label } = groupKeyAndLabel(groupBy, row);
    const entry = getEntry(key, label);
    if (row.alert_type === "FUERA_DE_GEOCERCA") entry.fueraDeGeocerca += 1;
    if (row.alert_type === "ESCALAMIENTO_SEGURIDAD") entry.escalamientosSeguridad += 1;
  }

  return Array.from(stats.values())
    .map((e) => ({
      key: e.key,
      label: e.label,
      tripsWithDelay: e.tripIds.size,
      avgDelayMinutes: e.delayCount > 0 ? Math.round(e.delayMinutesSum / e.delayCount) : 0,
      delaysJustified: e.delaysJustified,
      delaysUnjustified: e.delaysUnjustified,
      fueraDeGeocerca: e.fueraDeGeocerca,
      escalamientosSeguridad: e.escalamientosSeguridad,
    }))
    .sort((a, b) => b.tripsWithDelay - a.tripsWithDelay || b.avgDelayMinutes - a.avgDelayMinutes);
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function renderSummary(rows: KpiGroupStats[]) {
  const totalTripsWithDelay = rows.reduce((acc, r) => acc + r.tripsWithDelay, 0);
  const totalUnjustified = rows.reduce((acc, r) => acc + r.delaysUnjustified, 0);
  const totalFuera = rows.reduce((acc, r) => acc + r.fueraDeGeocerca, 0);
  const totalEscalamientos = rows.reduce((acc, r) => acc + r.escalamientosSeguridad, 0);

  summaryRow.innerHTML = `
    <div class="summary-chip">${totalTripsWithDelay} viajes con atraso</div>
    <div class="summary-chip">${totalUnjustified} atrasos sin justificar</div>
    <div class="summary-chip">${totalFuera} eventos fuera de geocerca</div>
    <div class="summary-chip">${totalEscalamientos} escalamientos a Seguridad</div>
  `;
}

function render(groupBy: ReportGroupBy, rows: KpiGroupStats[]) {
  groupColHeader.textContent = GROUP_LABELS[groupBy];
  renderSummary(rows);

  if (rows.length === 0) {
    emptyState.textContent = "Sin datos en el rango de fechas seleccionado.";
    emptyState.hidden = false;
    tbody.innerHTML = "";
    return;
  }
  emptyState.hidden = true;

  tbody.innerHTML = rows
    .map(
      (r) => `
        <tr>
          <td>${escapeHtml(r.label)}</td>
          <td>${r.tripsWithDelay}</td>
          <td>${r.avgDelayMinutes} min</td>
          <td>${r.delaysJustified}</td>
          <td>${r.delaysUnjustified}</td>
          <td>${r.fueraDeGeocerca}</td>
          <td>${r.escalamientosSeguridad}</td>
        </tr>
      `
    )
    .join("");
}

async function runReport(): Promise<void> {
  const fromIso = new Date(`${fromInput.value}T00:00:00`).toISOString();
  const toIso = new Date(`${toInput.value}T23:59:59.999`).toISOString();
  const groupBy = groupBySelect.value as ReportGroupBy;

  runBtn.disabled = true;
  tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Cargando…</td></tr>`;
  try {
    const [delays, alerts] = await Promise.all([loadDelays(fromIso, toIso), loadAlerts(fromIso, toIso)]);
    render(groupBy, aggregate(groupBy, delays, alerts));
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Error: ${escapeHtml((error as Error).message)}</td></tr>`;
  } finally {
    runBtn.disabled = false;
  }
}

async function init(): Promise<void> {
  const session = await requireSession();
  userEmailEl.textContent = session.user.email ?? "";

  const profile = await currentProfile(session.user.id);
  if (profile.role === "CLIENTE_VIEW") {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No tienes acceso a esta página.</td></tr>`;
    return;
  }

  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  fromInput.value = toDateInputValue(thirtyDaysAgo);
  toInput.value = toDateInputValue(today);

  runBtn.addEventListener("click", () => runReport().catch(console.error));
  logoutLink.addEventListener("click", async (event) => {
    event.preventDefault();
    await supabase.auth.signOut();
    window.location.href = "/login.html";
  });

  await runReport();
}

init().catch((error) => {
  if ((error as Error).message !== "no session") {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Error cargando la página: ${escapeHtml(
      (error as Error).message
    )}</td></tr>`;
  }
});
