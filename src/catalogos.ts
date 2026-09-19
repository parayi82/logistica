import { supabase } from "@/lib/supabaseClient";
import { currentProfile, requireSession } from "@/lib/auth";
import type { ClientRow, OperatorRow, ProviderRow, VehicleRow } from "@/lib/types";

const MANAGER_ROLES = new Set(["ADMIN", "JEFATURA", "MONITOR"]);

const userEmailEl = document.getElementById("user-email") as HTMLSpanElement;
const logoutLink = document.getElementById("logout-link") as HTMLAnchorElement;

let canManage = false;
let tenantId = "";

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function yesNo(value: boolean): string {
  return value ? "Sí" : "No";
}

// ---------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------
const clientsTbody = document.getElementById("clients-tbody") as HTMLTableSectionElement;
const newClientBtn = document.getElementById("new-client-btn") as HTMLButtonElement;
const clientEditColHeader = document.getElementById("client-edit-col-header") as HTMLTableCellElement;
const clientModal = document.getElementById("client-modal") as HTMLDivElement;
const clientModalTitle = document.getElementById("client-modal-title") as HTMLHeadingElement;
const clientModalError = document.getElementById("client-modal-error") as HTMLDivElement;
const clientNameInput = document.getElementById("client-name") as HTMLInputElement;
const clientCodeInput = document.getElementById("client-code") as HTMLInputElement;
const clientActiveInput = document.getElementById("client-active") as HTMLInputElement;
const clientCancelBtn = document.getElementById("client-cancel") as HTMLButtonElement;
const clientSaveBtn = document.getElementById("client-save") as HTMLButtonElement;
let clients: ClientRow[] = [];
let editingClientId: string | null = null;

async function loadClients(): Promise<void> {
  const { data, error } = await supabase.from("clients").select("id, name, code, active").order("name");
  if (error) throw error;
  clients = (data ?? []) as ClientRow[];
  clientsTbody.innerHTML = clients
    .map(
      (c) => `
        <tr>
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(c.code ?? "—")}</td>
          <td>${yesNo(c.active)}</td>
          ${canManage ? `<td><button type="button" class="link-btn" data-edit-client-id="${c.id}">Editar</button></td>` : ""}
        </tr>
      `
    )
    .join("");
}

function openClientModal(client?: ClientRow): void {
  editingClientId = client?.id ?? null;
  clientModalTitle.textContent = client ? "Editar cliente" : "Nuevo cliente";
  clientModalError.textContent = "";
  clientNameInput.value = client?.name ?? "";
  clientCodeInput.value = client?.code ?? "";
  clientActiveInput.checked = client ? client.active : true;
  clientModal.hidden = false;
}

