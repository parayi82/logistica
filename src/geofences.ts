import { supabase } from "@/lib/supabaseClient";
import { currentProfile, requireSession } from "@/lib/auth";
import type { ClientRow, GeofenceGeoJsonRow, ImportGeofenceResult } from "@/lib/types";

const clientSelect = document.getElementById("client-select") as HTMLSelectElement;
const adminOnly = document.getElementById("admin-only") as HTMLDivElement;
const readonlyNote = document.getElementById("readonly-note") as HTMLParagraphElement;
const fileInput = document.getElementById("geojson-file") as HTMLInputElement;
const importBtn = document.getElementById("import-btn") as HTMLButtonElement;
const resultsEl = document.getElementById("import-results") as HTMLDivElement;
const mapEmptyState = document.getElementById("map-empty-state") as HTMLParagraphElement;
const userEmailEl = document.getElementById("user-email") as HTMLSpanElement;

let isAdmin = false;

// Leaflet se carga vía <script> externo (CDN); si falla (red bloqueada,
// CDN caído) queremos degradar con un mensaje claro, no tumbar el resto
// del script (selector de cliente, import, etc. no dependen del mapa).
const mapAvailable = typeof L !== "undefined";
let map: ReturnType<typeof L.map> | undefined;
let geofenceLayer: ReturnType<typeof L.layerGroup> | undefined;

if (mapAvailable) {
  map = L.map("map").setView([19.4326, -99.1332], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);
  geofenceLayer = L.layerGroup().addTo(map);
} else {
  console.error("Leaflet no cargó (revisa conectividad al CDN); el mapa no estará disponible.");
  const mapEl = document.getElementById("map");
  if (mapEl) {
    mapEl.outerHTML = `<p class="empty-state">No se pudo cargar el mapa (sin conexión al CDN de Leaflet). El resto de la página sigue funcionando.</p>`;
  }
}

async function loadClients(): Promise<ClientRow[]> {
  const { data, error } = await supabase.from("clients").select("id, name, code").order("name");
  if (error) throw error;
  return (data ?? []) as ClientRow[];
}

async function loadGeofences(clientId: string): Promise<GeofenceGeoJsonRow[]> {
  const { data, error } = await supabase
    .from("geofences_geojson")
    .select("*")
    .eq("client_id", clientId)
    .eq("active", true);
  if (error) throw error;
  return (data ?? []) as GeofenceGeoJsonRow[];
}

function renderGeofences(geofences: GeofenceGeoJsonRow[]): void {
  if (geofences.length === 0) {
    mapEmptyState.textContent = "Este cliente no tiene geocercas importadas todavía.";
    mapEmptyState.hidden = false;
    geofenceLayer?.clearLayers();
    return;
  }
  mapEmptyState.hidden = true;

  if (!mapAvailable || !map || !geofenceLayer) return;
  geofenceLayer.clearLayers();

  const featureCollection = {
    type: "FeatureCollection",
    features: geofences.map((g) => ({
      type: "Feature",
      properties: { name: g.name, category: g.category },
      geometry: g.geometry,
    })),
  };

  const layer = L.geoJSON(featureCollection, {
    style: { color: "#3b82f6", weight: 2, fillOpacity: 0.15 },
    onEachFeature: (feature: { properties: { name: string; category: string } }, l: any) => {
      l.bindPopup(`<strong>${feature.properties.name}</strong><br>${feature.properties.category}`);
    },
  });
  layer.addTo(geofenceLayer);

  const bounds = layer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [30, 30] });
  }
}

function renderImportResults(results: ImportGeofenceResult[]): void {
  const rows = results
    .map(
      (r) => `
        <tr>
          <td>${escapeHtml(r.feature_name)}</td>
          <td>${r.status}</td>
          <td>${escapeHtml(r.detail ?? "")}</td>
        </tr>
      `
    )
    .join("");

  resultsEl.innerHTML = `
    <table style="margin-bottom: 16px">
      <thead><tr><th>Parador</th><th>Resultado</th><th>Detalle</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

async function onClientChange(): Promise<void> {
  const clientId = clientSelect.value;
  if (!clientId) return;
  const geofences = await loadGeofences(clientId);
  renderGeofences(geofences);
}

async function onImportClick(): Promise<void> {
  const clientId = clientSelect.value;
  const file = fileInput.files?.[0];
  if (!clientId || !file) {
    resultsEl.innerHTML = `<p class="error">Selecciona un cliente y un archivo .geojson.</p>`;
    return;
  }

  importBtn.disabled = true;
  try {
    const text = await file.text();
    const geojson = JSON.parse(text);

    const { data, error } = await supabase.rpc("import_geofences", {
      p_client_id: clientId,
      p_geojson: geojson,
    });
    if (error) throw error;

    renderImportResults((data ?? []) as ImportGeofenceResult[]);
    await onClientChange();
  } catch (error) {
    resultsEl.innerHTML = `<p class="error">Error al importar: ${escapeHtml((error as Error).message)}</p>`;
  } finally {
    importBtn.disabled = false;
  }
}

async function init(): Promise<void> {
  const session = await requireSession();
  userEmailEl.textContent = session.user.email ?? "";

  const profile = await currentProfile(session.user.id);
  isAdmin = profile.role === "ADMIN";
  adminOnly.hidden = !isAdmin;
  readonlyNote.hidden = isAdmin;

  const clients = await loadClients();
  clientSelect.innerHTML = clients
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.code ? ` (${c.code})` : ""}</option>`)
    .join("");

  clientSelect.addEventListener("change", () => onClientChange().catch(console.error));
  importBtn.addEventListener("click", () => onImportClick().catch(console.error));

  if (clients.length > 0) {
    await onClientChange();
  } else {
    resultsEl.innerHTML = `<p class="empty-state">Este tenant todavía no tiene clientes dados de alta.</p>`;
  }
}

init().catch((error) => {
  if ((error as Error).message !== "no session") {
    console.error(error);
    resultsEl.innerHTML = `<p class="error">Error cargando la página: ${escapeHtml((error as Error).message)}</p>`;
  }
});
