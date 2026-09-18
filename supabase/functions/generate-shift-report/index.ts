import { createClient } from "npm:@supabase/supabase-js@2";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { sendDocument, uploadWhatsAppMedia } from "../_shared/whatsappApi.ts";
import { buildShiftReportPdf } from "./pdf.ts";
import { gatherShiftReportData } from "./report-data.ts";

type Db = ReturnType<typeof supabaseAdmin>;

interface ProcessResult {
  shift_id: string;
  status: "GENERADO" | "ENVIADO" | "ERROR";
  sent_to?: string[];
  error?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: { shift_id?: string } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const db = supabaseAdmin();
  const authHeader = req.headers.get("authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const isTrustedCron = serviceRoleKey.length > 0 && authHeader === `Bearer ${serviceRoleKey}`;

  let shiftIds: string[];

  if (isTrustedCron && !body.shift_id) {
    const { data: due, error } = await db.rpc("shifts_due_for_report", { p_window_minutes: 10 });
    if (error) {
      console.error("Error consultando turnos pendientes de reporte:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    shiftIds = (due ?? []).map((d: { shift_id: string }) => d.shift_id);
  } else {
    if (!body.shift_id) {
      return new Response(JSON.stringify({ error: "shift_id es requerido" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!isTrustedCron) {
      const authorized = await authorizeManualTrigger(authHeader, body.shift_id, db);
      if (!authorized) {
        return new Response(JSON.stringify({ error: "No autorizado" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    shiftIds = [body.shift_id];
  }

  const results: ProcessResult[] = [];
  for (const shiftId of shiftIds) {
    try {
      results.push(await processShift(db, shiftId, new Date()));
    } catch (error) {
      console.error(`Error generando el reporte del turno ${shiftId}:`, error);
      results.push({ shift_id: shiftId, status: "ERROR", error: (error as Error).message });
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

/**
 * Un usuario autenticado (no el cron) solo puede disparar la regeneración
 * del reporte de un turno de SU PROPIO tenant, y solo si es ADMIN. Sin este
 * chequeo, cualquier sesión válida podría forzar el envío del reporte
 * confidencial de otro tenant, ya que el resto de la función opera con el
 * cliente service_role (que ignora RLS).
 */
async function authorizeManualTrigger(authHeader: string, shiftId: string, adminDb: Db): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey || !authHeader) return false;

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return false;

  const [{ data: shift }, { data: profile }] = await Promise.all([
    adminDb.from("shifts").select("tenant_id").eq("id", shiftId).maybeSingle(),
    adminDb.from("profiles").select("role, tenant_id").eq("id", userData.user.id).maybeSingle(),
  ]);

  return Boolean(shift && profile && profile.role === "ADMIN" && profile.tenant_id === shift.tenant_id);
}

function dateInTimezone(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function processShift(db: Db, shiftId: string, cutoffInstant: Date): Promise<ProcessResult> {
  const { data: shift, error: shiftError } = await db
    .from("shifts")
    .select("tenant_id, timezone")
    .eq("id", shiftId)
    .single();
  if (shiftError) throw shiftError;

  const reportData = await gatherShiftReportData(db, shiftId, cutoffInstant);
  const reportDate = dateInTimezone(cutoffInstant, shift.timezone);

  const { data: reportRow, error: upsertError } = await db
    .from("shift_reports")
    .upsert(
      {
        tenant_id: shift.tenant_id,
        shift_id: shiftId,
        report_date: reportDate,
        client_id: null,
        status: "PENDIENTE",
        observations: reportData.observations,
      },
      { onConflict: "shift_id,report_date" }
    )
    .select("id")
    .single();
  if (upsertError) throw upsertError;

  try {
    return await generateAndSend(db, shift, shiftId, reportDate, reportRow.id, reportData);
  } catch (error) {
    await db
      .from("shift_reports")
      .update({ status: "ERROR", observations: `${reportData.observations}\n\nError: ${(error as Error).message}` })
      .eq("id", reportRow.id);
    throw error;
  }
}

async function generateAndSend(
  db: Db,
  shift: { tenant_id: string; timezone: string },
  shiftId: string,
  reportDate: string,
  reportRowId: string,
  reportData: Awaited<ReturnType<typeof gatherShiftReportData>>
): Promise<ProcessResult> {
  const pdfBytes = await buildShiftReportPdf(reportData);
  const storagePath = `${shift.tenant_id}/${shiftId}/${reportDate}.pdf`;

  const { error: uploadError } = await db.storage
    .from("shift-reports")
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) throw uploadError;

  await db
    .from("shift_reports")
    .update({ generated_at: new Date().toISOString(), pdf_storage_path: storagePath, status: "GENERADO" })
    .eq("id", reportRowId);

  const recipients = await getReportRecipients(db, shift.tenant_id);

  if (recipients.length === 0) {
    console.warn(`Turno ${shiftId}: sin destinatarios JEFATURA/SEGURIDAD_PATRIMONIAL con teléfono configurado.`);
    return { shift_id: shiftId, status: "GENERADO", sent_to: [] };
  }

  const filename = `reporte-turno-${reportDate}.pdf`;
  const sentTo: string[] = [];
  let anySendFailed = false;

  for (const phone of recipients) {
    try {
      const mediaId = await uploadWhatsAppMedia(pdfBytes, "application/pdf", filename);
      await sendDocument(phone, mediaId, filename, `Reporte de turno — ${reportDate}`);
      sentTo.push(phone);
    } catch (error) {
      anySendFailed = true;
      console.error(`No se pudo enviar el reporte del turno ${shiftId} a ${phone}:`, error);
    }
  }

  await db
    .from("shift_reports")
    .update({
      sent_at: sentTo.length > 0 ? new Date().toISOString() : null,
      sent_to: sentTo,
      status: sentTo.length > 0 && !anySendFailed ? "ENVIADO" : "GENERADO",
    })
    .eq("id", reportRowId);

  return {
    shift_id: shiftId,
    status: sentTo.length > 0 && !anySendFailed ? "ENVIADO" : "GENERADO",
    sent_to: sentTo,
  };
}

async function getReportRecipients(db: Db, tenantId: string): Promise<string[]> {
  const { data, error } = await db
    .from("profiles")
    .select("phone")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .in("role", ["JEFATURA", "SEGURIDAD_PATRIMONIAL"])
    .not("phone", "is", null);
  if (error) throw error;
  return (data ?? []).map((p) => p.phone as string).filter(Boolean);
}
