/** Formats minor units (e.g. paise) as currency. */
export function formatMoney(minor: number | null | undefined, currency = "INR"): string {
  if (minor === null || minor === undefined) return "—";
  const locale = currency === "INR" ? "en-IN" : "en";
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
}

/** Parses a user-entered major-unit amount ("1,50,000.50") into minor units. */
export function parseMoneyToMinor(value: string): number | null {
  const cleaned = value.replace(/[,\s₹$]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function minorToInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "";
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}
