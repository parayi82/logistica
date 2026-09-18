import { verifyMetaSignature } from "../_shared/meta.ts";
import type { WhatsAppWebhookPayload } from "../_shared/whatsappTypes.ts";
import { processPayload } from "./conversation.ts";

Deno.serve((req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    return handleVerification(url);
  }

  if (req.method === "POST") {
    return handleIncoming(req);
  }

  return new Response("Method Not Allowed", { status: 405 });
});

function handleVerification(url: URL): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expectedToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN");

  if (mode === "subscribe" && expectedToken && token === expectedToken) {
    return new Response(challenge ?? "", { status: 200 });
  }

  console.error("Verificación de webhook fallida", { mode, tokenPresente: Boolean(token) });
  return new Response("Forbidden", { status: 403 });
}

async function handleIncoming(req: Request): Promise<Response> {
  const rawBody = await req.text();

  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (appSecret) {
    const signature = req.headers.get("x-hub-signature-256");
    const valid = await verifyMetaSignature(rawBody, signature, appSecret);
    if (!valid) {
      console.error("Firma X-Hub-Signature-256 inválida; se rechaza la petición.");
      return new Response("Invalid signature", { status: 401 });
    }
  } else {
    console.warn(
      "WHATSAPP_APP_SECRET no configurado: se omite la verificación de firma (solo aceptable en desarrollo)."
    );
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Meta espera una respuesta rápida y reintenta si tarda o falla; el
  // procesamiento real corre en segundo plano vía EdgeRuntime.waitUntil.
  const work = processPayload(payload).catch((error) => {
    console.error("Error procesando el webhook de WhatsApp:", error);
  });

  const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
    .EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(work);
  } else {
    await work;
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}