async function saveClient(): Promise<void> {
  const name = clientNameInput.value.trim();
  if (!name) {
    clientModalError.textContent = "El nombre es obligatorio.";
    return;
  }
  const payload = { tenant_id: tenantId, name, code: clientCodeInput.value.trim() || null, active: clientActiveInput.checked };
  clientSaveBtn.disabled = true;
  try {
    if (editingClientId) {
      const { error } = await supabase.from("clients").update(payload).eq("id", editingClientId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("clients").insert(payload);
      if (error) throw error;
    }
    clientModal.hidden = true;
    await loadClients();
  } catch (error) {
    clientModalError.textContent = `No se pudo guardar: ${(error as Error).message}`;
  } finally {
    clientSaveBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------
const providersTbody = document.getElementById("providers-tbody") as HTMLTableSectionElement;
const newProviderBtn = document.getElementById("new-provider-btn") as HTMLButtonElement;
const providerEditColHeader = document.getElementById("provider-edit-col-header") as HTMLTableCellElement;
const providerModal = document.getElementById("provider-modal") as HTMLDivElement;
const providerModalTitle = document.getElementById("provider-modal-title") as HTMLHeadingElement;
const providerModalError = document.getElementById("provider-modal-error") as HTMLDivElement;
const providerNameInput = document.getElementById("provider-name") as HTMLInputElement;
const providerIndependentInput = document.getElementById("provider-independent") as HTMLInputElement;
const providerActiveInput = document.getElementById("provider-active") as HTMLInputElement;
const providerCancelBtn = document.getElementById("provider-cancel") as HTMLButtonElement;
const providerSaveBtn = document.getElementById("provider-save") as HTMLButtonElement;
let providers: ProviderRow[] = [];
let editingProviderId: string | null = null;

async function loadProviders(): Promise<void> {
  const { data, error } = await supabase.from("providers").select("id, tenant_id, name, is_independent, active").order("name");
  if (error) throw error;
  providers = (data ?? []) as ProviderRow[];
  providersTbody.innerHTML = providers
    .map(
      (p) => `
        <tr>
          <td>${escapeHtml(p.name)}</td>
          <td>${yesNo(p.is_independent)}</td>
          <td>${yesNo(p.active)}</td>
          ${canManage ? `<td><button type="button" class="link-btn" data-edit-provider-id="${p.id}">Editar</button></td>` : ""}
        </tr>
      `
    )
    .join("");
}

function openProviderModal(provider?: ProviderRow): void {
  editingProviderId = provider?.id ?? null;
  providerModalTitle.textContent = provider ? "Editar proveedor" : "Nuevo proveedor";
  providerModalError.textContent = "";
  providerNameInput.value = provider?.name ?? "";
  providerIndependentInput.checked = provider?.is_independent ?? false;
  providerActiveInput.checked = provider ? provider.active : true;
  providerModal.hidden = false;
}

async function saveProvider(): Promise<void> {
  const name = providerNameInput.value.trim();
  if (!name) {
    providerModalError.textContent = "El nombre es obligatorio.";
    return;
  }
  const payload = {
    tenant_id: tenantId,
    name,
    is_independent: providerIndependentInput.checked,
    active: providerActiveInput.checked,
  };
  providerSaveBtn.disabled = true;
  try {
    if (editingProviderId) {
      const { error } = await supabase.from("providers").update(payload).eq("id", editingProviderId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("providers").insert(payload);
      if (error) throw error;
    }
    providerModal.hidden = true;
    await loadProviders();
  } catch (error) {
    providerModalError.textContent = `No se pudo guardar: ${(error as Error).message}`;
  } finally {
    providerSaveBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Operadores
// ---------------------------------------------------------------------
const operatorsTbody = document.getElementById("operators-tbody") as HTMLTableSectionElement;
const newOperatorBtn = document.getElementById("new-operator-btn") as HTMLButtonElement;
const operatorEditColHeader = document.getElementById("operator-edit-col-header") as HTMLTableCellElement;
const operatorModal = document.getElementById("operator-modal") as HTMLDivElement;
const operatorModalTitle = document.getElementById("operator-modal-title") as HTMLHeadingElement;
const operatorModalError = document.getElementById("operator-modal-error") as HTMLDivElement;
const operatorNameInput = document.getElementById("operator-name") as HTMLInputElement;
const operatorPhoneInput = document.getElementById("operator-phone") as HTMLInputElement;
const operatorLicenseInput = document.getElementById("operator-license") as HTMLInputElement;
const operatorActiveInput = document.getElementById("operator-active") as HTMLInputElement;
const operatorCancelBtn = document.getElementById("operator-cancel") as HTMLButtonElement;
const operatorSaveBtn = document.getElementById("operator-save") as HTMLButtonElement;
let operators: OperatorRow[] = [];
let editingOperatorId: string | null = null;

async function loadOperators(): Promise<void> {
  const { data, error } = await supabase
    .from("operators")
    .select("id, full_name, phone_e164, license_number, active")
    .order("full_name");
  if (error) throw error;
  operators = (data ?? []) as OperatorRow[];
  operatorsTbody.innerHTML = operators
    .map(
      (o) => `
        <tr>
          <td>${escapeHtml(o.full_name)}</td>
          <td>${escapeHtml(o.phone_e164)}</td>
          <td>${escapeHtml(o.license_number ?? "—")}</td>
          <td>${yesNo(o.active)}</td>
          ${canManage ? `<td><button type="button" class="link-btn" data-edit-operator-id="${o.id}">Editar</button></td>` : ""}
        </tr>
      `
    )
    .join("");
}

function openOperatorModal(operator?: OperatorRow): void {
  editingOperatorId = operator?.id ?? null;
  operatorModalTitle.textContent = operator ? "Editar operador" : "Nuevo operador";
  operatorModalError.textContent = "";
  operatorNameInput.value = operator?.full_name ?? "";
  operatorPhoneInput.value = operator?.phone_e164 ?? "";
  operatorLicenseInput.value = operator?.license_number ?? "";
  operatorActiveInput.checked = operator ? operator.active : true;
  operatorModal.hidden = false;
}

async function saveOperator(): Promise<void> {
  const fullName = operatorNameInput.value.trim();
  const phone = operatorPhoneInput.value.trim();
  if (!fullName || !phone) {
    operatorModalError.textContent = "Nombre y teléfono son obligatorios.";
    return;
  }
  if (!phone.startsWith("+")) {
    operatorModalError.textContent = "El teléfono debe incluir el código de país, ej. +525512345678.";
    return;
  }
  const payload = {
    tenant_id: tenantId,
    full_name: fullName,
    phone_e164: phone,
    license_number: operatorLicenseInput.value.trim() || null,
    active: operatorActiveInput.checked,
  };
  operatorSaveBtn.disabled = true;
  try {
    if (editingOperatorId) {
      const { error } = await supabase.from("operators").update(payload).eq("id", editingOperatorId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("operators").insert(payload);
      if (error) throw error;
    }
    operatorModal.hidden = true;
    await loadOperators();
  } catch (error) {
    operatorModalError.textContent = `No se pudo guardar: ${(error as Error).message}`;
  } finally {
    operatorSaveBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Vehículos
// ---------------------------------------------------------------------
const vehiclesTbody = document.getElementById("vehicles-tbody") as HTMLTableSectionElement;
const newVehicleBtn = document.getElementById("new-vehicle-btn") as HTMLButtonElement;
const vehicleEditColHeader = document.getElementById("vehicle-edit-col-header") as HTMLTableCellElement;
const vehicleModal = document.getElementById("vehicle-modal") as HTMLDivElement;
const vehicleModalTitle = document.getElementById("vehicle-modal-title") as HTMLHeadingElement;
const vehicleModalError = document.getElementById("vehicle-modal-error") as HTMLDivElement;
const vehiclePlateInput = document.getElementById("vehicle-plate") as HTMLInputElement;
const vehicleEcoInput = document.getElementById("vehicle-eco") as HTMLInputElement;
const vehicleTypeInput = document.getElementById("vehicle-type") as HTMLInputElement;
const vehicleGpsInput = document.getElementById("vehicle-gps") as HTMLInputElement;
const vehicleActiveInput = document.getElementById("vehicle-active") as HTMLInputElement;
const vehicleCancelBtn = document.getElementById("vehicle-cancel") as HTMLButtonElement;
const vehicleSaveBtn = document.getElementById("vehicle-save") as HTMLButtonElement;
let vehicles: VehicleRow[] = [];
let editingVehicleId: string | null = null;

async function loadVehicles(): Promise<void> {
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, plate, economic_number, vehicle_type, box_has_gps, active")
    .order("plate");
  if (error) throw error;
  vehicles = (data ?? []) as VehicleRow[];
  vehiclesTbody.innerHTML = vehicles
    .map(
      (v) => `
        <tr>
          <td>${escapeHtml(v.plate)}</td>
          <td>${escapeHtml(v.economic_number ?? "—")}</td>
          <td>${escapeHtml(v.vehicle_type ?? "—")}</td>
          <td>${yesNo(v.box_has_gps)}</td>
          <td>${yesNo(v.active)}</td>
          ${canManage ? `<td><button type="button" class="link-btn" data-edit-vehicle-id="${v.id}">Editar</button></td>` : ""}
        </tr>
      `
    )
    .join("");
}

function openVehicleModal(vehicle?: VehicleRow): void {
  editingVehicleId = vehicle?.id ?? null;
  vehicleModalTitle.textContent = vehicle ? "Editar vehículo" : "Nuevo vehículo";
  vehicleModalError.textContent = "";
  vehiclePlateInput.value = vehicle?.plate ?? "";
  vehicleEcoInput.value = vehicle?.economic_number ?? "";
  vehicleTypeInput.value = vehicle?.vehicle_type ?? "";
  vehicleGpsInput.checked = vehicle?.box_has_gps ?? false;
  vehicleActiveInput.checked = vehicle ? vehicle.active : true;
  vehicleModal.hidden = false;
}

async function saveVehicle(): Promise<void> {
  const plate = vehiclePlateInput.value.trim();
  if (!plate) {
    vehicleModalError.textContent = "La placa es obligatoria.";
    return;
  }
  const payload = {
    tenant_id: tenantId,
    plate,
    economic_number: vehicleEcoInput.value.trim() || null,
    vehicle_type: vehicleTypeInput.value.trim() || null,
    box_has_gps: vehicleGpsInput.checked,
    active: vehicleActiveInput.checked,
  };
  vehicleSaveBtn.disabled = true;
  try {
    if (editingVehicleId) {
      const { error } = await supabase.from("vehicles").update(payload).eq("id", editingVehicleId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("vehicles").insert(payload);
      if (error) throw error;
    }
    vehicleModal.hidden = true;
    await loadVehicles();
  } catch (error) {
    vehicleModalError.textContent = `No se pudo guardar: ${(error as Error).message}`;
  } finally {
    vehicleSaveBtn.disabled = false;
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

  newClientBtn.hidden = !canManage;
  clientEditColHeader.hidden = !canManage;
  newProviderBtn.hidden = !canManage;
  providerEditColHeader.hidden = !canManage;
  newOperatorBtn.hidden = !canManage;
  operatorEditColHeader.hidden = !canManage;
  newVehicleBtn.hidden = !canManage;
  vehicleEditColHeader.hidden = !canManage;

  await Promise.all([loadClients(), loadProviders(), loadOperators(), loadVehicles()]);

  newClientBtn.addEventListener("click", () => openClientModal());
  clientCancelBtn.addEventListener("click", () => (clientModal.hidden = true));
  clientSaveBtn.addEventListener("click", () => saveClient().catch(console.error));
  clientModal.addEventListener("click", (e) => {
    if (e.target === clientModal) clientModal.hidden = true;
  });
  clientsTbody.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-edit-client-id]");
    if (!target) return;
    const client = clients.find((c) => c.id === target.dataset.editClientId);
    if (client) openClientModal(client);
  });

  newProviderBtn.addEventListener("click", () => openProviderModal());
  providerCancelBtn.addEventListener("click", () => (providerModal.hidden = true));
  providerSaveBtn.addEventListener("click", () => saveProvider().catch(console.error));
  providerModal.addEventListener("click", (e) => {
    if (e.target === providerModal) providerModal.hidden = true;
  });
  providersTbody.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-edit-provider-id]");
    if (!target) return;
    const provider = providers.find((p) => p.id === target.dataset.editProviderId);
    if (provider) openProviderModal(provider);
  });

  newOperatorBtn.addEventListener("click", () => openOperatorModal());
  operatorCancelBtn.addEventListener("click", () => (operatorModal.hidden = true));
  operatorSaveBtn.addEventListener("click", () => saveOperator().catch(console.error));
  operatorModal.addEventListener("click", (e) => {
    if (e.target === operatorModal) operatorModal.hidden = true;
  });
  operatorsTbody.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-edit-operator-id]");
    if (!target) return;
    const operator = operators.find((o) => o.id === target.dataset.editOperatorId);
    if (operator) openOperatorModal(operator);
  });

  newVehicleBtn.addEventListener("click", () => openVehicleModal());
  vehicleCancelBtn.addEventListener("click", () => (vehicleModal.hidden = true));
  vehicleSaveBtn.addEventListener("click", () => saveVehicle().catch(console.error));
  vehicleModal.addEventListener("click", (e) => {
    if (e.target === vehicleModal) vehicleModal.hidden = true;
  });
  vehiclesTbody.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-edit-vehicle-id]");
    if (!target) return;
    const vehicle = vehicles.find((v) => v.id === target.dataset.editVehicleId);
    if (vehicle) openVehicleModal(vehicle);
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
    clientsTbody.innerHTML = `<tr><td colspan="4" class="empty-state">Error cargando la página: ${escapeHtml(
      (error as Error).message
    )}</td></tr>`;
  }
});
