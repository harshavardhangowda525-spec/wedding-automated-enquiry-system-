import { and, desc, eq } from "drizzle-orm";
import { Bot, CalendarCheck, FileText, MessageSquare, ShieldAlert, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addNoteAction,
  assignLeadAction,
  changeStatusAction,
  deleteLeadAction,
  logContactAction,
  optInAction,
  optOutAction,
  recordDepositAction,
  setTagsAction,
  updateLeadAction,
} from "@/app/actions/leads";
import { aiDraftQuotationAction, aiDraftReplyAction, aiLeadAction, applyPriorityAction } from "@/app/actions/ai";
import { approveMessageAction, cancelMessageAction, createDraftAction, setAvailabilityAction, setTaskStatusAction, updateDraftAction } from "@/app/actions/work";
import { TaskForm } from "@/components/task-form";
import { ActionForm, ConfirmAction, DialogButton, SubmitButton } from "@/components/client/forms";
import {
  Alert,
  AvailabilityBadge,
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  DemoBadge,
  Field,
  Input,
  LeadStatusBadge,
  MessageStatusBadge,
  PageHeader,
  PriorityBadge,
  Select,
  Textarea,
} from "@/components/ui";
import {
  EVENT_TYPES,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  LEAD_TRANSITIONS,
  TASK_TYPE_LABELS,
  roleAtLeast,
} from "@/lib/domain";
import { formatMoney, minorToInput } from "@/lib/money";
import { dateInTz, formatInTz } from "@/lib/time";
import { aiConfigured } from "@/server/ai/provider";
import { latestInsights } from "@/server/ai/service";
import { inStudio } from "@/server/auth/context";
import { consents, messageTemplates } from "@/server/db/schema";
import { channelStatus, listMessages } from "@/server/messaging/service";
import { getAvailability } from "@/server/services/calendar";
import { checkBookingConditions, findOtherLeadsWithPhone, getLead, getLeadTimeline, listMembers } from "@/server/services/leads";
import { listPricedServices, listQuotations } from "@/server/services/quotations";
import { listTasks } from "@/server/services/tasks";

export const metadata = { title: "Lead" };

