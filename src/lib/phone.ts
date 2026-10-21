/** Normalises a phone number to E.164 (+<country><number>). Returns null when invalid. */
export function normalizePhone(countryCode: string, number: string): string | null {
  const cc = countryCode.replace(/[^\d]/g, "");
  let digits = number.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    digits = digits.slice(1).replace(/\D/g, "");
    return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
  }
  digits = digits.replace(/\D/g, "").replace(/^0+/, "");
  if (!cc || !/^\d{1,4}$/.test(cc)) return null;
  // Number already includes the country code (e.g. "919876543210").
  const full = digits.startsWith(cc) && digits.length > 10 ? digits : `${cc}${digits}`;
  return /^\d{8,15}$/.test(full) ? `+${full}` : null;
}

export const COUNTRY_CODES = [
  { code: "+91", label: "India (+91)" },
  { code: "+971", label: "UAE (+971)" },
  { code: "+1", label: "USA / Canada (+1)" },
  { code: "+44", label: "UK (+44)" },
  { code: "+61", label: "Australia (+61)" },
  { code: "+65", label: "Singapore (+65)" },
  { code: "+974", label: "Qatar (+974)" },
  { code: "+966", label: "Saudi Arabia (+966)" },
  { code: "+94", label: "Sri Lanka (+94)" },
  { code: "+977", label: "Nepal (+977)" },
] as const;
