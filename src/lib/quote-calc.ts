/**
 * Deterministic quotation arithmetic in integer minor units (paise). Used by the server
 * as the source of truth and by the UI for a live preview. Percentages are basis points
 * (1800 = 18%). Rounding is half-up to the nearest minor unit.
 */
export type QuoteLine = { quantity: number; unitPriceMinor: number };
export type QuoteInput = {
  items: QuoteLine[];
  discountType: "none" | "percent" | "fixed";
  discountValue: number;
  taxRateBps: number;
  depositType: "percent" | "fixed";
  depositValue: number;
  milestones?: { label: string; amountMinor: number }[];
};
export type QuoteTotals = {
  lineTotals: number[];
  subtotalMinor: number;
  discountMinor: number;
  taxableMinor: number;
  taxMinor: number;
  totalMinor: number;
  depositMinor: number;
  milestonesTotalMinor: number;
  problems: string[];
};

const roundHalfUp = (n: number) => Math.floor(n + 0.5);

export function computeQuote(input: QuoteInput): QuoteTotals {
  const problems: string[] = [];
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) problems.push("Quantities must be whole numbers of at least 1.");
    if (!Number.isInteger(item.unitPriceMinor) || item.unitPriceMinor < 0) problems.push("Prices must be zero or more.");
  }
  const lineTotals = input.items.map((i) => i.quantity * i.unitPriceMinor);
  const subtotalMinor = lineTotals.reduce((a, b) => a + b, 0);

  let discountMinor = 0;
  if (input.discountType === "percent") {
    if (input.discountValue < 0 || input.discountValue > 10000) problems.push("Discount percentage must be between 0% and 100%.");
    discountMinor = roundHalfUp((subtotalMinor * Math.min(Math.max(input.discountValue, 0), 10000)) / 10000);
  } else if (input.discountType === "fixed") {
    if (input.discountValue < 0) problems.push("Discount cannot be negative.");
    if (input.discountValue > subtotalMinor) problems.push("Discount cannot exceed the subtotal.");
    discountMinor = Math.min(Math.max(input.discountValue, 0), subtotalMinor);
  }
  const taxableMinor = subtotalMinor - discountMinor;
  if (input.taxRateBps < 0 || input.taxRateBps > 5000) problems.push("Tax rate must be between 0% and 50%.");
  const taxMinor = roundHalfUp((taxableMinor * Math.min(Math.max(input.taxRateBps, 0), 5000)) / 10000);
  const totalMinor = taxableMinor + taxMinor;

  let depositMinor: number;
  if (input.depositType === "percent") {
    if (input.depositValue < 0 || input.depositValue > 10000) problems.push("Deposit percentage must be between 0% and 100%.");
    depositMinor = roundHalfUp((totalMinor * Math.min(Math.max(input.depositValue, 0), 10000)) / 10000);
  } else {
    if (input.depositValue > totalMinor) problems.push("Deposit cannot exceed the total.");
    depositMinor = Math.min(Math.max(input.depositValue, 0), totalMinor);
  }

  const milestonesTotalMinor = (input.milestones ?? []).reduce((a, m) => a + m.amountMinor, 0);
  if ((input.milestones ?? []).length > 0 && milestonesTotalMinor !== totalMinor) {
    problems.push("Payment milestones must add up to the total.");
  }
  return { lineTotals, subtotalMinor, discountMinor, taxableMinor, taxMinor, totalMinor, depositMinor, milestonesTotalMinor, problems: [...new Set(problems)] };
}
