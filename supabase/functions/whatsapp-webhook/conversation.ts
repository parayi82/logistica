import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { candidatePhoneVariants } from "../_shared/meta.ts";
import {
  downloadWhatsAppMedia,
  sendLocationRequest,
  sendMainMenu,
  sendText,
} from "../_shared/whatsappApi.ts";
import type { WhatsAppMessage, WhatsAppWebhookPayload } from "../_shared/whatsappTypes.ts";

const ACTIVE_TRIP_STATUSES = ["PROGRAMADO", "EN_TRANSITO", "DETENIDO"];

type Db = ReturnType<typeof supabaseAdmin>;

export async function processPayload(payload: WhatsAppWebhookPayload): Promise<void> {
  const db = supabaseAdmin();
  const messages =
    payload.entry?.flatMap((entry) => entry.changes.flatMap((change) => change.value.messages ?? [])) ?? [];

  for (const message of messages) {
    try {
      await handleMessage(db, message);
    } catch (error) {
      console.error(`Error procesando mensaje ${message.id} de ${message.from}:`, error);
    }
  }
}

async function handleMessage(db: Db, message: WhatsAppMessage): Promise<void> {
  const isNew = await recordInboundMessage(db, message);
  if (!isNew) {
    console.log(`Mensaje ${message.id} ya procesado, se ignora (reintento de Meta).`);
    return;
  }

  const operator = await findOperatorByPhone(db, message.from);
  if (!operator) {
    await sendText(
      message.from,
      "No reconocemos tu número en el sistema. Contacta a tu despachador para darte de alta."
    );
    return;
  }

  const contact = await upsertWhatsAppContact(db, operator.tenant_id, message.from, operator.id);
  await db
    .from("whatsapp_inbound_messages")
    .update({ tenant_id: operator.tenant_id, contact_id: contact.id })
    .eq("wamid", message.id);

  const state = await getConversationState(db, contact.id, operator.tenant_id);
  const activeTrip = await findActiveTrip(db, operator.id);

  switch (state.current_step) {
    case "ESPERANDO_FOTO":
      await handleEvidenceStep(db, message, contact.id, operator.id, state.context as { tripId?: string });
      return;
    case "ESPERANDO_UBICACION":
      await handleLocationStep(db, message, contact.id, operator.id, state.context as { tripId?: string });
      return;
    default:
      await handleMenuStep(db, message, contact.id, operator, activeTrip);
      return;
  }
}

// ---------------------------------------------------------------------
// Deduplicación e identificación
// ---------------------------------------------------------------------

async function recordInboundMessage(db: Db, message: WhatsAppMessage): Promise<boolean> {
  const { error } = await db.from("whatsapp_inbound_messages").insert({
    wamid: message.id,
    message_type: message.type,
    raw_payload: message,
  });

  if (!error) return true;
  if (error.code === "23505") return false; // ya existe: reintento de Meta
  console.error("No se pudo registrar el mensaje entrante (se continúa de todos modos):", error);
  return true;
}

async function findOperatorByPhone(db: Db, waId: string) {
  const variants = candidatePhoneVariants(waId);
  const { data, error } = await db
    .from("operators")
    .select("id, tenant_id, full_name, phone_e164")
    .in("phone_e164", variants)
    .eq("active", true)
    .limit(2);

  if (error) throw error;
  if (!data || data.length === 0) return null;
  if (data.length > 1) {
    console.warn(`El número ${waId} coincide con más de un operador; se usa el primero.`, data);
  }
  return data[0];
}

