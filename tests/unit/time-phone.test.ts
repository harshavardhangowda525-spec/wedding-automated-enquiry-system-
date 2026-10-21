import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/phone";
import { addBusinessDays, isWithinBusinessHours, nextBusinessMoment, zonedInstant } from "@/lib/time";
import { canTransition } from "@/lib/domain";

const hours = { days: [1, 2, 3, 4, 5, 6], start: "10:00", end: "19:00" };
const tz = "Asia/Kolkata";

describe("business time in Asia/Kolkata", () => {
  it("adds business days skipping Sundays", () => {
    const sat = zonedInstant("2026-10-24", "15:00", tz); // Saturday
    expect(addBusinessDays(sat, 1, tz, hours).toISOString()).toBe(zonedInstant("2026-10-26", "15:00", tz).toISOString()); // Monday
  });
  it("moves after-hours moments to the next opening", () => {
    const late = zonedInstant("2026-10-23", "21:30", tz); // Friday night
    expect(nextBusinessMoment(late, tz, hours).toISOString()).toBe(zonedInstant("2026-10-24", "10:00", tz).toISOString());
    const sunday = zonedInstant("2026-10-25", "11:00", tz);
    expect(isWithinBusinessHours(sunday, tz, hours)).toBe(false);
    expect(nextBusinessMoment(sunday, tz, hours).toISOString()).toBe(zonedInstant("2026-10-26", "10:00", tz).toISOString());
    const inside = zonedInstant("2026-10-26", "12:00", tz);
    expect(nextBusinessMoment(inside, tz, hours).toISOString()).toBe(inside.toISOString());
  });
});

describe("phone normalisation", () => {
  it("normalises Indian numbers to E.164", () => {
    expect(normalizePhone("+91", "98765 43210")).toBe("+919876543210");
    expect(normalizePhone("+91", "098765-43210")).toBe("+919876543210");
    expect(normalizePhone("+91", "+91 98765 43210")).toBe("+919876543210");
    expect(normalizePhone("+91", "123")).toBeNull();
  });
});

describe("lead stage transitions", () => {
  it("validates transitions", () => {
    expect(canTransition("new_enquiry", "contacted")).toBe(true);
    expect(canTransition("new_enquiry", "booking_confirmed")).toBe(false);
    expect(canTransition("tentative_hold", "booking_confirmed")).toBe(true);
    expect(canTransition("won", "lost")).toBe(false);
    expect(canTransition("lost", "new_enquiry")).toBe(true);
  });
});
