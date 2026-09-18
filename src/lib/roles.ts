export const ROLES = [
  "MONITOR",
  "JEFATURA",
  "SEGURIDAD_PATRIMONIAL",
  "ADMIN",
  "CLIENTE_VIEW",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  MONITOR: "Monitor de torre de control",
  JEFATURA: "Jefatura de operaciones",
  SEGURIDAD_PATRIMONIAL: "Seguridad patrimonial",
  ADMIN: "Administrador",
  CLIENTE_VIEW: "Cliente (solo lectura)",
};
