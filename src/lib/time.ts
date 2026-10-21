import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

export type BusinessHours = { days: number[]; start: string; end: string };

function hm(value: string): [number, number] {
  const [h, m] = value.split(":").map(Number);
  return [h, m];
}

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function dateInTz(instant: Date, tz: string): string {
  return format(new TZDate(instant.getTime(), tz), "yyyy-MM-dd");
}

export function formatInTz(instant: Date | string, tz: string, pattern = "d MMM yyyy, h:mm a"): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return format(new TZDate(d.getTime(), tz), pattern);
}

/** Instant for a wall-clock date + time in a time zone. */
export function zonedInstant(date: string, timeHHMM: string, tz: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hm(timeHHMM);
  return new Date(new TZDate(y, mo - 1, d, h, mi, 0, tz).getTime());
}

export function isWithinBusinessHours(instant: Date, tz: string, hours: BusinessHours): boolean {
  const d = new TZDate(instant.getTime(), tz);
  if (!hours.days.includes(d.getDay())) return false;
  const minutes = d.getHours() * 60 + d.getMinutes();
  const [sh, sm] = hm(hours.start);
  const [eh, em] = hm(hours.end);
  return minutes >= sh * 60 + sm && minutes < eh * 60 + em;
}

/** The first instant at or after `from` that falls inside business hours. */
export function nextBusinessMoment(from: Date, tz: string, hours: BusinessHours): Date {
  const [sh, sm] = hm(hours.start);
  const [eh, em] = hm(hours.end);
  let d = new TZDate(from.getTime(), tz);
  for (let i = 0; i < 15; i++) {
    const minutes = d.getHours() * 60 + d.getMinutes();
    if (hours.days.includes(d.getDay())) {
      if (minutes < sh * 60 + sm) return new Date(new TZDate(d.getFullYear(), d.getMonth(), d.getDate(), sh, sm, 0, tz).getTime());
      if (minutes < eh * 60 + em) return new Date(d.getTime());
    }
    d = new TZDate(d.getFullYear(), d.getMonth(), d.getDate() + 1, sh, sm, 0, tz);
    if (hours.days.includes(d.getDay())) return new Date(d.getTime());
  }
  return from; // no business days configured; never block forever
}

/** Adds `n` business days (keeping the local time of day). */
export function addBusinessDays(from: Date, n: number, tz: string, hours: BusinessHours): Date {
  let d = new TZDate(from.getTime(), tz);
  let added = 0;
  let guard = 0;
  while (added < n && guard < n * 7 + 14) {
    d = new TZDate(d.getFullYear(), d.getMonth(), d.getDate() + 1, d.getHours(), d.getMinutes(), d.getSeconds(), tz);
    if (hours.days.includes(d.getDay())) added++;
    guard++;
  }
  return new Date(d.getTime());
}

export function addDaysToDateString(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}
