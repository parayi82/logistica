import { supabase } from "@/lib/supabaseClient";
import { currentProfile, requireSession } from "@/lib/auth";
import type { QuoteRow, QuoteStatus } from "@/lib/types";

const MANAGER_ROLES = new Set(["ADMIN", "JEFATURA", "MONITOR"]);

const userEmailEl = document.getElementById("user-email") as HTMLSpanElement;
const logoutLink = document.getElementById("logout-link") as HTMLAnchorElement;

const newQuoteBtn = document.getElementById("new-quote-btn") as HTMLButtonElement;
const quotesTbody = document.getElementById("quotes-tbody") as HTMLTableSectionElement;
const quotesEmptyState = document.getElementById("quotes-empty-state") as HTMLParagraphElement;

const quoteModal = document.getElementById("quote-modal") as HTMLDivElement;
const quoteModalTitle = document.getElementById("quote-modal-title") as HTMLHeadingElement;
const quoteModalError = document.getElementById("quote-modal-error") as HTMLDivElement;
const quoteClientSelect = document.getElementById("quote-client") as HTMLSelectElement;
const quoteProviderSelect = document.getElementById("quote-provider") as HTMLSelectElement;
const quoteOperatorSelect = document.getElementById("quote-operator") as HTMLSelectElement;
const quoteVehicleSelect = document.getElementById("quote-vehicle") as HTMLSelectElement;
const quoteOriginInput = document.getElementById("quote-origin") as HTMLInputElement;
const quoteDestinationInput = document.getElementById("quote-destination") as HTMLInputElement;
const quoteRateInput = document.getElementById("quote-rate") as HTMLInputElement;
const quoteCurrencySelect = document.getElementById("quote-currency") as HTMLSelectElement;
const quoteNotesInput = document.getElementById("quote-notes") as HTMLTextAreaElement;
const quoteCancelBtn = document.getElementById("quote-cancel") as HTMLButtonElement;
const quoteSaveBtn = document.getElementById("quote-save") as HTMLButtonElement;

const convertModal = document.getElementById("convert-modal") as HTMLDivElement;
const convertModalError = document.getElementById("convert-modal-error") as HTMLDivElement;
const convertShiftSelect = document.getElementById("convert-shift") as HTMLSelectElement;
const convertFolioInput = document.getElementById("convert-folio") as HTMLInputElement;
const convertOperatorSelect = document.getElementById("convert-operator") as HTMLSelectElement;
const convertVehicleSelect = document.getElementById("convert-vehicle") as HTMLSelectElement;
const convertRouteNameInput = document.getElementById("convert-route-name") as HTMLInputElement;
const convertScheduledDepartureInput = document.getElementById("convert-scheduled-departure") as HTMLInputElement;
const convertOriginInput = document.getElementById("convert-origin") as HTMLInputElement;
const convertDestinationInput = document.getElementById("convert-destination") as HTMLInputElement;
const convertCancelBtn = document.getElementById("convert-cancel") as HTMLButtonElement;
const convertSaveBtn = document.getElementById("convert-save") as HTMLButtonElement;

let canManage = false;
let tenantId = "";
let quotes: QuoteRow[] = [];
let editingQuoteId: string | null = null;
let convertingQuote: QuoteRow | null = null;

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function fillSelect<T extends { id: string }>(select: HTMLSelectElement, items: T[], label: (item: T) => string, placeholder: string): void {
  select.innerHTML = `<option value="">${placeholder}</option>` + items.map((item) => `<option value="${item.id}">${escapeHtml(label(item))}</option>`).join("");
}

