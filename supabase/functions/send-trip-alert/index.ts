import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { sendText } from "../_shared/telegramApi.ts";

const DEFAULT_TARGET_ROLES = ["JEFATURA", "SEGURIDAD_PATRIMONIAL"];

interface AlertPayload {
  trip_id?: string;
  alert_type?: string;
  message?: string;
  target_roles?: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Solo lo invoca app.notify_trip_alert (vía pg_net) con la service role
  // key leída de Vault; no hay un caso de uso legítimo para llamarla desde
  // el navegador, así que no hace falta el camino de autorización manual
  // que sí tiene generate-shift-report.
  const authHeader = req.headers.get("authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: AlertPayload = {};
  try {
    body = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (!body.trip_id || !body.message) {
    return new Response(JSON.stringify({ error: "trip_id y message son requeridos" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = supabaseAdmin();

  const { data: trip, error: tripError } = await db
    .from("trips")
    .select("tenant_id")
    .eq("id", body.trip_id)
    .maybeSingle();
  if (tripError) throw tripError;
  if (!trip) {
    return new Response(JSON.stringify({ error: "Viaje no encontrado" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const targetRoles =
    body.target_roles && body.target_roles.length > 0 ? body.target_roles : DEFAULT_TARGET_ROLES;

  const { data: recipients, error: recipientsError } = await db
    .from("profiles")
    .select("telegram_chat_id")
    .eq("tenant_id", trip.tenant_id)
    .eq("active", true)
    .in("role", targetRoles)
    .not("telegram_chat_id", "is", null);
  if (recipientsError) throw recipientsError;

  const chatIds = (recipients ?? []).map((p) => p.telegram_chat_id as number).filter((id) => id != null);

  let sent = 0;
  for (const chatId of chatIds) {
    try {
      await sendText(chatId, body.message);
      sent++;
    } catch (error) {
      console.error(`No se pudo enviar la alerta "${body.alert_type}" a ${chatId}:`, error);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, alert_type: body.alert_type, recipients: chatIds.length, sent }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
