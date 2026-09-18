/**
 * Verifica la firma X-Hub-Signature-256 que Meta agrega a cada webhook,
 * calculada como HMAC-SHA256(app secret, cuerpo crudo de la petición).
 * Debe calcularse sobre el body SIN parsear (antes de JSON.parse).
 */
export async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expectedHex = signatureHeader.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computedHex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(computedHex, expectedHex);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * El campo "from" de un mensaje entrante viene sin "+" (ej. "5215500000001").
 * Genera variantes candidatas de E.164 para hacer match contra
 * operators.phone_e164, incluyendo el caso típico de México donde WhatsApp
 * antepone un "1" después del código de país (521XXXXXXXXXX) que no
 * siempre coincide con cómo se registró el número (52XXXXXXXXXX).
 */
export function candidatePhoneVariants(waId: string): string[] {
  const digits = waId.replace(/[^\d]/g, "");
  const variants = new Set<string>([`+${digits}`]);

  if (digits.startsWith("521") && digits.length === 13) {
    variants.add(`+52${digits.slice(3)}`);
  }
  if (digits.startsWith("52") && !digits.startsWith("521") && digits.length === 12) {
    variants.add(`+521${digits.slice(2)}`);
  }

  return Array.from(variants);
}
