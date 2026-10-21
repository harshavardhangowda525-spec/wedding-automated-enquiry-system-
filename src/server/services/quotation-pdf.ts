import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatInTz } from "@/lib/time";
import type { Quotation, QuotationItem } from "./quotations";

type StudioInfo = { name: string; email: string | null; phone: string | null; city: string | null; website: string | null; brandColor: string; timezone: string };

/** Standard PDF fonts only cover Windows-1252; replace anything else so rendering never fails. */
function safe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/₹/g, "INR ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?");
}

function money(minor: number, currency: string) {
  const locale = currency === "INR" ? "en-IN" : "en";
  return `${currency} ${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of safe(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

export async function renderQuotationPdf(q: Quotation, items: QuotationItem[], studio: StudioInfo): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Quotation ${q.number}`);
  doc.setAuthor(studio.name);
  doc.setCreator("WeddingFlow AI");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const brand = hexToRgb(/^#[0-9a-f]{6}$/i.test(studio.brandColor) ? studio.brandColor : "#a8834d");
  const ink = rgb(0.14, 0.13, 0.12);
  const muted = rgb(0.47, 0.44, 0.4);
  const W = 595.28;
  const H = 841.89;
  const M = 48;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const ensure = (needed: number) => {
    if (y - needed < M) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };
  const text = (s: string, x: number, opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; align?: "left" | "right" } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.f ?? font;
    const str = safe(s);
    const dx = opts.align === "right" ? x - f.widthOfTextAtSize(str, size) : x;
    page.drawText(str, { x: dx, y, size, font: f, color: opts.color ?? ink });
  };

  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: brand });
  text(studio.name, M, { size: 22, f: serif });
  text("QUOTATION", W - M, { size: 11, f: bold, color: brand, align: "right" });
  y -= 16;
  text([studio.city, studio.phone, studio.email, studio.website].filter(Boolean).join("  ·  "), M, { size: 8.5, color: muted });
  text(q.number, W - M, { size: 10, f: bold, align: "right" });
  y -= 14;
  text(`Date: ${formatInTz(q.createdAt, studio.timezone, "d MMM yyyy")}`, W - M, { size: 9, color: muted, align: "right" });
  y -= 12;
  if (q.validUntil) text(`Valid until: ${formatInTz(`${q.validUntil}T12:00:00Z`, studio.timezone, "d MMM yyyy")}`, W - M, { size: 9, color: muted, align: "right" });

  y -= 28;
  text("Prepared for", M, { size: 8, color: muted });
  y -= 14;
  text(q.clientName, M, { size: 12, f: bold });
  y -= 13;
  for (const line of [q.clientEmail, q.clientPhone, q.eventSummary, q.eventDate ? `Event date: ${formatInTz(`${q.eventDate}T12:00:00Z`, studio.timezone, "d MMMM yyyy")}` : null].filter(Boolean) as string[]) {
    text(line, M, { size: 9.5, color: muted });
    y -= 12;
  }

  y -= 14;
  text(q.title, M, { size: 13, f: serif });
  y -= 20;
  const cols = { desc: M, qty: 360, unit: 450, total: W - M };
  page.drawRectangle({ x: M - 6, y: y - 5, width: W - 2 * M + 12, height: 18, color: rgb(0.96, 0.93, 0.89) });
  text("Description", cols.desc, { size: 8.5, f: bold });
  text("Qty", cols.qty, { size: 8.5, f: bold, align: "right" });
  text("Unit price", cols.unit + 40, { size: 8.5, f: bold, align: "right" });
  text("Amount", cols.total, { size: 8.5, f: bold, align: "right" });
  y -= 20;
  for (const item of items) {
    const lines = wrap(item.description, font, 9.5, 280);
    ensure(lines.length * 12 + 8);
    text(lines[0], cols.desc, { size: 9.5 });
    text(String(item.quantity), cols.qty, { size: 9.5, align: "right" });
    text(money(item.unitPriceMinor, q.currency), cols.unit + 40, { size: 9.5, align: "right" });
    text(money(item.lineTotalMinor, q.currency), cols.total, { size: 9.5, align: "right" });
    for (const extra of lines.slice(1)) {
      y -= 12;
      text(extra, cols.desc, { size: 9.5 });
    }
    y -= 8;
    page.drawLine({ start: { x: M - 6, y: y + 2 }, end: { x: W - M + 6, y: y + 2 }, thickness: 0.4, color: rgb(0.9, 0.87, 0.81) });
    y -= 10;
  }

  ensure(110);
  const row = (label: string, value: string, opts: { strong?: boolean } = {}) => {
    text(label, cols.unit - 40, { size: opts.strong ? 11 : 9.5, f: opts.strong ? bold : font, align: "right" });
    text(value, cols.total, { size: opts.strong ? 11 : 9.5, f: opts.strong ? bold : font, align: "right" });
    y -= opts.strong ? 18 : 14;
  };
  y -= 4;
  row("Subtotal", money(q.subtotalMinor, q.currency));
  if (q.discountMinor > 0) row("Discount", `- ${money(q.discountMinor, q.currency)}`);
  row(`${q.taxLabel} (${(q.taxRateBps / 100).toFixed(q.taxRateBps % 100 ? 2 : 0)}%)`, money(q.taxMinor, q.currency));
  row("Total", money(q.totalMinor, q.currency), { strong: true });
  if (q.depositMinor > 0) row("Deposit to confirm booking", money(q.depositMinor, q.currency));

  if (q.milestones.length) {
    y -= 10;
    ensure(20 + q.milestones.length * 13);
    text("Payment schedule", M, { size: 10, f: bold });
    y -= 14;
    for (const m of q.milestones) {
      text(`${m.label}${m.dueDate ? ` (due ${formatInTz(`${m.dueDate}T12:00:00Z`, studio.timezone, "d MMM yyyy")})` : ""}`, M, { size: 9.5 });
      text(money(m.amountMinor, q.currency), cols.total, { size: 9.5, align: "right" });
      y -= 13;
    }
  }

  if (q.terms) {
    y -= 14;
    ensure(30);
    text("Terms & conditions", M, { size: 10, f: bold });
    y -= 13;
    for (const line of wrap(q.terms, font, 8.5, W - 2 * M)) {
      ensure(12);
      text(line, M, { size: 8.5, color: muted });
      y -= 11;
    }
  }

  y -= 12;
  ensure(20);
  text("This quotation is not a booking confirmation. Dates are reserved only once the booking is confirmed by the studio.", M, { size: 8, color: muted });
  return doc.save();
}
