/**
 * Приводит номер к виду +998XXXXXXXXX. Принимает то, как люди обычно пишут:
 * "+998 90 123-45-67", "998901234567", "90 123 45 67". Возвращает null, если это не узбекский номер.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, "").replace(/^\+/, "");
  if (!/^\d+$/.test(digits)) return null;
  const full = digits.length === 9 ? `998${digits}` : digits;
  return /^998\d{9}$/.test(full) ? `+${full}` : null;
}
