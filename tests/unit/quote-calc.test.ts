import { describe, expect, it } from "vitest";
import { computeQuote } from "@/lib/quote-calc";

describe("quotation calculations", () => {
  it("computes subtotal, percent discount, tax, total and deposit in paise", () => {
    const t = computeQuote({
      items: [
        { quantity: 2, unitPriceMinor: 4_500_000 }, // 2 × ₹45,000
        { quantity: 1, unitPriceMinor: 12_000_000 }, // ₹1,20,000
      ],
      discountType: "percent",
      discountValue: 1000, // 10%
      taxRateBps: 1800,
      depositType: "percent",
      depositValue: 3000,
    });
    expect(t.subtotalMinor).toBe(21_000_000);
    expect(t.discountMinor).toBe(2_100_000);
    expect(t.taxMinor).toBe(3_402_000);
    expect(t.totalMinor).toBe(22_302_000);
    expect(t.depositMinor).toBe(6_690_600);
    expect(t.problems).toEqual([]);
  });

  it("rounds half up to the nearest paisa", () => {
    const t = computeQuote({ items: [{ quantity: 1, unitPriceMinor: 333 }], discountType: "none", discountValue: 0, taxRateBps: 1800, depositType: "fixed", depositValue: 0 });
    expect(t.taxMinor).toBe(60); // 59.94 → 60
    expect(t.totalMinor).toBe(393);
  });

  it("caps fixed discounts and flags invalid input", () => {
    const t = computeQuote({ items: [{ quantity: 1, unitPriceMinor: 1000 }], discountType: "fixed", discountValue: 5000, taxRateBps: 0, depositType: "fixed", depositValue: 0 });
    expect(t.discountMinor).toBe(1000);
    expect(t.problems).toContain("Discount cannot exceed the subtotal.");
    const bad = computeQuote({ items: [{ quantity: 0, unitPriceMinor: -1 }], discountType: "none", discountValue: 0, taxRateBps: 0, depositType: "fixed", depositValue: 0 });
    expect(bad.problems.length).toBeGreaterThan(0);
  });

  it("requires milestones to add up to the total", () => {
    const base = { items: [{ quantity: 1, unitPriceMinor: 10_000 }], discountType: "none" as const, discountValue: 0, taxRateBps: 0, depositType: "fixed" as const, depositValue: 3000 };
    expect(computeQuote({ ...base, milestones: [{ label: "Advance", amountMinor: 3000 }, { label: "Balance", amountMinor: 7000 }] }).problems).toEqual([]);
    expect(computeQuote({ ...base, milestones: [{ label: "Advance", amountMinor: 3000 }] }).problems).toContain("Payment milestones must add up to the total.");
  });
});
