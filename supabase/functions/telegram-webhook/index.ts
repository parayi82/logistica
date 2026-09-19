import type { TelegramUpdate } from "../_shared/telegramTypes.ts";
import { processUpdate } from "./conversation.ts";

Deno.serve((req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  return handleIncoming(req);
});

async function handleIncoming(req: Request): Promise<Response> {
  const expectedSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (expectedSecret) {
    const provided = req.headers.get("x-telegram-bot-api-secret-token");
    if (provided !== expectedSecret) {
      console.error("Secret token de Telegram inválido; se rechaza la petición.");
      return new Response("Invalid secret token", { status: 401 });
    }
  } else {
    console.warn(
      "TELEGRAM_WEBHOOK_SECRET no configurado: se omite la verificación (solo aceptable en desarrollo)."
    );
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Telegram espera una respuesta rápida (200) y reintenta si tarda o
  // falla; el procesamiento real corre en segundo plano.
  const work = processUpdate(update).catch((error) => {
    console.error("Error procesando el webhook de Telegram:", error);
  });

  const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
    .EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(work);
  } else {
    await work;
  }

  return new Response("OK", { status: 200 });
}
