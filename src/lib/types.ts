export type TripStatus =
  | "PROGRAMADO"
  | "EN_TRANSITO"
  | "DETENIDO"
  | "FINALIZADO"
  | "CANCELADO";

export type TripEventType =
  | "EN_TRANSITO"
  | "DETENCION"
  | "REINICIO"
  | "EVIDENCIA"
  | "UBICACION";

export type GeofenceValidationStatus = "DENTRO" | "FUERA" | "SIN_VALIDAR";

export interface Shift {
  id: string;
  tenant_id: string;
  name: string;
  starts_at: string; // "HH:MM:SS"
  ends_at: string;
  cutoff_time: string;
  timezone: string;
  days_of_week: number[]; // 1=lunes ... 7=domingo (ISO)
  active: boolean;
}

export interface ProtocolThresholds {
  tenant_id: string;
  green_max_minutes: number;
  yellow_max_minutes: number;
  stop_without_evidence_minutes: number;
  max_stop_minutes: number;
}

export interface TripRow {
  id: string;
  tenant_id: string;
  client_id: string;
  shift_id: string;
  operator_id: string;
  vehicle_id: string;
  route_name: string;
  origin: string;
  destination: string;
  status: TripStatus;
  current_status_since: string;
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
  under_protocol: boolean;
  folio: string | null;
  provider_id: string | null;
  modality: string | null;
  transport_doc: string | null;
  encargado_id: string | null;
  updated_at: string;
  clients?: { name: string } | null;
  operators?: { full_name: string; phone_e164: string } | null;
  vehicles?: { plate: string; economic_number: string | null; box_has_gps: boolean } | null;
  providers?: { name: string; is_independent: boolean } | null;
  encargado?: { full_name: string } | null;
}

export interface TripEventRow {
  id: string;
  trip_id: string;
  event_type: TripEventType;
  reported_at: string;
  geofence_validation_status: GeofenceValidationStatus;
  lat: number | null;
  lng: number | null;
  notes?: string | null;
  engine_off?: boolean | null;
  stop_location_name?: string | null;
}

export interface ProviderRow {
  id: string;
  tenant_id: string;
  name: string;
  is_independent: boolean;
  active: boolean;
}

export interface ProfileOption {
  id: string;
  full_name: string;
  role: string;
}

// Una fila de la bitácora de detenciones (Fase 13): un evento DETENCION
// con los datos del viaje ya resueltos (equivalente a una fila de la hoja
// de cálculo de protocolo de seguridad que ya usa el cliente).
export interface DetentionLogRow {
  id: string;
  trip_id: string;
  reported_at: string;
  notes: string | null;
  engine_off: boolean | null;
  stop_location_name: string | null;
  lat: number | null;
  lng: number | null;
  trips?: {
    folio: string | null;
    route_name: string;
    status: TripStatus;
  } | null;
  reinicio_at?: string | null;
}

export interface TripDelayRow {
  id: string;
  trip_id: string;
  delay_minutes: number;
  justified: boolean;
  reason: string | null;
  created_at: string;
}

export type Semaforo = "verde" | "amarillo" | "rojo";

export interface ClientRow {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
}

export interface OperatorRow {
  id: string;
  full_name: string;
  phone_e164: string;
  license_number: string | null;
  active: boolean;
}

export interface VehicleRow {
  id: string;
  plate: string;
  economic_number: string | null;
  vehicle_type: string | null;
  box_has_gps: boolean;
  active: boolean;
}

export type QuoteStatus = "PENDIENTE" | "APROBADA" | "RECHAZADA" | "CONVERTIDA";

export interface QuoteRow {
  id: string;
  tenant_id: string;
  client_id: string;
  provider_id: string | null;
  operator_id: string | null;
  vehicle_id: string | null;
  route_name: string | null;
  origin: string | null;
  destination: string | null;
  rate: number | null;
  currency: string;
  status: QuoteStatus;
  notes: string | null;
  converted_trip_id: string | null;
  created_at: string;
  clients?: { name: string } | null;
  providers?: { name: string; is_independent: boolean } | null;
  operators?: { full_name: string } | null;
  vehicles?: { plate: string } | null;
}

export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface GeoJsonMultiPolygon {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

export interface GeofenceGeoJsonRow {
  id: string;
  client_id: string;
  name: string;
  category: string;
  active: boolean;
  source: string;
  imported_at: string;
  geometry: GeoJsonPolygon | GeoJsonMultiPolygon;
}

export interface ImportGeofenceResult {
  feature_name: string;
  status: "ok" | "omitido" | "error";
  detail: string | null;
}

export type AlertType = "FUERA_DE_GEOCERCA" | "ATRASO" | "SIN_REPORTE" | "ESCALAMIENTO_SEGURIDAD";

export interface TripDelayReportRow {
  id: string;
  trip_id: string;
  delay_minutes: number;
  justified: boolean;
  created_at: string;
  route_name: string;
  client_id: string | null;
  operator_id: string | null;
  client_name: string | null;
  operator_name: string | null;
}

export interface TripAlertReportRow {
  id: string;
  trip_id: string;
  alert_type: AlertType;
  created_at: string;
  route_name: string;
  client_id: string | null;
  operator_id: string | null;
  client_name: string | null;
  operator_name: string | null;
}

export type ReportGroupBy = "operator" | "client" | "route";

export interface KpiGroupStats {
  key: string;
  label: string;
  tripsWithDelay: number;
  avgDelayMinutes: number;
  delaysJustified: number;
  delaysUnjustified: number;
  fueraDeGeocerca: number;
  escalamientosSeguridad: number;
}