// ---------------------------------------------------------------------
// Datos de referencia (clientes/proveedores/operadores/vehículos/turnos).
// ---------------------------------------------------------------------
async function loadReferenceData(): Promise<void> {
  const [clientsRes, providersRes, operatorsRes, vehiclesRes, shiftsRes] = await Promise.all([
    supabase.from("clients").select("id, name").eq("active", true).order("name"),
    supabase.from("providers").select("id, name, is_independent").eq("active", true).order("name"),
    supabase.from("operators").select("id, full_name").eq("active", true).order("full_name"),
    supabase.from("vehicles").select("id, plate, economic_number").eq("active", true).order("plate"),
    supabase.from("shifts").select("id, name").eq("active", true).order("name"),
  ]);
  for (const res of [clientsRes, providersRes, operatorsRes, vehiclesRes, shiftsRes]) {
    if (res.error) throw res.error;
  }

  const clients = (clientsRes.data ?? []) as { id: string; name: string }[];
  const providers = (providersRes.data ?? []) as { id: string; name: string; is_independent: boolean }[];
  const operators = (operatorsRes.data ?? []) as { id: string; full_name: string }[];
  const vehicles = (vehiclesRes.data ?? []) as { id: string; plate: string; economic_number: string | null }[];
  const shifts = (shiftsRes.data ?? []) as { id: string; name: string }[];

  fillSelect(quoteClientSelect, clients, (c) => c.name, "Selecciona…");
  fillSelect(quoteProviderSelect, providers, (p) => (p.is_independent ? `${p.name} (Independiente)` : p.name), "Sin proveedor");
  fillSelect(quoteOperatorSelect, operators, (o) => o.full_name, "Sin asignar");
  fillSelect(quoteVehicleSelect, vehicles, (v) => (v.economic_number ? `${v.plate} (${v.economic_number})` : v.plate), "Sin asignar");

  fillSelect(convertShiftSelect, shifts, (s) => s.name, "Selecciona…");
  fillSelect(convertOperatorSelect, operators, (o) => o.full_name, "Selecciona…");
  fillSelect(convertVehicleSelect, vehicles, (v) => (v.economic_number ? `${v.plate} (${v.economic_number})` : v.plate), "Selecciona…");
}

