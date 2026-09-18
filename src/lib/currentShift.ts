import type { Shift } from "@/lib/types";

function isoWeekday(date: Date): number {
  const day = date.getDay(); // 0=domingo..6=sábado
  return day === 0 ? 7 : day; // 1=lunes..7=domingo
}

function toMinutes(hhmmss: string): number {
  const [h, m] = hhmmss.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Determina qué turno está vigente ahora mismo, soportando turnos que
 * cruzan medianoche (ej. 20:00 - 06:00).
 */
export function findCurrentShift(shifts: Shift[], now: Date = new Date()): Shift | null {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const weekday = isoWeekday(now);
  const prevWeekday = weekday === 1 ? 7 : weekday - 1;

  for (const shift of shifts) {
    if (!shift.active) continue;

    const start = toMinutes(shift.starts_at);
    const end = toMinutes(shift.ends_at);
    const crossesMidnight = end <= start;

    if (!crossesMidnight) {
      if (shift.days_of_week.includes(weekday) && nowMinutes >= start && nowMinutes < end) {
        return shift;
      }
    } else {
      // Tramo de hoy: [start, 24:00)
      if (shift.days_of_week.includes(weekday) && nowMinutes >= start) {
        return shift;
      }
      // Tramo de la madrugada, pertenece al turno que inició el día anterior
      if (shift.days_of_week.includes(prevWeekday) && nowMinutes < end) {
        return shift;
      }
    }
  }

  return null;
}
