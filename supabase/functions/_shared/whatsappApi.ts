const GRAPH_VERSION = "v20.0";

function graphUrl(path: string): string {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${path}`;
}

function accessToken(): string {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (!token) throw new Error("Falta WHATSAPP_ACCESS_TOKEN en el entorno de la función.");
  return token;
}

function phoneNumberId(): string {
  const id = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!id) throw new Error("Falta WHATSAPP_PHONE_NUMBER_ID en el entorno de la función.");
  return id;
}

async function callMessagesApi(body: Record<string, unknown>): Promise<void> {
  const response = await fetch(graphUrl(`${phoneNumberId()}/messages`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("WhatsApp API error:", response.status, errorBody);
  }
}

export function sendText(to: string, body: string): Promise<void> {
  return callMessagesApi({
    to,
    type: "text",
    text: { body },
  });
}

/**
 * Menú principal guiado por lista (>3 opciones no caben en botones):
 * En tránsito / Detención / Reinicio / Enviar evidencia / Compartir ubicación.
 */
export function sendMainMenu(to: string, tripSummary: string): Promise<void> {
  return callMessagesApi({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: tripSummary },
      action: {
        button: "Reportar",
        sections: [
          {
            title: "Reportar estatus",
            rows: [
              { id: "EN_TRANSITO", title: "🚚 En tránsito", description: "Reinicié la marcha" },
              { id: "DETENCION", title: "🛑 Detención", description: "Me detuve" },
              { id: "REINICIO", title: "▶️ Reinicio", description: "Retomo tras una parada" },
              { id: "EVIDENCIA", title: "📷 Enviar evidencia", description: "Adjuntar una foto" },
              { id: "UBICACION", title: "📍 Compartir ubicación", description: "Enviar mi posición actual" },
            ],
          },
        ],
      },
    },
  });
}

export function sendLocationRequest(to: string, bodyText: string): Promise<void> {
  return callMessagesApi({
    to,
    type: "interactive",
    interactive: {
      type: "location_request_message",
      body: { text: bodyText },
      action: { name: "send_location" },
    },
  });
}

/**
 * Descarga un medio (foto) de WhatsApp: primero se resuelve la URL temporal
 * del medio, luego se descarga el binario, ambas peticiones autenticadas
 * con el mismo access token.
 */
export async function downloadWhatsAppMedia(
  mediaId: string
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const metaResponse = await fetch(graphUrl(mediaId), {
    headers: { Authorization: `Bearer ${accessToken()}` },
  });
  if (!metaResponse.ok) {
    throw new Error(`No se pudo resolver el medio ${mediaId}: ${metaResponse.status}`);
  }
  const meta = (await metaResponse.json()) as { url: string; mime_type: string };

  const fileResponse = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${accessToken()}` },
  });
  if (!fileResponse.ok) {
    throw new Error(`No se pudo descargar el medio ${mediaId}: ${fileResponse.status}`);
  }

  return {
    bytes: new Uint8Array(await fileResponse.arrayBuffer()),
    mimeType: meta.mime_type,
  };
}

/**
 * Sube un archivo (ej. el PDF del reporte de turno) al servidor de medios
 * de WhatsApp y devuelve el media_id para usarlo en un mensaje "document".
 */
export async function uploadWhatsAppMedia(
  bytes: Uint8Array,
  mimeType: string,
  filename: string
): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([bytes], { type: mimeType }), filename);
  form.append("type", mimeType);

  const response = await fetch(graphUrl(`${phoneNumberId()}/media`), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken()}` },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`No se pudo subir el medio a WhatsApp: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { id: string };
  return data.id;
}

export function sendDocument(to: string, mediaId: string, filename: string, caption?: string): Promise<void> {
  return callMessagesApi({
    to,
    type: "document",
    document: { id: mediaId, filename, caption },
  });
}
