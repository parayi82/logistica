import type {
  ProtocolThresholds,
  Semaforo,
  TripEventRow,
  TripRow,
} from "@/lib/types";

const DEFAULT_THRESHOLDS: ProtocolThresholds = {
  tenant_id: "",
  green_max_minutes: 15,
  yellow_max_minutes: 30,
  stop_without_evidence_minutes: 20,
};

/**
 * Semáforo de cumplimiento de protocolo para un viaje:
 * - ROJO si el último evento marcó la coordenada fuera de la geocerca
 *   autorizada, o si pasó demasiado tiempo sin reportar.
 * - AMARILLO si se acerca al umbral sin reportar.
 * - VERDE si el operador está reportando dentro de los tiempos esperados.
 */
export function computeSemaforo(
  trip: TripRow,
  lastEvent: TripEventRow | undefined,
  thresholds: ProtocolThresholds = DEFAULT_THRESHOLDS,
  now: Date = new Date()
): Semaforo {
  if (trip.status === "FINALIZADO" || trip.status === "CANCELADO") {
    return "verde";
  }

  if (lastEvent?.geofence_validation_status === "FUERA") {
    return "rojo";
  }

  const referenceTime = lastEvent?.reported_at ?? trip.current_status_since;
  const minutesSince = (now.getTime() - new Date(referenceTime).getTime()) / 60000;

  const stopLimit =
    trip.status === "DETENIDO"
      ? thresholds.stop_without_evidence_minutes
      : thresholds.yellow_max_minutes;

  if (minutesSince >= stopLimit) return "rojo";
  if (minutesSince >= thresholds.green_max_minutes) return "amarillo";
  return "verde";
}

export function minutesSince(dateStr: string, now: Date = new Date()): number {
  return Math.max(0, Math.round((now.getTime() - new Date(dateStr).getTime()) / 60000));
}
