/**
 * Genera variantes candidatas de E.164 para hacer match contra
 * operators.phone_e164, incluyendo el caso típico de México donde el
 * número de WhatsApp/Telegram antepone un "1" después del código de país
 * (521XXXXXXXXXX) que no siempre coincide con cómo se registró el número
 * (52XXXXXXXXXX).
 */
export function candidatePhoneVariants(rawPhone: string): string[] {
  const digits = rawPhone.replace(/[^\d]/g, "");
  const variants = new Set<string>([`+${digits}`]);

  if (digits.startsWith("521") && digits.length === 13) {
    variants.add(`+52${digits.slice(3)}`);
  }
  if (digits.startsWith("52") && !digits.startsWith("521") && digits.length === 12) {
    variants.add(`+521${digits.slice(2)}`);
  }

  return Array.from(variants);
}