type Summary = { summary: string; requestedServices: string[]; eventDetails: string; missingInformation: string[]; suggestedNextStep: string; model?: string };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await inStudio("viewer", async (svc, ctx) => {
    const lead = await getLead(svc, id).catch(() => null);
    if (!lead) return null;
    const [timeline, members, services, tasks, quotes, msgs, insights, consentRows, templates, duplicates, channels] = await Promise.all([
      getLeadTimeline(svc, id),
      listMembers(svc),
      listPricedServices(svc),
      listTasks(svc, { scope: "all", leadId: id }),
      listQuotations(svc, { leadId: id }),
      listMessages(svc, { leadId: id, limit: 50 }),
      latestInsights(svc, id),
      svc.tx.select().from(consents).where(and(eq(consents.leadId, id), eq(consents.studioId, svc.studioId))).orderBy(desc(consents.createdAt)),
      svc.tx.select().from(messageTemplates).where(and(eq(messageTemplates.studioId, svc.studioId), eq(messageTemplates.active, true))),
      findOtherLeadsWithPhone(svc, lead),
      channelStatus(svc.tx, ctx.studio),
    ]);
    const availability = lead.eventDate ? await getAvailability(svc.tx, svc.studioId, lead.eventDate, lead.id) : null;
    const booking = await checkBookingConditions(svc.tx, lead);
    return { lead, timeline, members, services, tasks, quotes, msgs, insights, consentRows, templates, duplicates, availability, booking, channels, ctx };
  });
  if (!data) notFound();
  const { lead, ctx } = data;
  const tz = ctx.studio.timezone;
  const canEdit = roleAtLeast(ctx.role, "staff");
  const isAdmin = roleAtLeast(ctx.role, "admin");
  const ai = aiConfigured() && ctx.studio.aiEnabled;
  const aiReason = !ctx.studio.aiEnabled ? "AI is turned off in Settings for this studio." : "AI is not configured on this server (no ANTHROPIC_API_KEY). Everything else keeps working.";
  const summary = lead.aiSummary as Summary | null;
  const priority = data.insights.priority?.content as { priority: "low" | "medium" | "high"; explanation: string; factors: string[] } | undefined;
  const convo = data.insights.conversation_summary?.content as { summary: string; unansweredQuestions: string[]; commitmentsMade: string[] } | undefined;
  const next = data.insights.next_action?.content as { action: string; rationale: string; suggestedWithinDays: number } | undefined;
  const serviceNames = data.services.filter((s) => lead.serviceIds.includes(s.id)).map((s) => s.name);
  const nextStatuses = LEAD_TRANSITIONS[lead.status];
  const today = dateInTz(new Date(), tz);
  const fmtDate = (d: string) => formatInTz(`${d}T12:00:00Z`, tz, "EEE, d MMM yyyy");
  const hidden = <input type="hidden" name="leadId" value={lead.id} />;

  return (
    <>
      <div className="mb-3 text-sm">
        <Link href="/leads" className="text-muted hover:text-ink">
          ← All leads
        </Link>
      </div>
      <PageHeader
        eyebrow={<span className="font-mono">{lead.reference}</span>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {lead.contactName}
            {lead.partnerName ? ` & ${lead.partnerName}` : ""}
            <LeadStatusBadge status={lead.status} />
            {lead.isDemo && <DemoBadge />}
          </span>
        }
        description={`${lead.eventType} · ${lead.eventDate ? fmtDate(lead.eventDate) : "Date not decided"}${lead.city ? ` · ${lead.city}` : ""} · ${LEAD_SOURCE_LABELS[lead.source as keyof typeof LEAD_SOURCE_LABELS] ?? lead.source}`}
        actions={
          canEdit ? (
            <>
              <DialogButton label="Change status" title="Change status" variant="primary">
                <ActionForm action={changeStatusAction} className="space-y-4">
                  {hidden}
                  <Field label="New status" htmlFor="status">
                    <Select id="status" name="status" defaultValue={nextStatuses[0]}>
                      {nextStatuses.map((s) => (
                        <option key={s} value={s}>
                          {LEAD_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Reason (required for Lost / Not interested)" htmlFor="lostReason">
                    <Input id="lostReason" name="lostReason" placeholder="e.g. Budget, chose another studio, date unavailable" />
                  </Field>
                  <Field label="Note" htmlFor="note">
                    <Textarea id="note" name="note" rows={2} />
                  </Field>
                  {!data.booking.ok && nextStatuses.includes("booking_confirmed") && (
                    <Alert tone="info" title="Before confirming a booking">
                      <ul className="list-disc pl-4">
                        {data.booking.problems.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </Alert>
                  )}
                  <SubmitButton>Save status</SubmitButton>
                </ActionForm>
              </DialogButton>
              <DialogButton label="Log contact" title="Log a contact attempt">
                <ActionForm action={logContactAction} className="space-y-4">
                  {hidden}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Channel" htmlFor="channel">
                      <Select id="channel" name="channel" defaultValue="phone">
                        <option value="phone">Phone call</option>
                        <option value="whatsapp">WhatsApp (personal)</option>
                        <option value="email">Email (personal)</option>
                        <option value="instagram">Instagram</option>
                        <option value="in_person">In person</option>
                      </Select>
                    </Field>
                    <Field label="Outcome" htmlFor="outcome">
                      <Select id="outcome" name="outcome" defaultValue="reached">
                        <option value="reached">Spoke with the client</option>
                        <option value="no_answer">No answer</option>
                        <option value="left_message">Left a message</option>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Summary" htmlFor="summary">
                    <Textarea id="summary" name="summary" rows={3} placeholder="What was discussed?" />
                  </Field>
                  <SubmitButton>Log contact</SubmitButton>
                </ActionForm>
              </DialogButton>
              <DialogButton label="Schedule follow-up" title="Schedule a follow-up">
                <TaskForm leadId={lead.id} members={data.members} today={today} defaultTitle={`Follow up with ${lead.contactName}`} />
              </DialogButton>
            </>
          ) : undefined
        }
      />

      {data.duplicates.length > 0 && (
        <Alert tone="warning" className="mb-4" title="Possible duplicate">
          This phone number also appears on{" "}
          {data.duplicates.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ", "}
              <Link className="underline" href={`/leads/${d.id}`}>
                {d.reference}
              </Link>{" "}
              ({LEAD_STATUS_LABELS[d.status]})
            </span>
          ))}
          .
        </Alert>
      )}
      {lead.optedOut && (
        <Alert tone="danger" className="mb-4" title="Client opted out">
          No messages will be sent to this client. Pending messages were cancelled{lead.optedOutAt ? ` on ${formatInTz(lead.optedOutAt, tz)}` : ""}.
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          {/* Date & booking */}
          <Card>
            <CardHeader title="Date & booking" description="Availability is only shown as available when your calendar records support it." />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Event date</p>
                {lead.eventDate && data.availability ? (
                  <>
                    <p className="mt-1 flex items-center gap-2 font-medium">
                      {fmtDate(lead.eventDate)} <AvailabilityBadge state={data.availability.state} />
                    </p>
                    <p className="mt-1 text-xs text-muted">{data.availability.explanation}</p>
                    {canEdit && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <ActionForm action={setAvailabilityAction} showMessage={false}>
                          {hidden}
                          <input type="hidden" name="date" value={lead.eventDate} />
                          <input type="hidden" name="state" value="available" />
                          <SubmitButton size="sm" variant="secondary">Mark date available</SubmitButton>
                        </ActionForm>
                        <ActionForm action={setAvailabilityAction} showMessage={false}>
                          {hidden}
                          <input type="hidden" name="date" value={lead.eventDate} />
                          <input type="hidden" name="state" value="unavailable" />
                          <SubmitButton size="sm" variant="ghost">Mark unavailable</SubmitButton>
                        </ActionForm>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted">Not decided yet</p>
                )}
                {lead.additionalDates.length > 0 && (
                  <p className="mt-2 text-xs text-muted">Also: {lead.additionalDates.map((d) => fmtDate(d.date)).join(", ")}</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Booking readiness</p>
                {data.booking.ok ? (
                  <p className="mt-1 text-sm text-success">All configured booking conditions are met.</p>
                ) : (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-ink-soft">
                    {data.booking.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs text-muted">
                  Deposit: {lead.depositRecordedAt ? `${formatMoney(lead.depositAmountMinor, ctx.studio.currency)} recorded ${formatInTz(lead.depositRecordedAt, tz, "d MMM yyyy")}` : "not recorded"}
                </p>
                {canEdit && (
                  <DialogButton label="Record deposit" title="Record deposit received" size="sm">
                    <ActionForm action={recordDepositAction} className="space-y-4">
                      {hidden}
                      <Field label={`Amount (${ctx.studio.currency})`} htmlFor="amount" name="amount">
                        <Input id="amount" name="amount" inputMode="decimal" placeholder="50000" required />
                      </Field>
                      <p className="text-xs text-muted">Record only money actually received. This is used for booking confirmation rules and analytics.</p>
                      <SubmitButton>Record deposit</SubmitButton>
                    </ActionForm>
                  </DialogButton>
                )}
              </div>
            </div>
          </Card>

          {/* AI assistant */}
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Sparkles size={16} className="text-gold" /> AI assistant
                </span>
              }
              description="Grounded in this enquiry, your services and your prices. Drafts always need your approval."
            />
            <div className="space-y-5 p-5">
              {!ai ? (
                <Alert tone="info" title="AI unavailable">
                  {aiReason}
                </Alert>
              ) : (
                canEdit && (
                  <div className="flex flex-wrap gap-2">
                    {[
                      ["summary", "Summarise enquiry"],
                      ["priority", "Suggest priority"],
                      ["conversation", "Summarise conversation"],
                      ["next_action", "Suggest next step"],
                    ].map(([kind, label]) => (
                      <ActionForm key={kind} action={aiLeadAction} showMessage={false}>
                        {hidden}
                        <input type="hidden" name="kind" value={kind} />
                        <SubmitButton size="sm" variant="secondary" pendingText="Thinking…">
                          {label}
                        </SubmitButton>
                      </ActionForm>
                    ))}
                    <ActionForm action={aiDraftQuotationAction} showMessage={false}>
                      {hidden}
                      <SubmitButton size="sm" variant="secondary" pendingText="Drafting…">
                        Draft quotation
                      </SubmitButton>
                    </ActionForm>
                  </div>
                )
              )}
              {summary && (
                <div className="rounded-lg border border-line bg-sand/40 p-4 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Enquiry summary</p>
                  <p className="mt-1">{summary.summary}</p>
                  <p className="mt-2 text-xs text-ink-soft">
                    <strong>Event:</strong> {summary.eventDetails}
                  </p>
                  {summary.missingInformation.length > 0 && (
                    <p className="mt-1 text-xs text-ink-soft">
                      <strong>Missing:</strong> {summary.missingInformation.join("; ")}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-ink-soft">
                    <strong>Suggested next step:</strong> {summary.suggestedNextStep}
                  </p>
                </div>
              )}
              {priority && data.insights.priority && (
                <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-sand/40 p-4 text-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Suggested priority</p>
                    <p className="mt-1 flex items-center gap-2">
                      <PriorityBadge priority={priority.priority} /> {priority.explanation}
                    </p>
                    <p className="mt-1 text-xs text-muted">Considered: {priority.factors.join("; ")}</p>
                  </div>
                  {canEdit && lead.priority !== priority.priority && (
                    <ActionForm action={applyPriorityAction} showMessage={false}>
                      {hidden}
                      <input type="hidden" name="insightId" value={data.insights.priority.id} />
                      <SubmitButton size="sm" variant="secondary">
                        Apply
                      </SubmitButton>
                    </ActionForm>
                  )}
                </div>
              )}
              {convo && (
                <div className="rounded-lg border border-line bg-sand/40 p-4 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Conversation summary</p>
                  <p className="mt-1">{convo.summary}</p>
                  {convo.unansweredQuestions.length > 0 && <p className="mt-1 text-xs text-ink-soft"><strong>Unanswered:</strong> {convo.unansweredQuestions.join("; ")}</p>}
                  {convo.commitmentsMade.length > 0 && <p className="mt-1 text-xs text-ink-soft"><strong>Already promised:</strong> {convo.commitmentsMade.join("; ")}</p>}
                </div>
              )}
              {next && (
                <div className="rounded-lg border border-line bg-sand/40 p-4 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Suggested next step</p>
                  <p className="mt-1 font-medium">{next.action}</p>
                  <p className="text-xs text-muted">
                    {next.rationale} (within {next.suggestedWithinDays} day{next.suggestedWithinDays === 1 ? "" : "s"})
                  </p>
                </div>
              )}
              {ai && canEdit && !lead.optedOut && (
                <ActionForm action={aiDraftReplyAction} className="grid gap-3 rounded-lg border border-dashed border-line-strong p-4 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
                  {hidden}
                  <Field label="Draft a" htmlFor="purpose">
                    <Select id="purpose" name="purpose" defaultValue="follow_up">
                      <option value="acknowledgement">Acknowledgement</option>
                      <option value="follow_up">Follow-up</option>
                      <option value="general">Reply</option>
                    </Select>
                  </Field>
                  <Field label="Channel" htmlFor="ai-channel">
                    <Select id="ai-channel" name="channel" defaultValue={lead.preferredChannel === "email" && lead.email ? "email" : "whatsapp"}>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="email" disabled={!lead.email}>
                        Email
                      </option>
                    </Select>
                  </Field>
                  <Field label="Instructions (optional)" htmlFor="instructions">
                    <Input id="instructions" name="instructions" placeholder="e.g. mention our pre-wedding offer page" />
                  </Field>
                  <SubmitButton variant="gold" pendingText="Drafting…">
                    <Bot size={15} /> Draft
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          </Card>

          {/* Messages */}
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-gold" /> Messages
                </span>
              }
              description={
                data.channels.demo
                  ? "Demo mode: approved messages are simulated and labelled “Demo — not sent”."
                  : `WhatsApp: ${data.channels.whatsapp.replace("_", " ")} · Email: ${data.channels.email.replace("_", " ")}`
              }
              action={
                canEdit && !lead.optedOut ? (
                  <DialogButton label="New message" title="New message draft" size="sm">
                    <ActionForm action={createDraftAction} className="space-y-4">
                      {hidden}
                      <Field label="Start from a template (optional)" htmlFor="templateId" hint="WhatsApp messages outside the 24-hour window must use a template approved in WhatsApp Manager.">
                        <Select id="templateId" name="templateId" defaultValue="">
                          <option value="">Write my own</option>
                          {data.templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Channel" htmlFor="msg-channel">
                        <Select id="msg-channel" name="channel" defaultValue="whatsapp">
                          <option value="whatsapp">WhatsApp</option>
                          <option value="email" disabled={!lead.email}>
                            Email{!lead.email ? " (no email on file)" : ""}
                          </option>
                        </Select>
                      </Field>
                      <Field label="Subject (email)" htmlFor="subject">
                        <Input id="subject" name="subject" />
                      </Field>
                      <Field label="Message" htmlFor="body" hint="Ignored when a template is selected.">
                        <Textarea id="body" name="body" rows={5} />
                      </Field>
                      <SubmitButton>Save draft for approval</SubmitButton>
                    </ActionForm>
                  </DialogButton>
                ) : undefined
              }
            />
            {data.msgs.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">No messages yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.msgs.map(({ message: m }) => (
                  <li key={m.id} className={m.direction === "inbound" ? "bg-sand/40 px-5 py-4" : "px-5 py-4"}>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Badge tone={m.channel === "whatsapp" ? "success" : "info"}>{m.channel === "whatsapp" ? "WhatsApp" : "Email"}</Badge>
                      <span>{m.direction === "inbound" ? "From client" : m.aiGenerated ? "AI draft" : m.createdByType === "automation" ? "Automation" : "Studio"}</span>
                      <MessageStatusBadge status={m.status} isDemo={m.isDemo} />
                      <span>{formatInTz(m.createdAt, tz, "d MMM, h:mm a")}</span>
                      {m.deliveredAt && m.direction === "outbound" && <span>· delivered {formatInTz(m.deliveredAt, tz, "d MMM, h:mm a")}</span>}
                    </div>
                    {m.subject && <p className="mt-1.5 text-sm font-medium">{m.subject}</p>}
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{m.body}</p>
                    {m.reviewNotes && ["draft", "awaiting_approval"].includes(m.status) && (
                      <Alert tone="warning" className="mt-2" title="Check before approving">
                        <span className="whitespace-pre-wrap">{m.reviewNotes}</span>
                      </Alert>
                    )}
                    {(m.skipReason || m.error) && <p className="mt-1 text-xs text-danger">{m.error ?? m.skipReason}</p>}
                    {canEdit && ["draft", "awaiting_approval"].includes(m.status) && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <ActionForm action={approveMessageAction} showMessage={false}>
                          <input type="hidden" name="messageId" value={m.id} />
                          {hidden}
                          <SubmitButton size="sm" variant="gold">
                            Approve &amp; send
                          </SubmitButton>
                        </ActionForm>
                        {!m.whatsappTemplateName && (
                          <DialogButton label="Edit" title="Edit draft" size="sm">
                            <ActionForm action={updateDraftAction} className="space-y-4">
                              <input type="hidden" name="messageId" value={m.id} />
                              {m.channel === "email" && (
                                <Field label="Subject" htmlFor={`subj-${m.id}`}>
                                  <Input id={`subj-${m.id}`} name="subject" defaultValue={m.subject ?? ""} />
                                </Field>
                              )}
                              <Field label="Message" htmlFor={`body-${m.id}`}>
                                <Textarea id={`body-${m.id}`} name="body" rows={8} defaultValue={m.body} />
                              </Field>
                              <SubmitButton>Save changes</SubmitButton>
                            </ActionForm>
                          </DialogButton>
                        )}
                        <ActionForm action={cancelMessageAction} showMessage={false}>
                          <input type="hidden" name="messageId" value={m.id} />
                          {hidden}
                          <SubmitButton size="sm" variant="ghost">
                            Discard
                          </SubmitButton>
                        </ActionForm>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader title="Activity timeline" description="Every meaningful change, message and automation." />
            {canEdit && (
              <ActionForm action={addNoteAction} resetOnSuccess className="flex gap-2 border-b border-line p-4">
                {hidden}
                <label htmlFor="note-body" className="sr-only">
                  Add a note
                </label>
                <Input id="note-body" name="body" placeholder="Add a note…" required />
                <SubmitButton>Add</SubmitButton>
              </ActionForm>
            )}
            <ol className="divide-y divide-line">
              {data.timeline.map((a) => (
                <li key={a.id} className="flex gap-3 px-5 py-3 text-sm">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.type === "note" ? "bg-gold" : a.actorType === "automation" ? "bg-info" : a.actorType === "client" ? "bg-success" : "bg-line-strong"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className={a.type === "note" ? "whitespace-pre-wrap" : ""}>{a.summary}</p>
                    <p className="text-xs text-muted">
                      {a.actorName ?? a.actorEmail ?? (a.actorType === "client" ? "Client" : a.actorType === "automation" ? "Automation" : a.actorType === "ai" ? "AI" : "System")} ·{" "}
                      {formatInTz(a.createdAt, tz, "d MMM yyyy, h:mm a")}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Details" />
            <ActionForm action={updateLeadAction} className="space-y-3 p-5">
              {hidden}
              <fieldset disabled={!canEdit} className="space-y-3">
                <Field label="Contact name" htmlFor="contactName">
                  <Input id="contactName" name="contactName" defaultValue={lead.contactName} />
                </Field>
                <Field label="Partner's name" htmlFor="partnerName">
                  <Input id="partnerName" name="partnerName" defaultValue={lead.partnerName ?? ""} />
                </Field>
                <Field label="Phone" htmlFor="phone-ro" hint="Phone numbers can't be edited; add a new lead for a different number.">
                  <Input id="phone-ro" value={lead.phone} readOnly disabled />
                </Field>
                <Field label="Email" htmlFor="email">
                  <Input id="email" name="email" type="email" defaultValue={lead.email ?? ""} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Event type" htmlFor="eventType">
                    <Select id="eventType" name="eventType" defaultValue={lead.eventType}>
                      {EVENT_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Event date" htmlFor="eventDate">
                    <Input id="eventDate" name="eventDate" type="date" defaultValue={lead.eventDate ?? ""} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="City" htmlFor="city">
                    <Input id="city" name="city" defaultValue={lead.city ?? ""} />
                  </Field>
                  <Field label="Venue" htmlFor="venue">
                    <Input id="venue" name="venue" defaultValue={lead.venue ?? ""} />
                  </Field>
                </div>
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium text-ink-soft">Services</legend>
                  <div className="space-y-1">
                    {data.services.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="serviceIds" value={s.id} defaultChecked={lead.serviceIds.includes(s.id)} className="accent-[var(--color-gold)]" /> {s.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Source" htmlFor="source">
                    <Select id="source" name="source" defaultValue={lead.source}>
                      {LEAD_SOURCES.map((s) => (
                        <option key={s} value={s}>
                          {LEAD_SOURCE_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Priority" htmlFor="priority">
                    <Select id="priority" name="priority" defaultValue={lead.priority ?? ""}>
                      <option value="">Not set</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </Select>
                  </Field>
                </div>
                <Field label="Budget range" htmlFor="budgetRange">
                  <Input id="budgetRange" name="budgetRange" defaultValue={lead.budgetRange ?? ""} />
                </Field>
                <Field label="Preferred channel" htmlFor="preferredChannel">
                  <Select id="preferredChannel" name="preferredChannel" defaultValue={lead.preferredChannel}>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="phone">Phone</option>
                    <option value="email">Email</option>
                    <option value="any">Any</option>
                  </Select>
                </Field>
                <Field label="Next action" htmlFor="nextAction">
                  <Input id="nextAction" name="nextAction" defaultValue={lead.nextAction ?? ""} placeholder="e.g. Send portfolio" />
                </Field>
                <Field label="Next action by" htmlFor="nextActionAt">
                  <Input id="nextActionAt" name="nextActionAt" type="datetime-local" defaultValue={lead.nextActionAt ? formatInTz(lead.nextActionAt, tz, "yyyy-MM-dd'T'HH:mm") : ""} />
                </Field>
                <Field label={`Quotation amount (${ctx.studio.currency})`} htmlFor="quotationAmount" name="quotationAmount" hint="Set automatically when a quotation is sent.">
                  <Input id="quotationAmount" name="quotationAmount" inputMode="decimal" defaultValue={minorToInput(lead.quotationAmountMinor)} />
                </Field>
                {canEdit && <SubmitButton className="w-full">Save details</SubmitButton>}
              </fieldset>
            </ActionForm>
            {(lead.message || Object.keys(lead.preferences).length > 0) && (
              <div className="border-t border-line p-5 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">From the enquiry</p>
                {lead.preferences.photography && <p className="mt-1"><strong>Photography:</strong> {lead.preferences.photography}</p>}
                {lead.preferences.cinematography && <p className="mt-1"><strong>Film:</strong> {lead.preferences.cinematography}</p>}
                {lead.message && <p className="mt-1 whitespace-pre-wrap text-ink-soft">{lead.message}</p>}
                {serviceNames.length > 0 && <p className="mt-1 text-xs text-muted">Requested: {serviceNames.join(", ")}</p>}
              </div>
            )}
          </Card>

          <Card className="space-y-4 p-5">
            <ActionForm action={assignLeadAction} className="space-y-2" showMessage={false}>
              {hidden}
              <Field label="Owner" htmlFor="userId">
                <div className="flex gap-2">
                  <Select id="userId" name="userId" defaultValue={lead.assignedTo ?? ""} disabled={!canEdit}>
                    <option value="">Unassigned</option>
                    {data.members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.fullName ?? m.email}
                      </option>
                    ))}
                  </Select>
                  {canEdit && <SubmitButton variant="secondary">Save</SubmitButton>}
                </div>
              </Field>
            </ActionForm>
            <ActionForm action={setTagsAction} className="space-y-2" showMessage={false}>
              {hidden}
              <Field label="Tags" htmlFor="tags" hint="Comma separated">
                <div className="flex gap-2">
                  <Input id="tags" name="tags" defaultValue={lead.tags.join(", ")} disabled={!canEdit} />
                  {canEdit && <SubmitButton variant="secondary">Save</SubmitButton>}
                </div>
              </Field>
            </ActionForm>
          </Card>

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <CalendarCheck size={16} className="text-gold" /> Follow-ups
                </span>
              }
            />
            {data.tasks.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted">No tasks yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.tasks.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-2 px-5 py-3 text-sm">
                    <div>
                      <p className={t.status !== "open" ? "text-muted line-through" : "font-medium"}>{t.title}</p>
                      <p className="text-xs text-muted">
                        {TASK_TYPE_LABELS[t.type]} · {formatInTz(t.dueAt, tz, "d MMM, h:mm a")}
                        {t.createdByType === "automation" ? " · automation" : ""}
                      </p>
                    </div>
                    {canEdit && t.status === "open" && (
                      <ActionForm action={setTaskStatusAction} showMessage={false}>
                        <input type="hidden" name="taskId" value={t.id} />
                        <input type="hidden" name="status" value="done" />
                        <SubmitButton size="sm" variant="secondary">
                          Done
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <FileText size={16} className="text-gold" /> Quotations
                </span>
              }
              action={canEdit ? <ButtonLink href={`/quotations/new?leadId=${lead.id}`} size="sm">New</ButtonLink> : undefined}
            />
            {data.quotes.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted">No quotations yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.quotes.map((q) => (
                  <li key={q.id}>
                    <Link href={`/quotations/${q.id}`} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-sand/40">
                      <span>
                        <span className="font-mono text-xs">{q.number}</span>
                        <span className="block font-medium">{formatMoney(q.totalMinor, q.currency)}</span>
                      </span>
                      <Badge tone={q.status === "accepted" ? "success" : q.status === "rejected" || q.status === "expired" ? "neutral" : "gold"}>{q.status}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5 text-sm">
            <p className="flex items-center gap-2 font-semibold">
              <ShieldAlert size={16} className="text-gold" /> Consent &amp; communication
            </p>
            <p className="mt-2 text-ink-soft">
              {lead.optedOut ? "Opted out – no messages will be sent." : lead.consentContact ? `Consent recorded${lead.consentAt ? ` on ${formatInTz(lead.consentAt, tz, "d MMM yyyy")}` : ""}.` : "No consent recorded – messages cannot be sent."}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {data.consentRows.slice(0, 4).map((c) => (
                <li key={c.id}>
                  {c.granted ? "Granted" : "Withdrawn"} via {c.source.replace(/_/g, " ")} · {formatInTz(c.createdAt, tz, "d MMM yyyy")}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="mt-3">
                {lead.optedOut ? (
                  <ConfirmAction action={optInAction} label="Re-record consent" title="Re-record consent" confirmVariant="primary" confirmLabel="Save consent" hidden={{ leadId: lead.id }} description="Only do this if the client has clearly asked to hear from you again.">
                    <Input name="note" placeholder="How did the client confirm? (required)" aria-label="How the client confirmed consent" required />
                  </ConfirmAction>
                ) : (
                  <ConfirmAction action={optOutAction} label="Record opt-out" size="sm" title="Record an opt-out?" confirmLabel="Record opt-out" hidden={{ leadId: lead.id, source: "staff" }} description="All pending messages for this client will be cancelled and no further messages will be sent." />
                )}
              </div>
            )}
          </Card>

          {isAdmin && (
            <Card className="border-danger/20 p-5 text-sm">
              <p className="font-semibold text-danger">Delete lead</p>
              <p className="mt-1 text-xs text-muted">Permanently removes this lead, its messages, tasks and quotations. This is recorded in the audit log.</p>
              <div className="mt-3">
                <ConfirmAction action={deleteLeadAction} label="Delete lead…" size="sm" variant="danger" title="Delete this lead permanently?" confirmLabel="Delete permanently" hidden={{ leadId: lead.id }}>
                  <Input name="confirm" placeholder="Type DELETE to confirm" aria-label="Type DELETE to confirm" required />
                </ConfirmAction>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