async function upsertWhatsAppContact(db: Db, tenantId: string, waId: string, operatorId: string) {
  const phone = `+${waId.replace(/[^\d]/g, "")}`;
  const { data, error } = await db
    .from("whatsapp_contacts")
    .upsert(
      {
        tenant_id: tenantId,
        phone_e164: phone,
        operator_id: operatorId,
        last_interaction_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,phone_e164" }
    )
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

interface ConversationState {
  id: string;
  contact_id: string;
  current_step: string;
  context: Record<string, unknown>;
}

async function getConversationState(
  db: Db,
  contactId: string,
  tenantId: string
): Promise<ConversationState> {
  const { data, error } = await db
    .from("whatsapp_conversation_state")
    .select("*")
    .eq("contact_id", contactId)
    .maybeSingle();

  if (error) throw error;
  if (data) return data as ConversationState;

  const { data: created, error: createError } = await db
    .from("whatsapp_conversation_state")
    .insert({ tenant_id: tenantId, contact_id: contactId })
    .select("*")
    .single();

  if (createError) throw createError;
  return created as ConversationState;
}

async function setConversationStep(
  db: Db,
  contactId: string,
  step: string,
  context: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await db
    .from("whatsapp_conversation_state")
    .update({ current_step: step, context, updated_at: new Date().toISOString() })
    .eq("contact_id", contactId);
  if (error) throw error;
}

interface ActiveTrip {
  id: string;
  route_name: string;
  origin: string;
  destination: string;
  status: string;
}

async function findActiveTrip(db: Db, operatorId: string): Promise<ActiveTrip | null> {
  const { data, error } = await db
    .from("trips")
    .select("id, route_name, origin, destination, status")
    .eq("operator_id", operatorId)
    .in("status", ACTIVE_TRIP_STATUSES)
    .order("current_status_since", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as ActiveTrip | null) ?? null;
}

// ---------------------------------------------------------------------
// Pasos de la máquina de estados
// ---------------------------------------------------------------------

async function handleMenuStep(
  db: Db,
  message: WhatsAppMessage,
  contactId: string,
  operator: { id: string; full_name: string },
  activeTrip: ActiveTrip | null
): Promise<void> {
  const selection = message.interactive?.list_reply?.id ?? message.interactive?.button_reply?.id;

  if (selection) {
    if (!activeTrip) {
      await sendText(message.from, "No tienes un viaje activo asignado en este momento.");
      return;
    }
    await handleMenuSelection(db, message, selection, contactId, operator.id, activeTrip);
    return;
  }

  if (!activeTrip) {
    await sendText(
      message.from,
      `Hola ${operator.full_name}, no tienes un viaje activo asignado en este momento.`
    );
    return;
  }

  const summary =
    `Hola ${operator.full_name} 👋\n` +
    `Viaje activo: ${activeTrip.route_name} (${activeTrip.origin} → ${activeTrip.destination})\n` +
    `Estatus actual: ${activeTrip.status}\n\n` +
    `¿Qué deseas reportar?`;
  await sendMainMenu(message.from, summary);
}

async function handleMenuSelection(
  db: Db,
  message: WhatsAppMessage,
  selection: string,
  contactId: string,
  operatorId: string,
  activeTrip: ActiveTrip
): Promise<void> {
  const from = message.from;
  switch (selection) {
    case "EN_TRANSITO":
    case "DETENCION":
    case "REINICIO": {
      const { error } = await db.rpc("record_trip_event", {
        p_trip_id: activeTrip.id,
        p_event_type: selection,
        p_operator_id: operatorId,
        p_reported_via: "whatsapp",
        p_raw_payload: message,
      });
      if (error) throw error;
      await sendText(from, `✅ Registrado: ${selection.replace("_", " ")} — ${new Date().toLocaleString("es-MX")}`);
      return;
    }
    case "EVIDENCIA":
      await setConversationStep(db, contactId, "ESPERANDO_FOTO", { tripId: activeTrip.id });
      await sendText(from, "Envía la foto de evidencia ahora 📷");
      return;
    case "UBICACION":
      await setConversationStep(db, contactId, "ESPERANDO_UBICACION", { tripId: activeTrip.id });
      await sendLocationRequest(from, "Comparte tu ubicación actual 📍");
      return;
    default:
      await sendText(from, "No reconocí esa opción, escribe cualquier mensaje para ver el menú de nuevo.");
  }
}

async function handleEvidenceStep(
  db: Db,
  message: WhatsAppMessage,
  contactId: string,
  operatorId: string,
  context: { tripId?: string }
): Promise<void> {
  if (message.type !== "image" || !message.image) {
    await sendText(message.from, "Por favor envía una foto para registrar la evidencia 📷");
    return;
  }
  if (!context.tripId) {
    await setConversationStep(db, contactId, "MENU_PRINCIPAL");
    await sendText(message.from, "No encontré el viaje asociado a esta evidencia, intenta de nuevo desde el menú.");
    return;
  }

  const { bytes, mimeType } = await downloadWhatsAppMedia(message.image.id);
  const extension = mimeType.includes("png") ? "png" : "jpg";

  const { data: trip, error: tripError } = await db
    .from("trips")
    .select("tenant_id")
    .eq("id", context.tripId)
    .single();
  if (tripError) throw tripError;

  const storagePath = `${trip.tenant_id}/${context.tripId}/${Date.now()}.${extension}`;
  const { error: uploadError } = await db.storage
    .from("trip-evidence")
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (uploadError) throw uploadError;

  const { data: event, error: eventError } = await db.rpc("record_trip_event", {
    p_trip_id: context.tripId,
    p_event_type: "EVIDENCIA",
    p_operator_id: operatorId,
    p_reported_via: "whatsapp",
    p_raw_payload: message,
  });
  if (eventError) throw eventError;

  const { error: evidenceError } = await db.from("trip_evidence").insert({
    tenant_id: trip.tenant_id,
    trip_id: context.tripId,
    trip_event_id: (event as { id: string }).id,
    evidence_type: "FOTO",
    storage_path: storagePath,
  });
  if (evidenceError) throw evidenceError;

  await setConversationStep(db, contactId, "MENU_PRINCIPAL");
  await sendText(message.from, "✅ Evidencia recibida, gracias.");
}

async function handleLocationStep(
  db: Db,
  message: WhatsAppMessage,
  contactId: string,
  operatorId: string,
  context: { tripId?: string }
): Promise<void> {
  if (message.type !== "location" || !message.location) {
    await sendText(message.from, "Toca el clip 📎 y comparte tu ubicación actual para continuar.");
    return;
  }
  if (!context.tripId) {
    await setConversationStep(db, contactId, "MENU_PRINCIPAL");
    await sendText(message.from, "No encontré el viaje asociado, intenta de nuevo desde el menú.");
    return;
  }

  const { error } = await db.rpc("record_trip_event", {
    p_trip_id: context.tripId,
    p_event_type: "UBICACION",
    p_operator_id: operatorId,
    p_reported_via: "whatsapp",
    p_lat: message.location.latitude,
    p_lng: message.location.longitude,
    p_raw_payload: message,
  });
  if (error) throw error;

  await setConversationStep(db, contactId, "MENU_PRINCIPAL");
  await sendText(
    message.from,
    `✅ Ubicación recibida (${message.location.latitude.toFixed(5)}, ${message.location.longitude.toFixed(5)}). ` +
      "La validación contra el parador autorizado se hará próximamente."
  );
}
