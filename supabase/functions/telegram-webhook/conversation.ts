import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { candidatePhoneVariants } from "../_shared/phone.ts";
import {
  answerCallbackQuery,
  downloadTelegramFile,
  requestLocation,
  requestPhoneNumber,
  sendMainMenu,
  sendText,
} from "../_shared/telegramApi.ts";
import type { TelegramMessage, TelegramUpdate } from "../_shared/telegramTypes.ts";

const ACTIVE_TRIP_STATUSES = ["PROGRAMADO", "EN_TRANSITO", "DETENIDO"];

type Db = ReturnType<typeof supabaseAdmin>;

interface TelegramContactRow {
  id: string;
  tenant_id: string | null;
  telegram_user_id: number;
  operator_id: string | null;
}

export async function processUpdate(update: TelegramUpdate): Promise<void> {
  const db = supabaseAdmin();
  try {
    await handleUpdate(db, update);
  } catch (error) {
    console.error(`Error procesando update ${update.update_id}:`, error);
  }
}

async function handleUpdate(db: Db, update: TelegramUpdate): Promise<void> {
  const isNew = await recordInboundUpdate(db, update);
  if (!isNew) {
    console.log(`Update ${update.update_id} ya procesado, se ignora.`);
    return;
  }

  const message = update.message;
  const callback = update.callback_query;
  const chatId = message?.chat.id ?? callback?.message?.chat.id;
  const fromUserId = message?.from.id ?? callback?.from.id;
  if (!chatId || !fromUserId) return;

  const contact = await upsertContact(db, fromUserId);
  await db
    .from("telegram_inbound_messages")
    .update({ tenant_id: contact.tenant_id, contact_id: contact.id })
    .eq("update_id", update.update_id);
  await db
    .from("telegram_contacts")
    .update({ last_interaction_at: new Date().toISOString() })
    .eq("id", contact.id);

  if (message?.text === "/start") {
    await sendText(
      chatId,
      `Hola 👋 Tu chat_id de Telegram es: ${fromUserId}\n\n` +
        "Si eres JEFATURA o SEGURIDAD PATRIMONIAL, comparte este número con tu administrador para recibir el reporte de turno automático."
    );
    if (!contact.operator_id) {
      await requestPhoneNumber(chatId, "Si eres operador, comparte tu teléfono para identificarte:");
    }
    return;
  }

  if (!contact.operator_id) {
    if (message?.contact) {
      await handlePhoneShare(db, contact, message.contact, chatId);
    } else {
      await requestPhoneNumber(chatId, "No te tengo identificado todavía. Comparte tu teléfono para continuar:");
    }
    return;
  }

  const state = await getConversationState(db, contact);
  const activeTrip = await findActiveTrip(db, contact.operator_id);

  switch (state.current_step) {
    case "ESPERANDO_FOTO":
      await handleEvidenceStep(db, message, contact, state.context as { tripId?: string }, chatId);
      return;
    case "ESPERANDO_UBICACION":
      await handleLocationStep(db, message, contact, state.context as { tripId?: string }, chatId);
      return;
    default:
      await handleMenuStep(db, message, callback, contact, activeTrip, chatId);
  }
}

// ---------------------------------------------------------------------
// Deduplicación e identificación
// ---------------------------------------------------------------------

async function recordInboundUpdate(db: Db, update: TelegramUpdate): Promise<boolean> {
  const messageType = update.callback_query
    ? "callback_query"
    : update.message?.photo
      ? "photo"
      : update.message?.location
        ? "location"
        : update.message?.contact
          ? "contact"
          : "text";

  const { error } = await db.from("telegram_inbound_messages").insert({
    update_id: update.update_id,
    message_type: messageType,
    raw_payload: update,
  });

  if (!error) return true;
  if (error.code === "23505") return false; // ya existe: reintento
  console.error("No se pudo registrar el update entrante (se continúa de todos modos):", error);
  return true;
}

async function upsertContact(db: Db, telegramUserId: number): Promise<TelegramContactRow> {
  const { data: existing } = await db
    .from("telegram_contacts")
    .select("id, tenant_id, telegram_user_id, operator_id")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (existing) return existing as TelegramContactRow;

  const { data: created, error } = await db
    .from("telegram_contacts")
    .insert({ telegram_user_id: telegramUserId })
    .select("id, tenant_id, telegram_user_id, operator_id")
    .single();
  if (error) throw error;
  return created as TelegramContactRow;
}

async function handlePhoneShare(
  db: Db,
  contact: TelegramContactRow,
  sharedContact: NonNullable<TelegramMessage["contact"]>,
  chatId: number
): Promise<void> {
  const variants = candidatePhoneVariants(sharedContact.phone_number);
  const { data: operators, error } = await db
    .from("operators")
    .select("id, tenant_id, full_name")
    .in("phone_e164", variants)
    .eq("active", true)
    .limit(2);
  if (error) throw error;

  if (!operators || operators.length === 0) {
    await sendText(chatId, "No reconocemos tu número en el sistema. Contacta a tu despachador para darte de alta.");
    return;
  }
  if (operators.length > 1) {
    console.warn(`El teléfono ${sharedContact.phone_number} coincide con más de un operador; se usa el primero.`);
  }
  const operator = operators[0];

  const normalizedPhone = variants[0];
  const { error: updateError } = await db
    .from("telegram_contacts")
    .update({ tenant_id: operator.tenant_id, operator_id: operator.id, phone_e164: normalizedPhone })
    .eq("id", contact.id);
  if (updateError) throw updateError;

  await sendText(chatId, `✅ Identificado como ${operator.full_name}. Escribe cualquier mensaje para ver tu menú.`);
}

