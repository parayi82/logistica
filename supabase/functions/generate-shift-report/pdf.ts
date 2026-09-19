import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import type { ShiftReportData } from "./types.ts";

const PAGE_WIDTH = 612; // Carta (Letter)
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function fmtDateTime(date: Date, timezone: string): string {
  return date.toLocaleString("es-MX", {
    timeZone: timezone,
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Las fuentes estándar (Helvetica) solo soportan WinAnsi/CP1252: cualquier
 * carácter fuera de ese repertorio (flechas, emoji, CJK, etc. — cosas que
 * bien pueden venir de un mensaje de WhatsApp libre) tumba drawText/
 * widthOfTextAtSize con una excepción. Se reemplaza por su glifo más
 * cercano cuando existe uno obvio, o por "?" en cualquier otro caso.
 */
function sanitize(font: PDFFont, text: string): string {
  const withKnownReplacements = (text ?? "").replaceAll("→", "->").replaceAll("←", "<-");
  let result = "";
  for (const ch of withKnownReplacements) {
    try {
      font.widthOfTextAtSize(ch, 10);
      result += ch;
    } catch {
      result += "?";
    }
  }
  return result;
}

function truncate(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const safe = sanitize(font, text);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let result = safe;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

class ReportBuilder {
  private doc: PDFDocument;
  private font!: PDFFont;
  private boldFont!: PDFFont;
  private page!: PDFPage;
  private y = 0;

  private constructor(doc: PDFDocument) {
    this.doc = doc;
  }

  static async create(): Promise<ReportBuilder> {
    const doc = await PDFDocument.create();
    const builder = new ReportBuilder(doc);
    builder.font = await doc.embedFont(StandardFonts.Helvetica);
    builder.boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    builder.newPage();
    return builder;
  }

  private newPage(): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  /** Crea una página nueva si no cabe `height` más en la actual. Devuelve true si saltó de página. */
  private ensureSpace(height: number): boolean {
    if (this.y - height < MARGIN) {
      this.newPage();
      return true;
    }
    return false;
  }

  addTitle(text: string): void {
    this.ensureSpace(26);
    this.page.drawText(sanitize(this.boldFont, text), { x: MARGIN, y: this.y - 18, size: 18, font: this.boldFont });
    this.y -= 32;
  }

  addSectionHeading(text: string): void {
    this.ensureSpace(28);
    this.y -= 6;
    this.page.drawText(sanitize(this.boldFont, text), {
      x: MARGIN,
      y: this.y - 14,
      size: 13,
      font: this.boldFont,
      color: rgb(0.13, 0.16, 0.28),
    });
    this.y -= 22;
  }

  addLine(text: string, opts: { size?: number; bold?: boolean } = {}): void {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.boldFont : this.font;
    this.ensureSpace(size + 4);
    this.page.drawText(sanitize(font, text), {
      x: MARGIN,
      y: this.y - size,
      size,
      font,
    });
    this.y -= size + 6;
  }

  addBulletList(items: string[], emptyText: string): void {
    if (items.length === 0) {
      this.addLine(`• ${emptyText}`, { size: 10 });
      return;
    }
    for (const item of items) {
      this.ensureSpace(14);
      const text = truncate(this.font, `• ${item}`, 10, CONTENT_WIDTH);
      this.page.drawText(text, { x: MARGIN, y: this.y - 10, size: 10, font: this.font });
      this.y -= 16;
    }
    this.y -= 4;
  }

  addTable(headers: string[], rows: string[][], widths: number[], emptyText: string): void {
    const rowHeight = 16;

    const drawHeader = () => {
      this.ensureSpace(rowHeight + 4);
      let x = MARGIN;
      for (let i = 0; i < headers.length; i++) {
        this.page.drawText(headers[i], { x, y: this.y - 11, size: 9, font: this.boldFont });
        x += widths[i];
      }
      this.y -= rowHeight;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y + 5 },
        end: { x: MARGIN + CONTENT_WIDTH, y: this.y + 5 },
        thickness: 0.5,
        color: rgb(0.6, 0.6, 0.6),
      });
    };

    drawHeader();

    if (rows.length === 0) {
      this.addLine(emptyText, { size: 9 });
      this.y -= 6;
      return;
    }

    for (const row of rows) {
      const broke = this.ensureSpace(rowHeight);
      if (broke) drawHeader();

      let x = MARGIN;
      for (let i = 0; i < row.length; i++) {
        const text = truncate(this.font, row[i], 9, widths[i] - 6);
        this.page.drawText(text, { x, y: this.y - 11, size: 9, font: this.font });
        x += widths[i];
      }
      this.y -= rowHeight;
    }
    this.y -= 6;
  }

  save(): Promise<Uint8Array> {
    return this.doc.save();
  }
}

const COL = {
  restarts: [90, 70, 130, 90, 90, 70],
  stops: [80, 60, 120, 85, 85, 70, 70],
  coords: [80, 110, 90, 130, 60],
} as const;

export async function buildShiftReportPdf(data: ShiftReportData): Promise<Uint8Array> {
  const b = await ReportBuilder.create();
  const tz = data.timezone;

  b.addTitle(`Reporte de turno — ${data.shiftName}`);
  b.addLine(data.tenantName, { bold: true });
  b.addLine(`Periodo: ${fmtDateTime(data.windowStart, tz)} a ${fmtDateTime(data.windowEnd, tz)}`);
  b.addLine(`Generado: ${fmtDateTime(data.generatedAt, tz)}`);

  b.addSectionHeading("Reinicios sin evidencia");
  b.addTable(
    ["Operador", "Unidad", "Ruta", "Detención", "Reinicio", "Min."],
    data.restartsWithoutEvidence.map((r) => [
      r.operator,
      r.vehicle,
      r.route,
      fmtDateTime(r.stoppedAt, tz),
      fmtDateTime(r.resumedAt, tz),
      String(r.minutes),
    ]),
    [...COL.restarts],
    "Todos los reinicios del turno tienen evidencia registrada."
  );

  b.addSectionHeading("Detenciones");
  b.addTable(
    ["Operador", "Unidad", "Ruta", "Inicio", "Fin", "Dur. (min)", "Atraso (min)"],
    data.stops.map((s) => [
      s.operator,
      s.vehicle,
      s.route,
      fmtDateTime(s.stoppedAt, tz),
      s.resumedAt ? fmtDateTime(s.resumedAt, tz) : "EN CURSO",
      s.durationMinutes != null ? String(s.durationMinutes) : "—",
      s.delayMinutes != null ? String(s.delayMinutes) : "—",
    ]),
    [...COL.stops],
    "No se registraron detenciones en este turno."
  );

  b.addSectionHeading("Validación de coordenadas");
  b.addTable(
    ["Operador", "Ruta", "Hora", "Coordenadas", "Geocerca"],
    data.coordinateChecks.map((c) => [
      c.operator,
      c.route,
      fmtDateTime(c.reportedAt, tz),
      `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} (${c.status})`,
      c.geofenceName ?? "—",
    ]),
    [...COL.coords],
    "No se recibieron coordenadas para validar en este turno."
  );

  const nonCompliance = buildNonComplianceList(data);
  b.addSectionHeading("Incumplimientos detectados");
  b.addBulletList(nonCompliance, "Sin incumplimientos detectados en este turno.");

  b.addSectionHeading("Checklist de cumplimiento");
  if (data.checklist.length === 0) {
    b.addLine("Este tenant no tiene un checklist de protocolo configurado.", { size: 9 });
  } else {
    b.addTable(
      ["Punto de protocolo", "Resultado"],
      data.checklist.map((c) => [`${c.code} — ${c.description}`, c.summary]),
      [340, 140],
      "—"
    );
  }

  b.addSectionHeading("Observaciones");
  b.addLine(data.observations || "Sin observaciones.", { size: 10 });

  return b.save();
}

function buildNonComplianceList(data: ShiftReportData): string[] {
  const items: string[] = [];

  for (const r of data.restartsWithoutEvidence) {
    items.push(`${r.operator} (${r.route}): reinició sin evidencia fotográfica adjunta.`);
  }
  for (const c of data.coordinateChecks) {
    if (c.status === "FUERA") {
      items.push(`${c.operator} (${c.route}): coordenada fuera de la geocerca autorizada a las ${fmtDateTime(c.reportedAt, data.timezone)}.`);
    }
  }
  for (const s of data.stops) {
    if (s.delayMinutes && s.delayMinutes > 0) {
      items.push(`${s.operator} (${s.route}): reinicio con ${s.delayMinutes} min de atraso.`);
    }
  }

  return items;
}
