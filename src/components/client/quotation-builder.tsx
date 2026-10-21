"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { saveQuotationAction } from "@/app/actions/quotations";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { Field, Input, Select, Textarea, buttonClass } from "@/components/ui";
import { formatMoney, minorToInput, parseMoneyToMinor } from "@/lib/money";
import { computeQuote } from "@/lib/quote-calc";

type Service = { id: string; name: string; priceMinor: number | null; unit: string };
type Item = { key: number; serviceId: string; description: string; quantity: string; unitPrice: string };
type Milestone = { key: number; label: string; amount: string; dueDate: string };

export type QuotationInitial = {
  title: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  eventSummary: string;
  eventDate: string;
  validUntil: string;
  items: { serviceId: string | null; description: string; quantity: number; unitPriceMinor: number }[];
  discountType: "none" | "percent" | "fixed";
  discountValue: number;
  taxRateBps: number;
  taxLabel: string;
  depositType: "percent" | "fixed";
  depositValue: number;
  milestones: { label: string; amountMinor: number; dueDate?: string | null }[];
  terms: string;
  internalNotes: string;
};

let counter = 1;
const nextKey = () => counter++;

export function QuotationBuilder({
  leadId,
  quotationId,
  initial,
  services,
  currency,
  readOnly,
}: {
  leadId: string;
  quotationId?: string;
  initial: QuotationInitial;
  services: Service[];
  currency: string;
  readOnly?: boolean;
}) {
  const [f, setF] = useState({
    title: initial.title,
    clientName: initial.clientName,
    clientEmail: initial.clientEmail,
    clientPhone: initial.clientPhone,
    eventSummary: initial.eventSummary,
    eventDate: initial.eventDate,
    validUntil: initial.validUntil,
    discountType: initial.discountType,
    discount: initial.discountType === "percent" ? String(initial.discountValue / 100) : minorToInput(initial.discountValue),
    taxRate: String(initial.taxRateBps / 100),
    taxLabel: initial.taxLabel,
    depositType: initial.depositType,
    deposit: initial.depositType === "percent" ? String(initial.depositValue / 100) : minorToInput(initial.depositValue),
    terms: initial.terms,
    internalNotes: initial.internalNotes,
  });
  const [items, setItems] = useState<Item[]>(
    initial.items.length
      ? initial.items.map((i) => ({ key: nextKey(), serviceId: i.serviceId ?? "", description: i.description, quantity: String(i.quantity), unitPrice: minorToInput(i.unitPriceMinor) }))
      : [{ key: nextKey(), serviceId: "", description: "", quantity: "1", unitPrice: "" }],
  );
  const [milestones, setMilestones] = useState<Milestone[]>(
    initial.milestones.map((m) => ({ key: nextKey(), label: m.label, amount: minorToInput(m.amountMinor), dueDate: m.dueDate ?? "" })),
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const payload = useMemo(() => {
    const pct = (v: string) => Math.round(Number(v || 0) * 100);
    return {
      title: f.title,
      clientName: f.clientName,
      clientEmail: f.clientEmail,
      clientPhone: f.clientPhone,
      eventSummary: f.eventSummary,
      eventDate: f.eventDate,
      validUntil: f.validUntil,
      items: items
        .filter((i) => i.description.trim() || i.unitPrice)
        .map((i) => ({ serviceId: i.serviceId || undefined, description: i.description, quantity: Number(i.quantity || 0), unitPriceMinor: parseMoneyToMinor(i.unitPrice) ?? -1 })),
      discountType: f.discountType,
      discountValue: f.discountType === "percent" ? pct(f.discount) : f.discountType === "fixed" ? (parseMoneyToMinor(f.discount) ?? 0) : 0,
      taxRateBps: pct(f.taxRate),
      taxLabel: f.taxLabel,
      depositType: f.depositType,
      depositValue: f.depositType === "percent" ? pct(f.deposit) : (parseMoneyToMinor(f.deposit) ?? 0),
      milestones: milestones.filter((m) => m.label.trim()).map((m) => ({ label: m.label, amountMinor: parseMoneyToMinor(m.amount) ?? 0, dueDate: m.dueDate || null })),
      terms: f.terms,
      internalNotes: f.internalNotes,
    };
  }, [f, items, milestones]);

  const totals = useMemo(
    () =>
      computeQuote({
        items: payload.items.map((i) => ({ quantity: i.quantity, unitPriceMinor: Math.max(i.unitPriceMinor, 0) })),
        discountType: payload.discountType,
        discountValue: payload.discountValue,
        taxRateBps: payload.taxRateBps,
        depositType: payload.depositType,
        depositValue: payload.depositValue,
        milestones: payload.milestones,
      }),
    [payload],
  );
  const money = (m: number) => formatMoney(m, currency);

  return (
    <ActionForm action={saveQuotationAction} className="space-y-6">
      <input type="hidden" name="leadId" value={leadId} />
      {quotationId && <input type="hidden" name="quotationId" value={quotationId} />}
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <fieldset disabled={readOnly} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="q-title" name="title">
            <Input id="q-title" value={f.title} onChange={set("title")} />
          </Field>
          <Field label="Client name" htmlFor="q-client" name="clientName">
            <Input id="q-client" value={f.clientName} onChange={set("clientName")} />
          </Field>
          <Field label="Client email" htmlFor="q-email" name="clientEmail">
            <Input id="q-email" type="email" value={f.clientEmail} onChange={set("clientEmail")} />
          </Field>
          <Field label="Client phone" htmlFor="q-phone">
            <Input id="q-phone" value={f.clientPhone} onChange={set("clientPhone")} />
          </Field>
          <Field label="Event summary" htmlFor="q-event">
            <Input id="q-event" value={f.eventSummary} onChange={set("eventSummary")} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Event date" htmlFor="q-date" name="eventDate">
              <Input id="q-date" type="date" value={f.eventDate} onChange={set("eventDate")} />
            </Field>
            <Field label="Valid until" htmlFor="q-valid" name="validUntil">
              <Input id="q-valid" type="date" value={f.validUntil} onChange={set("validUntil")} />
            </Field>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Items</h3>
            <p className="text-xs text-muted">Prices come from your service list; you can adjust them for this quotation.</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-sand/50 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Service / description</th>
                  <th className="w-20 px-3 py-2">Qty</th>
                  <th className="w-36 px-3 py-2">Unit price</th>
                  <th className="w-32 px-3 py-2 text-right">Line total</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.key} className="border-t border-line align-top">
                    <td className="space-y-1.5 px-3 py-2">
                      <Select
                        aria-label={`Service for item ${idx + 1}`}
                        value={item.serviceId}
                        onChange={(e) => {
                          const svc = services.find((s) => s.id === e.target.value);
                          setItems((all) =>
                            all.map((x) =>
                              x.key === item.key ? { ...x, serviceId: e.target.value, description: svc ? svc.name : x.description, unitPrice: svc && svc.priceMinor !== null ? minorToInput(svc.priceMinor) : x.unitPrice } : x,
                            ),
                          );
                        }}
                      >
                        <option value="">Custom item</option>
                        {services.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} {s.priceMinor !== null ? `– ${formatMoney(s.priceMinor, currency)}` : "– price on request"}
                          </option>
                        ))}
                      </Select>
                      <Input aria-label={`Description for item ${idx + 1}`} value={item.description} placeholder="Description" onChange={(e) => setItems((all) => all.map((x) => (x.key === item.key ? { ...x, description: e.target.value } : x)))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input aria-label={`Quantity for item ${idx + 1}`} inputMode="numeric" value={item.quantity} onChange={(e) => setItems((all) => all.map((x) => (x.key === item.key ? { ...x, quantity: e.target.value.replace(/\D/g, "") } : x)))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input aria-label={`Unit price for item ${idx + 1}`} inputMode="decimal" value={item.unitPrice} placeholder="0" onChange={(e) => setItems((all) => all.map((x) => (x.key === item.key ? { ...x, unitPrice: e.target.value } : x)))} />
                    </td>
                    <td className="px-3 py-2 pt-4 text-right font-medium">{money(Number(item.quantity || 0) * (parseMoneyToMinor(item.unitPrice) ?? 0))}</td>
                    <td className="px-1 py-2 pt-3">
                      {items.length > 1 && (
                        <button type="button" className="rounded p-1.5 text-muted hover:bg-sand hover:text-danger" aria-label={`Remove item ${idx + 1}`} onClick={() => setItems((all) => all.filter((x) => x.key !== item.key))}>
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className={buttonClass("ghost", "sm", "mt-2")} onClick={() => setItems((all) => [...all, { key: nextKey(), serviceId: "", description: "", quantity: "1", unitPrice: "" }])}>
            <Plus size={14} /> Add item
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Discount" htmlFor="q-disc-type">
                <Select id="q-disc-type" value={f.discountType} onChange={set("discountType")}>
                  <option value="none">No discount</option>
                  <option value="percent">Percentage</option>
                  <option value="fixed">Fixed amount</option>
                </Select>
              </Field>
              {f.discountType !== "none" && (
                <Field label={f.discountType === "percent" ? "Discount %" : `Discount (${currency})`} htmlFor="q-disc">
                  <Input id="q-disc" inputMode="decimal" value={f.discount} onChange={set("discount")} />
                </Field>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Tax label" htmlFor="q-taxlabel">
                <Input id="q-taxlabel" value={f.taxLabel} onChange={set("taxLabel")} />
              </Field>
              <Field label="Tax %" htmlFor="q-tax">
                <Input id="q-tax" inputMode="decimal" value={f.taxRate} onChange={set("taxRate")} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Deposit" htmlFor="q-dep-type">
                <Select id="q-dep-type" value={f.depositType} onChange={set("depositType")}>
                  <option value="percent">Percentage of total</option>
                  <option value="fixed">Fixed amount</option>
                </Select>
              </Field>
              <Field label={f.depositType === "percent" ? "Deposit %" : `Deposit (${currency})`} htmlFor="q-dep">
                <Input id="q-dep" inputMode="decimal" value={f.deposit} onChange={set("deposit")} />
              </Field>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink-soft">Payment milestones (optional – must add up to the total)</p>
              {milestones.map((m, idx) => (
                <div key={m.key} className="mb-2 grid grid-cols-[1fr_7rem_9rem_auto] gap-2">
                  <Input aria-label={`Milestone ${idx + 1} label`} placeholder="e.g. Advance" value={m.label} onChange={(e) => setMilestones((all) => all.map((x) => (x.key === m.key ? { ...x, label: e.target.value } : x)))} />
                  <Input aria-label={`Milestone ${idx + 1} amount`} inputMode="decimal" placeholder="Amount" value={m.amount} onChange={(e) => setMilestones((all) => all.map((x) => (x.key === m.key ? { ...x, amount: e.target.value } : x)))} />
                  <Input aria-label={`Milestone ${idx + 1} due date`} type="date" value={m.dueDate} onChange={(e) => setMilestones((all) => all.map((x) => (x.key === m.key ? { ...x, dueDate: e.target.value } : x)))} />
                  <button type="button" className="rounded p-1.5 text-muted hover:text-danger" aria-label={`Remove milestone ${idx + 1}`} onClick={() => setMilestones((all) => all.filter((x) => x.key !== m.key))}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setMilestones((all) => [...all, { key: nextKey(), label: "", amount: "", dueDate: "" }])}>
                <Plus size={14} /> Add milestone
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-line bg-sand/40 p-5">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd>{money(totals.subtotalMinor)}</dd>
              </div>
              {totals.discountMinor > 0 && (
                <div className="flex justify-between text-success">
                  <dt>Discount</dt>
                  <dd>−{money(totals.discountMinor)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt>
                  {f.taxLabel || "Tax"} ({f.taxRate || 0}%)
                </dt>
                <dd>{money(totals.taxMinor)}</dd>
              </div>
              <div className="flex justify-between border-t border-line-strong pt-2 font-display text-2xl font-semibold">
                <dt>Total</dt>
                <dd>{money(totals.totalMinor)}</dd>
              </div>
              <div className="flex justify-between text-ink-soft">
                <dt>Deposit to confirm</dt>
                <dd>{money(totals.depositMinor)}</dd>
              </div>
              {milestones.length > 0 && (
                <div className="flex justify-between text-xs text-muted">
                  <dt>Milestones total</dt>
                  <dd>{money(totals.milestonesTotalMinor)}</dd>
                </div>
              )}
            </dl>
            {totals.problems.length > 0 && (
              <ul className="mt-3 list-disc pl-4 text-xs text-danger">
                {totals.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-muted">Totals are recalculated on the server when you save.</p>
          </div>
        </div>

        <Field label="Terms & conditions" htmlFor="q-terms">
          <Textarea id="q-terms" rows={4} value={f.terms} onChange={set("terms")} />
        </Field>
        <Field label="Internal notes (not shown to the client)" htmlFor="q-notes">
          <Textarea id="q-notes" rows={3} value={f.internalNotes} onChange={set("internalNotes")} />
        </Field>
      </fieldset>
      {!readOnly && (
        <SubmitButton variant="gold" pendingText="Saving…">
          {quotationId ? "Save quotation" : "Create quotation"}
        </SubmitButton>
      )}
    </ActionForm>
  );
}