interface ConversationState {
  current_step: string;
  context: Record<string, unknown>;
}

async function getConversationState(db: Db, contact: TelegramContactRow): Promise<ConversationState> {
  const { data, error } = await db
    .from("telegram_conversation_state")
    .select("current_step, context")
    .eq("contact_id", contact.id)
    .maybeSingle();
  if (error) throw error;
  if (data) return data as ConversationState;

  const { data: created, error: createError } = await db
    .from("telegram_conversation_state")
    .insert({ tenant_id: contact.tenant_id, contact_id: contact.id })
    .select("current_step, context")
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
    .from("telegram_conversation_state")
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
  message: TelegramMessage | undefined,
  callback: TelegramUpdate["callback_query"],
  contact: TelegramContactRow,
  activeTrip: ActiveTrip | null,
  chatId: number
): Promise<void> {
  if (callback?.data) {
    await answerCallbackQuery(callback.id);
    if (!activeTrip) {
      await sendText(chatId, "No tienes un viaje activo asignado en este momento.");
      return;
    }
    await handleMenuSelection(db, chatId, callback.data, contact, activeTrip, callback);
    return;
  }

  if (!activeTrip) {
    await sendText(chatId, "No tienes un viaje activo asignado en este momento.");
    return;
  }

  const summary =
    `Viaje activo: ${activeTrip.route_name} (${activeTrip.origin} → ${activeTrip.destination})\n` +
    `Estatus actual: ${activeTrip.status}\n\n¿Qué deseas reportar?`;
  await sendMainMenu(chatId, summary);
  void message;
}

async function handleMenuSelection(
  db: Db,
  chatId: number,
  selection: string,
  contact: TelegramContactRow,
  activeTrip: ActiveTrip,
  rawPayload: unknown
): Promise<void> {
  switch (selection) {
    case "EN_TRANSITO":
    case "DETENCION":
    case "REINICIO": {
      const { error } = await db.rpc("record_trip_event", {
        p_trip_id: activeTrip.id,
        p_event_type: selection,
        p_operator_id: contact.operator_id,
        p_reported_via: "telegram",
        p_raw_payload: rawPayload,
      });
      if (error) throw error;
      await sendText(chatId, `✅ Registrado: ${selection.replace("_", " ")} — ${new Date().toLocaleString("es-MX")}`);
      return;
    }
    case "EVIDENCIA":
      await setConversationStep(db, contact.id, "ESPERANDO_FOTO", { tripId: activeTrip.id });
      await sendText(chatId, "Envía la foto de evidencia ahora 📷");
      return;
    case "UBICACION":
      await setConversationStep(db, contact.id, "ESPERANDO_UBICACION", { tripId: activeTrip.id });
      await requestLocation(chatId, "Comparte tu ubicación actual 📍");
      return;
    default:
      await sendText(chatId, "No reconocí esa opción, escribe cualquier mensaje para ver el menú de nuevo.");
  }
}

async function handleEvidenceStep(
  db: Db,
  message: TelegramMessage | undefined,
  contact: TelegramContactRow,
  context: { tripId?: string },
  chatId: number
): Promise<void> {
  const photo = message?.photo?.at(-1);
  if (!photo) {
    await sendText(chatId, "Por favor envía una foto para registrar la evidencia 📷");
    return;
  }
  if (!context.tripId) {
    await setConversationStep(db, contact.id, "MENU_PRINCIPAL");
    await sendText(chatId, "No encontré el viaje asociado a esta evidencia, intenta de nuevo desde el menú.");
    return;
  }

  const { bytes, mimeType } = await downloadTelegramFile(photo.file_id);
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
    p_operator_id: contact.operator_id,
    p_reported_via: "telegram",
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

  await setConversationStep(db, contact.id, "MENU_PRINCIPAL");
  await sendText(chatId, "✅ Evidencia recibida, gracias.");
}

async function handleLocationStep(
  db: Db,
  message: TelegramMessage | undefined,
  contact: TelegramContactRow,
  context: { tripId?: string },
  chatId: number
): Promise<void> {
  if (!message?.location) {
    await sendText(chatId, "Toca el botón para compartir tu ubicación actual para continuar.");
    return;
  }
  if (!context.tripId) {
    await setConversationStep(db, contact.id, "MENU_PRINCIPAL");
    await sendText(chatId, "No encontré el viaje asociado, intenta de nuevo desde el menú.");
    return;
  }

  const { error } = await db.rpc("record_trip_event", {
    p_trip_id: context.tripId,
    p_event_type: "UBICACION",
    p_operator_id: contact.operator_id,
    p_reported_via: "telegram",
    p_lat: message.location.latitude,
    p_lng: message.location.longitude,
    p_raw_payload: message,
  });
  if (error) throw error;

  await setConversationStep(db, contact.id, "MENU_PRINCIPAL");
  await sendText(
    chatId,
    `✅ Ubicación recibida (${message.location.latitude.toFixed(5)}, ${message.location.longitude.toFixed(5)}). ` +
      "La validación contra el parador autorizado ya se aplicó automáticamente."
  );
}
