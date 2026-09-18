function toMinutes(hhmmss: string): number {
  const [h, m] = hhmmss.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Dado un turno (horas de inicio/fin/corte como HH:MM:SS, sin fecha) y el
 * instante en que se dispara el corte, calcula el rango absoluto [start,
 * end] de datos a incluir en el reporte. Trabaja con duraciones (no con
 * fechas de calendario) para que los turnos que cruzan medianoche no
 * generen ambigüedad de "a qué día pertenece el reporte".
 */
export function computeShiftWindow(
  shift: { starts_at: string; ends_at: string; cutoff_time: string },
  cutoffInstant: Date
): { start: Date; end: Date } {
  const startMin = toMinutes(shift.starts_at);
  const endMin = toMinutes(shift.ends_at);
  const cutoffMin = toMinutes(shift.cutoff_time);

  const shiftDurationMin = endMin > startMin ? endMin - startMin : 24 * 60 - startMin + endMin;
  const gapToCutoffMin = cutoffMin >= endMin ? cutoffMin - endMin : 24 * 60 - endMin + cutoffMin;

  const start = new Date(cutoffInstant.getTime() - (shiftDurationMin + gapToCutoffMin) * 60_000);
  return { start, end: cutoffInstant };
}
