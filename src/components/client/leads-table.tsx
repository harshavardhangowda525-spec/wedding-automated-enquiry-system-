"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { bulkLeadsAction } from "@/app/actions/leads";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { buttonClass, DemoBadge, Input, LeadStatusBadge, PriorityBadge, Select, td, th } from "@/components/ui";
import { LEAD_SOURCE_LABELS, LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadSource, type LeadStatus } from "@/lib/domain";
import { formatMoney } from "@/lib/money";

export type LeadRow = {
  id: string;
  reference: string;
  contactName: string;
  partnerName: string | null;
  phone: string;
  eventType: string;
  eventDate: string | null;
  city: string | null;
  status: LeadStatus;
  priority: "low" | "medium" | "high" | null;
  source: string;
  tags: string[];
  assigneeName: string | null;
  assigneeEmail: string | null;
  nextAction: string | null;
  quotationAmountMinor: number | null;
  lastActivityLabel: string;
  createdLabel: string;
  eventLabel: string;
  optedOut: boolean;
  isDemo: boolean;
  possibleDuplicateOf: string | null;
};

export function LeadsTable({ rows, members, currency, canEdit }: { rows: LeadRow[]; members: { userId: string; name: string }[]; currency: string; canEdit: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState<"status" | "assign" | "add_tag">("status");
  const [status, setStatus] = useState<LeadStatus>("contacted");
  const dialog = useRef<HTMLDialogElement>(null);
  const allSelected = rows.length > 0 && selected.length === rows.length;
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const needsReason = bulk === "status" && (status === "lost" || status === "not_interested");
  const summary = useMemo(() => `${selected.length} lead${selected.length === 1 ? "" : "s"}`, [selected.length]);

  return (
    <>
      {canEdit && selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-gold-soft/50 px-4 py-2.5 text-sm">
          <span className="font-medium">{summary} selected</span>
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => dialog.current?.showModal()}>
            Bulk update…
          </button>
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setSelected([])}>
            Clear
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse text-left text-sm">
          <thead>
            <tr>
              {canEdit && (
                <th className={`${th} w-10`}>
                  <input type="checkbox" aria-label="Select all leads on this page" checked={allSelected} onChange={() => setSelected(allSelected ? [] : rows.map((r) => r.id))} className="accent-[var(--color-gold)]" />
                </th>
              )}
              <th className={th}>Client</th>
              <th className={th}>Event</th>
              <th className={th}>Status</th>
              <th className={th}>Priority</th>
              <th className={th}>Owner</th>
              <th className={th}>Next action</th>
              <th className={th}>Quote</th>
              <th className={th}>Activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-sand/40">
                {canEdit && (
                  <td className={td}>
                    <input type="checkbox" aria-label={`Select ${r.contactName}`} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} className="accent-[var(--color-gold)]" />
                  </td>
                )}
                <td className={td}>
                  <Link href={`/leads/${r.id}`} className="font-medium text-ink hover:text-gold-strong hover:underline">
                    {r.contactName}
                    {r.partnerName ? ` & ${r.partnerName}` : ""}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span className="font-mono">{r.reference}</span>· {LEAD_SOURCE_LABELS[r.source as LeadSource] ?? r.source}
                    {r.isDemo && <DemoBadge />}
                    {r.optedOut && <span className="rounded bg-danger-soft px-1 text-danger">Opted out</span>}
                    {r.possibleDuplicateOf && <span className="rounded bg-warning-soft px-1 text-warning">Possible duplicate</span>}
                  </div>
                  {r.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.tags.map((t) => (
                        <span key={t} className="rounded bg-sand px-1.5 text-[11px] text-ink-soft">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className={td}>
                  <div>{r.eventType}</div>
                  <div className="text-xs text-muted">
                    {r.eventLabel}
                    {r.city ? ` · ${r.city}` : ""}
                  </div>
                </td>
                <td className={td}>
                  <LeadStatusBadge status={r.status} />
                </td>
                <td className={td}>
                  <PriorityBadge priority={r.priority} />
                </td>
                <td className={`${td} text-xs`}>{r.assigneeName ?? r.assigneeEmail ?? <span className="text-muted">Unassigned</span>}</td>
                <td className={`${td} max-w-[14rem] text-xs`}>{r.nextAction ?? <span className="text-muted">—</span>}</td>
                <td className={`${td} text-xs`}>{r.quotationAmountMinor !== null ? formatMoney(r.quotationAmountMinor, currency) : <span className="text-muted">—</span>}</td>
                <td className={`${td} text-xs text-muted`}>
                  <div>{r.lastActivityLabel}</div>
                  <div className="text-[11px]">Received {r.createdLabel}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dialog ref={dialog} className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-white p-0 shadow-xl">
        <ActionForm action={bulkLeadsAction} className="space-y-4 p-5" onSuccess={() => setSelected([])}>
          <h2 className="font-display text-xl font-semibold">Update {summary}</h2>
          {selected.map((id) => (
            <input key={id} type="hidden" name="leadIds" value={id} />
          ))}
          <div className="space-y-1.5">
            <label htmlFor="bulkAction" className="text-sm font-medium text-ink-soft">
              Action
            </label>
            <Select id="bulkAction" name="bulkAction" value={bulk} onChange={(e) => setBulk(e.target.value as typeof bulk)}>
              <option value="status">Change status</option>
              <option value="assign">Assign to team member</option>
              <option value="add_tag">Add a tag</option>
            </Select>
          </div>
          {bulk === "status" && (
            <div className="space-y-1.5">
              <label htmlFor="bulkStatus" className="text-sm font-medium text-ink-soft">
                New status
              </label>
              <Select id="bulkStatus" name="status" value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)}>
                {LEAD_STATUSES.filter((s) => s !== "booking_confirmed" && s !== "won").map((s) => (
                  <option key={s} value={s}>
                    {LEAD_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted">Bookings must be confirmed individually so their conditions can be checked.</p>
            </div>
          )}
          {needsReason && <Input name="lostReason" placeholder="Reason (required)" aria-label="Reason" required />}
          {bulk === "assign" && (
            <Select name="userId" aria-label="Team member" defaultValue="">
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
          {bulk === "add_tag" && <Input name="tag" placeholder="e.g. destination" aria-label="Tag" required />}
          <p className="text-xs text-muted">Each change is validated per lead and recorded in its timeline. Invalid changes are skipped and reported.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass("secondary")} onClick={() => dialog.current?.close()}>
              Close
            </button>
            <SubmitButton>Apply to {summary}</SubmitButton>
          </div>
        </ActionForm>
      </dialog>
    </>
  );
}
