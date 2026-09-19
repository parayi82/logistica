function botToken(): string {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Falta TELEGRAM_BOT_TOKEN en el entorno de la función.");
  return token;
}

function apiUrl(method: string): string {
  return `https://api.telegram.org/bot${botToken()}/${method}`;
}

async function callApi(method: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(apiUrl(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!data.ok) {
    console.error(`Telegram API error en ${method}:`, data);
  }
  return data;
}

export function sendText(chatId: number, text: string): Promise<unknown> {
  return callApi("sendMessage", { chat_id: chatId, text });
}

/**
 * Menú principal con lista de botones inline (equivalente al mensaje de
 * lista interactiva de WhatsApp): En tránsito / Detención / Reinicio /
 * Enviar evidencia / Compartir ubicación / Entrega (Fase 12, POD).
 */
export function sendMainMenu(chatId: number, bodyText: string): Promise<unknown> {
  return callApi("sendMessage", {
    chat_id: chatId,
    text: bodyText,
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚚 En tránsito", callback_data: "EN_TRANSITO" }],
        [{ text: "🛑 Detención", callback_data: "DETENCION" }],
        [{ text: "▶️ Reinicio", callback_data: "REINICIO" }],
        [{ text: "📷 Enviar evidencia", callback_data: "EVIDENCIA" }],
        [{ text: "📍 Compartir ubicación", callback_data: "UBICACION" }],
        [{ text: "🏁 Entrega / Finalizar viaje", callback_data: "ENTREGA" }],
      ],
    },
  });
}

export function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<unknown> {
  return callApi("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

/** Pregunta de una sola fila de botones (ej. Sí/No para "¿Apagaste el motor?"). */
export function sendInlineButtons(
  chatId: number,
  text: string,
  buttons: { text: string; callback_data: string }[]
): Promise<unknown> {
  return callApi("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: [buttons] },
  });
}

/** Botón nativo para que el operador comparta su teléfono (Telegram confirma que es el suyo). */
export function requestPhoneNumber(chatId: number, bodyText: string): Promise<unknown> {
  return callApi("sendMessage", {
    chat_id: chatId,
    text: bodyText,
    reply_markup: {
      keyboard: [[{ text: "📱 Compartir mi teléfono", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

/** Botón nativo para pedir la ubicación actual en vivo. */
export function requestLocation(chatId: number, bodyText: string): Promise<unknown> {
  return callApi("sendMessage", {
    chat_id: chatId,
    text: bodyText,
    reply_markup: {
      keyboard: [[{ text: "📍 Compartir mi ubicación", request_location: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

export function removeKeyboard(chatId: number, text: string): Promise<unknown> {
  return callApi("sendMessage", { chat_id: chatId, text, reply_markup: { remove_keyboard: true } });
}

/**
 * Descarga un archivo (foto) de Telegram: primero se resuelve el
 * file_path vía getFile, luego se descarga el binario.
 */
export async function downloadTelegramFile(fileId: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const metaResponse = await fetch(apiUrl(`getFile?file_id=${fileId}`));
  const meta = await metaResponse.json();
  if (!meta.ok) {
    throw new Error(`No se pudo resolver el archivo ${fileId}: ${JSON.stringify(meta)}`);
  }
  const filePath: string = meta.result.file_path;

  const fileResponse = await fetch(`https://api.telegram.org/file/bot${botToken()}/${filePath}`);
  if (!fileResponse.ok) {
    throw new Error(`No se pudo descargar el archivo ${fileId}: ${fileResponse.status}`);
  }

  const extension = filePath.split(".").pop()?.toLowerCase();
  const mimeType = extension === "png" ? "image/png" : "image/jpeg";

  return { bytes: new Uint8Array(await fileResponse.arrayBuffer()), mimeType };
}

/**
 * Envía un documento (el PDF del reporte de turno) directo desde bytes en
 * memoria: a diferencia de WhatsApp, Telegram no requiere un paso previo
 * de "subir medio" — todo va en una sola llamada multipart.
 */
export async function sendDocument(
  chatId: number,
  bytes: Uint8Array,
  filename: string,
  caption?: string
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([bytes], { type: "application/pdf" }), filename);
  if (caption) form.append("caption", caption);

  const response = await fetch(apiUrl("sendDocument"), { method: "POST", body: form });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`No se pudo enviar el documento a ${chatId}: ${JSON.stringify(data)}`);
  }
}