// ---------------------------------------------------------------------
// Tabla de cotizaciones
// ---------------------------------------------------------------------
async function loadQuotes(): Promise<void> {
  const { data, error } = await supabase
    .from("quotes")
    .select("*, clients(name), providers(name, is_independent), operators(full_name), vehicles(plate)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  quotes = (data ?? []) as QuoteRow[];
  renderQuotes();
}

function fmtRate(q: QuoteRow): string {
  if (q.rate == null) return "—";
  return `${q.rate.toLocaleString("es-MX", { minimumFractionDigits: 2 })} ${q.currency}`;
}

function actionsFor(q: QuoteRow): string {
  if (!canManage) return "";
  if (q.status === "PENDIENTE") {
    return (
      `<button type="button" class="link-btn" data-approve-id="${q.id}">Aprobar</button> · ` +
      `<button type="button" class="link-btn" data-reject-id="${q.id}">Rechazar</button> · ` +
      `<button type="button" class="link-btn" data-edit-quote-id="${q.id}">Editar</button>`
    );
  }
  if (q.status === "APROBADA") {
    return `<button type="button" class="link-btn" data-convert-id="${q.id}">Convertir a viaje</button>`;
  }
  if (q.status === "CONVERTIDA" && q.converted_trip_id) {
    return `<a href="/bitacora.html" class="link-btn" style="text-decoration: underline">Ver viaje</a>`;
  }
  return "—";
}

function renderQuotes(): void {
  if (quotes.length === 0) {
    quotesEmptyState.textContent = "Todavía no hay cotizaciones.";
    quotesEmptyState.hidden = false;
    quotesTbody.innerHTML = "";
    return;
  }
  quotesEmptyState.hidden = true;

  quotesTbody.innerHTML = quotes
    .map((q) => {
      const ruta = q.route_name ?? ([q.origin, q.destination].filter(Boolean).join(" → ") || "—");
      return `
        <tr>
          <td>${escapeHtml(q.clients?.name ?? "—")}</td>
          <td>${escapeHtml(q.providers?.name ?? "—")}</td>
          <td>${escapeHtml(q.operators?.full_name ?? "—")}</td>
          <td>${escapeHtml(q.vehicles?.plate ?? "—")}</td>
          <td>${escapeHtml(ruta)}</td>
          <td>${fmtRate(q)}</td>
          <td>${escapeHtml(q.status)}</td>
          <td>${escapeHtml(q.notes ?? "—")}</td>
          <td>${actionsFor(q)}</td>
        </tr>
      `;
    })
    .join("");
}

function resetQuoteForm(): void {
  quoteModalError.textContent = "";
  quoteClientSelect.value = "";
  quoteProviderSelect.value = "";
  quoteOperatorSelect.value = "";
  quoteVehicleSelect.value = "";
  quoteOriginInput.value = "";
  quoteDestinationInput.value = "";
  quoteRateInput.value = "";
  quoteCurrencySelect.value = "MXN";
  quoteNotesInput.value = "";
}

function openQuoteModal(quote?: QuoteRow): void {
  resetQuoteForm();
  editingQuoteId = quote?.id ?? null;
  quoteModalTitle.textContent = quote ? "Editar cotización" : "Nueva cotización";
  if (quote) {
    quoteClientSelect.value = quote.client_id;
    quoteProviderSelect.value = quote.provider_id ?? "";
    quoteOperatorSelect.value = quote.operator_id ?? "";
    quoteVehicleSelect.value = quote.vehicle_id ?? "";
    quoteOriginInput.value = quote.origin ?? "";
    quoteDestinationInput.value = quote.destination ?? "";
    quoteRateInput.value = quote.rate != null ? String(quote.rate) : "";
    quoteCurrencySelect.value = quote.currency;
    quoteNotesInput.value = quote.notes ?? "";
  }
  quoteModal.hidden = false;
}

async function saveQuote(): Promise<void> {
  if (!quoteClientSelect.value) {
    quoteModalError.textContent = "Selecciona un cliente.";
    return;
  }
  const payload = {
    tenant_id: tenantId,
    client_id: quoteClientSelect.value,
    provider_id: quoteProviderSelect.value || null,
    operator_id: quoteOperatorSelect.value || null,
    vehicle_id: quoteVehicleSelect.value || null,
    origin: quoteOriginInput.value.trim() || null,
    destination: quoteDestinationInput.value.trim() || null,
    rate: quoteRateInput.value ? Number(quoteRateInput.value) : null,
    currency: quoteCurrencySelect.value,
    notes: quoteNotesInput.value.trim() || null,
  };
  quoteSaveBtn.disabled = true;
  try {
    if (editingQuoteId) {
      const { error } = await supabase.from("quotes").update(payload).eq("id", editingQuoteId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("quotes").insert(payload);
      if (error) throw error;
    }
    quoteModal.hidden = true;
    await loadQuotes();
  } catch (error) {
    quoteModalError.textContent = `No se pudo guardar: ${(error as Error).message}`;
  } finally {
    quoteSaveBtn.disabled = false;
  }
}

async function setQuoteStatus(id: string, status: QuoteStatus): Promise<void> {
  const { error } = await supabase.from("quotes").update({ status }).eq("id", id);
  if (error) {
    console.error(error);
    alert(`No se pudo actualizar la cotización: ${error.message}`);
    return;
  }
  await loadQuotes();
}

// ---------------------------------------------------------------------
// Convertir a viaje
// ---------------------------------------------------------------------
function openConvertModal(quote: QuoteRow): void {
  convertingQuote = quote;
  convertModalError.textContent = "";
  convertShiftSelect.value = "";
  convertFolioInput.value = "";
  convertOperatorSelect.value = quote.operator_id ?? "";
  convertVehicleSelect.value = quote.vehicle_id ?? "";
  convertRouteNameInput.value = quote.route_name ?? [quote.origin, quote.destination].filter(Boolean).join(" - ");
  convertScheduledDepartureInput.value = "";
  convertOriginInput.value = quote.origin ?? "";
  convertDestinationInput.value = quote.destination ?? "";
  convertModal.hidden = false;
}

async function convertQuoteToTrip(): Promise<void> {
  if (!convertingQuote) return;
  if (
    !convertShiftSelect.value ||
    !convertOperatorSelect.value ||
    !convertVehicleSelect.value ||
    !convertRouteNameInput.value.trim() ||
    !convertOriginInput.value.trim() ||
    !convertDestinationInput.value.trim()
  ) {
    convertModalError.textContent = "Completa turno, operador, unidad, ruta, origen y destino.";
    return;
  }

  convertSaveBtn.disabled = true;
  try {
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .insert({
        tenant_id: tenantId,
        client_id: convertingQuote.client_id,
        shift_id: convertShiftSelect.value,
        operator_id: convertOperatorSelect.value,
        vehicle_id: convertVehicleSelect.value,
        provider_id: convertingQuote.provider_id,
        route_name: convertRouteNameInput.value.trim(),
        origin: convertOriginInput.value.trim(),
        destination: convertDestinationInput.value.trim(),
        folio: convertFolioInput.value.trim() || null,
        scheduled_departure: convertScheduledDepartureInput.value
          ? new Date(convertScheduledDepartureInput.value).toISOString()
          : null,
      })
      .select("id")
      .single();
    if (tripError) throw tripError;

    const { error: quoteError } = await supabase
      .from("quotes")
      .update({ status: "CONVERTIDA", converted_trip_id: (trip as { id: string }).id })
      .eq("id", convertingQuote.id);
    if (quoteError) throw quoteError;

    convertModal.hidden = true;
    convertingQuote = null;
    await loadQuotes();
  } catch (error) {
    convertModalError.textContent = `No se pudo crear el viaje: ${(error as Error).message}`;
  } finally {
    convertSaveBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
async function init(): Promise<void> {
  const session = await requireSession();
  userEmailEl.textContent = session.user.email ?? "";

  const profile = await currentProfile(session.user.id);
  if (profile.role === "CLIENTE_VIEW") {
    window.location.href = "/dashboard.html";
    return;
  }
  tenantId = profile.tenant_id;
  canManage = MANAGER_ROLES.has(profile.role);
  newQuoteBtn.hidden = !canManage;

  await loadReferenceData();
  await loadQuotes();

  newQuoteBtn.addEventListener("click", () => openQuoteModal());
  quoteCancelBtn.addEventListener("click", () => (quoteModal.hidden = true));
  quoteSaveBtn.addEventListener("click", () => saveQuote().catch(console.error));
  quoteModal.addEventListener("click", (e) => {
    if (e.target === quoteModal) quoteModal.hidden = true;
  });

  convertCancelBtn.addEventListener("click", () => {
    convertModal.hidden = true;
    convertingQuote = null;
  });
  convertSaveBtn.addEventListener("click", () => convertQuoteToTrip().catch(console.error));
  convertModal.addEventListener("click", (e) => {
    if (e.target === convertModal) {
      convertModal.hidden = true;
      convertingQuote = null;
    }
  });

  quotesTbody.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const editId = target.closest<HTMLElement>("[data-edit-quote-id]")?.dataset.editQuoteId;
    if (editId) {
      const q = quotes.find((x) => x.id === editId);
      if (q) openQuoteModal(q);
      return;
    }
    const approveId = target.closest<HTMLElement>("[data-approve-id]")?.dataset.approveId;
    if (approveId) {
      setQuoteStatus(approveId, "APROBADA").catch(console.error);
      return;
    }
    const rejectId = target.closest<HTMLElement>("[data-reject-id]")?.dataset.rejectId;
    if (rejectId) {
      setQuoteStatus(rejectId, "RECHAZADA").catch(console.error);
      return;
    }
    const convertId = target.closest<HTMLElement>("[data-convert-id]")?.dataset.convertId;
    if (convertId) {
      const q = quotes.find((x) => x.id === convertId);
      if (q) openConvertModal(q);
    }
  });

  logoutLink.addEventListener("click", async (event) => {
    event.preventDefault();
    await supabase.auth.signOut();
    window.location.href = "/login.html";
  });
}

init().catch((error) => {
  if ((error as Error).message !== "no session") {
    console.error(error);
    quotesTbody.innerHTML = `<tr><td colspan="9" class="empty-state">Error cargando la página: ${escapeHtml(
      (error as Error).message
    )}</td></tr>`;
  }
});
