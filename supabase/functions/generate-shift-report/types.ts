export interface ShiftReportData {
  tenantName: string;
  shiftName: string;
  timezone: string;
  windowStart: Date;
  windowEnd: Date;
  generatedAt: Date;
  restartsWithoutEvidence: RestartRow[];
  stops: StopRow[];
  coordinateChecks: CoordinateCheckRow[];
  checklist: ChecklistRow[];
  observations: string;
}

export interface RestartRow {
  operator: string;
  vehicle: string;
  route: string;
  stoppedAt: Date;
  resumedAt: Date;
  minutes: number;
}

export interface StopRow {
  operator: string;
  vehicle: string;
  route: string;
  stoppedAt: Date;
  resumedAt: Date | null;
  durationMinutes: number | null;
  delayMinutes: number | null;
}

export interface CoordinateCheckRow {
  operator: string;
  route: string;
  reportedAt: Date;
  lat: number;
  lng: number;
  status: "DENTRO" | "FUERA" | "SIN_VALIDAR";
  geofenceName: string | null;
}

export interface ChecklistRow {
  code: string;
  description: string;
  summary: string;
}
