"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { chatSubmitAction, chatTurnAction } from "@/app/actions/chat";
import { buttonClass, cn, inputClass } from "@/components/ui";
import { EMPTY_CHAT_FIELDS, OPTIONAL_CHAT_STEPS, type ChatFields, type ChatMessage, type ChatStep } from "@/lib/chat-intake";
import { COUNTRY_CODES } from "@/lib/phone";

type Service = { id: string; name: string; description: string | null };

const prettyDate = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : iso;

export function EnquiryChat({
  slug,
  formToken,
  studioName,
  brandColor,
  opening,
  services,
  eventTypes,
  budgetRanges,
  aiOn,
}: {
  slug: string;
  formToken: string;
  studioName: string;
  brandColor: string;
  opening: string;
  services: Service[];
  eventTypes: readonly string[];
  budgetRanges: string[];
  aiOn: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "bot", text: opening }]);
  const [fields, setFields] = useState<ChatFields>(EMPTY_CHAT_FIELDS);
  const [step, setStep] = useState<ChatStep>("contactName");
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);
  useEffect(() => {
    if (!pending) inputRef.current?.focus();
  }, [pending, step]);

  function send(display: string, input: Parameters<typeof chatTurnAction>[2]) {
    setError(null);
    setMessages((m) => [...m, { role: "client", text: display }]);
    setText("");
    startTransition(async () => {
      const res = await chatTurnAction(slug, fields, input);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setFields(res.fields);
      setStep(res.step);
      if (res.step === "services") setPicked(res.fields.serviceIds);
      setMessages((m) => [...m, ...res.bot.map((t) => ({ role: "bot" as const, text: t }))]);
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await chatSubmitAction(slug, fields, formToken);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/enquire/${slug}/thanks?ref=${encodeURIComponent(res.reference)}${res.whatsappQueued ? "&wa=1" : ""}`);
    });
  }

  function restart() {
    setFields(EMPTY_CHAT_FIELDS);
    setStep("contactName");
    setPicked([]);
    setError(null);
    setMessages([{ role: "bot", text: opening }]);
  }

  const optional = OPTIONAL_CHAT_STEPS.includes(step);
  const serviceNames = services.filter((s) => fields.serviceIds.includes(s.id)).map((s) => s.name);
  const textSteps: ChatStep[] = ["contactName", "phone", "eventType", "eventDate", "city", "services", "partnerName", "email", "budgetRange", "message"];

  return (
    <div className="flex h-[min(44rem,calc(100dvh-10rem))] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3" style={{ borderTop: `3px solid ${brandColor}` }}>
        <div className="flex h-9 w-9 items-center justify-center rounded-full font-display text-lg text-white" style={{ background: brandColor }} aria-hidden>
          {studioName[0]}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{studioName}</p>
          <p className="text-xs text-muted">Enquiry assistant · usually takes 2 minutes</p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto bg-ivory/60 px-4 py-4" aria-live="polite" aria-label="Conversation">
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "client" ? "justify-end" : "justify-start")}>
            <p
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                m.role === "client" ? "rounded-br-sm text-white" : "rounded-bl-sm border border-line bg-white text-ink",
              )}
              style={m.role === "client" ? { background: brandColor } : undefined}
            >
              {m.text}
            </p>
          </div>
        ))}
        {step === "confirm" && !pending && (
          <div className="rounded-xl border border-line bg-white p-4 text-sm">
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-muted">Name</dt>
              <dd>{fields.contactName}{fields.partnerName ? ` & ${fields.partnerName}` : ""}</dd>
              <dt className="text-muted">Phone</dt>
              <dd>{fields.phone}</dd>
              {fields.email && (<><dt className="text-muted">Email</dt><dd>{fields.email}</dd></>)}
              <dt className="text-muted">Event</dt>
              <dd>{fields.eventType}</dd>
              <dt className="text-muted">Date</dt>
              <dd>{fields.dateKnown === "yes" && fields.eventDate ? prettyDate(fields.eventDate) : "Not decided yet"}</dd>
              <dt className="text-muted">Location</dt>
              <dd>{[fields.city, fields.venue].filter(Boolean).join(" · ")}</dd>
              <dt className="text-muted">Services</dt>
              <dd>{serviceNames.join(", ")}</dd>
              {fields.budgetRange && (<><dt className="text-muted">Budget</dt><dd>{fields.budgetRange}</dd></>)}
              {fields.message && (<><dt className="text-muted">Notes</dt><dd className="whitespace-pre-wrap">{fields.message}</dd></>)}
            </dl>
          </div>
        )}
        {pending && (
          <div className="flex justify-start" aria-label="Assistant is typing">
            <span className="flex gap-1 rounded-2xl rounded-bl-sm border border-line bg-white px-3.5 py-3">
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${d * 120}ms` }} />
              ))}
            </span>
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="space-y-2 border-t border-line bg-white p-3">
        {error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        {step === "eventType" && (
          <div className="flex flex-wrap gap-2">
            {eventTypes.map((t) => (
              <button key={t} type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => send(t, { choice: t })}>
                {t}
              </button>
            ))}
          </div>
        )}

        {step === "eventDate" && (
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" aria-label="Event date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(inputClass, "h-9 w-auto")} />
            <button type="button" disabled={pending || !date} className={buttonClass("primary", "sm")} onClick={() => send(prettyDate(date), { date })}>
              Use this date
            </button>
            <button type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => send("Not decided yet", { date: "not_decided" })}>
              Not decided yet
            </button>
          </div>
        )}

        {step === "services" && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Services">
              {services.map((s) => {
                const on = picked.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    disabled={pending}
                    className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors", on ? "border-transparent text-white" : "border-line-strong bg-white text-ink hover:bg-sand")}
                    style={on ? { background: brandColor } : undefined}
                    onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id]))}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={pending || picked.length === 0}
              className={buttonClass("primary", "sm")}
              onClick={() => send(services.filter((s) => picked.includes(s.id)).map((s) => s.name).join(", "), { choices: picked })}
            >
              Done{picked.length ? ` (${picked.length})` : ""}
            </button>
          </div>
        )}

        {step === "budgetRange" && (
          <div className="flex flex-wrap gap-2">
            {budgetRanges.map((b) => (
              <button key={b} type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => send(b, { choice: b })}>
                {b}
              </button>
            ))}
          </div>
        )}

        {step === "consent" && (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} className={buttonClass("gold", "sm")} onClick={() => send("I agree", { choice: "agree" })}>
              I agree
            </button>
            <button type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => send("Not now", { choice: "decline" })}>
              Not now
            </button>
          </div>
        )}

        {step === "confirm" ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} className={buttonClass("gold")} onClick={submit}>
              Send enquiry
            </button>
            <button type="button" disabled={pending} className={buttonClass("ghost")} onClick={restart}>
              Start over
            </button>
            <p className="w-full text-[11px] text-muted">Sending this enquiry does not reserve your date or confirm a booking.</p>
          </div>
        ) : (
          textSteps.includes(step) && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) send(text.trim(), { text: text.trim(), countryCode: fields.countryCode });
              }}
            >
              {step === "phone" && (
                <select
                  aria-label="Country code"
                  value={fields.countryCode}
                  onChange={(e) => setFields((f) => ({ ...f, countryCode: e.target.value }))}
                  className={cn(inputClass, "h-10 w-28 shrink-0 px-2")}
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </select>
              )}
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={pending}
                maxLength={1500}
                type={step === "phone" ? "tel" : step === "email" ? "email" : "text"}
                inputMode={step === "phone" ? "tel" : undefined}
                aria-label="Your reply"
                placeholder={aiOn && step === "contactName" ? "Type your name – or tell us everything at once" : "Type your answer…"}
                className={cn(inputClass, "h-10 flex-1")}
              />
              {optional && (
                <button type="button" disabled={pending} className={buttonClass("ghost", "sm")} onClick={() => send("Skip", { skip: true })}>
                  Skip
                </button>
              )}
              <button type="submit" disabled={pending || !text.trim()} className={buttonClass("primary", "md", "px-3")} aria-label="Send">
                <Send size={16} />
              </button>
            </form>
          )
        )}
      </div>
    </div>
  );
}
