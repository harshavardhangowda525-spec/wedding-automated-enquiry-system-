import clsx from "clsx";
import Link from "next/link";
import { FieldError } from "@/components/client/field-error";
import type { ComponentProps, ReactNode } from "react";
import {
  AVAILABILITY_LABELS,
  LEAD_STATUS_LABELS,
  MESSAGE_STATUS_LABELS,
  DEMO_LABEL,
  type AvailabilityState,
  type LeadStatus,
  type MessageStatus,
} from "@/lib/domain";

export function cn(...args: Parameters<typeof clsx>) {
  return clsx(...args);
}

// ---------------------------------------------------------------- buttons

type Variant = "primary" | "secondary" | "ghost" | "danger" | "gold";
type Size = "sm" | "md";

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap",
    size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm",
    variant === "primary" && "bg-ink text-ivory hover:bg-ink-soft",
    variant === "gold" && "bg-gold text-white hover:bg-gold-strong",
    variant === "secondary" && "border border-line-strong bg-white text-ink hover:bg-sand",
    variant === "ghost" && "text-ink-soft hover:bg-sand",
    variant === "danger" && "border border-danger/30 bg-white text-danger hover:bg-danger-soft",
    extra,
  );
}

export function Button({ variant, size, className, ...props }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({ variant, size, className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

// ---------------------------------------------------------------- form controls

export const inputClass =
  "block w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-muted/70 shadow-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20 disabled:bg-sand disabled:text-muted aria-[invalid=true]:border-danger";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(inputClass, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputClass, "min-h-24", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(inputClass, "h-10 pr-8", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
  name,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | string[];
  required?: boolean;
  children: ReactNode;
  className?: string;
  /** Show the ActionForm's server-side error for this field name. Defaults to htmlFor. */
  name?: string;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  const errorKey = name ?? htmlFor;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink-soft">
        {label}
        {required && <span className="ml-0.5 text-gold" aria-hidden>*</span>}
      </label>
      {children}
      {message ? (
        <p className="text-xs text-danger" role="alert">
          {message}
        </p>
      ) : errorKey ? (
        <FieldError name={errorKey} hint={hint} />
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({ label, className, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("flex items-start gap-2.5 text-sm text-ink-soft", className)}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line-strong accent-[var(--color-gold)]" {...props} />
      <span>{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------- layout

export function Card({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(36,33,30,0.04)]", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-wider text-gold">{eyebrow}</div>}
        <h1 className="font-display text-3xl font-semibold leading-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-gold">{icon}</div>}
      <p className="font-display text-xl font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", title, children, className }: { tone?: "info" | "success" | "warning" | "danger"; title?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        tone === "info" && "border-info/20 bg-info-soft text-info",
        tone === "success" && "border-success/20 bg-success-soft text-success",
        tone === "warning" && "border-warning/25 bg-warning-soft text-warning",
        tone === "danger" && "border-danger/20 bg-danger-soft text-danger",
        className,
      )}
    >
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={cn(title && "mt-0.5", "text-[13px] leading-relaxed opacity-90")}>{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- badges

type Tone = "neutral" | "gold" | "success" | "warning" | "danger" | "info";
export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "neutral" && "bg-sand text-ink-soft",
        tone === "gold" && "bg-gold-soft text-gold-strong",
        tone === "success" && "bg-success-soft text-success",
        tone === "warning" && "bg-warning-soft text-warning",
        tone === "danger" && "bg-danger-soft text-danger",
        tone === "info" && "bg-info-soft text-info",
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<LeadStatus, Tone> = {
  new_enquiry: "gold",
  contact_attempted: "warning",
  contacted: "info",
  qualified: "info",
  consultation_scheduled: "info",
  quotation_sent: "gold",
  negotiation: "gold",
  tentative_hold: "warning",
  booking_confirmed: "success",
  won: "success",
  lost: "neutral",
  not_interested: "neutral",
};
export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{LEAD_STATUS_LABELS[status]}</Badge>;
}

const MESSAGE_TONE: Record<MessageStatus, Tone> = {
  draft: "neutral",
  awaiting_approval: "warning",
  queued: "info",
  sending: "info",
  sent: "info",
  delivered: "success",
  failed: "danger",
  cancelled: "neutral",
  skipped: "neutral",
};
export function MessageStatusBadge({ status, isDemo }: { status: MessageStatus; isDemo?: boolean }) {
  if (isDemo && (status === "sent" || status === "delivered")) return <Badge tone="warning">{DEMO_LABEL}</Badge>;
  return <Badge tone={MESSAGE_TONE[status]}>{MESSAGE_STATUS_LABELS[status]}</Badge>;
}

const AVAILABILITY_TONE: Record<AvailabilityState, Tone> = {
  not_checked: "neutral",
  available: "success",
  tentative_hold: "warning",
  unavailable: "danger",
  confirmed_booking: "danger",
};
export function AvailabilityBadge({ state }: { state: AvailabilityState }) {
  return <Badge tone={AVAILABILITY_TONE[state]}>{AVAILABILITY_LABELS[state]}</Badge>;
}

export function QuotationStatusBadge({ status }: { status: "draft" | "approved" | "sent" | "accepted" | "rejected" | "expired" }) {
  const tone: Tone = status === "accepted" ? "success" : status === "rejected" || status === "expired" ? "neutral" : status === "sent" ? "info" : status === "approved" ? "gold" : "warning";
  return <Badge tone={tone}>{status[0].toUpperCase() + status.slice(1)}</Badge>;
}

export function PriorityBadge({ priority }: { priority: "low" | "medium" | "high" | null }) {
  if (!priority) return <span className="text-xs text-muted">—</span>;
  return <Badge tone={priority === "high" ? "danger" : priority === "medium" ? "warning" : "neutral"}>{priority[0].toUpperCase() + priority.slice(1)}</Badge>;
}

export function DemoBadge() {
  return <Badge tone="warning" title="Sample data for demonstrations – not a real customer">Sample</Badge>;
}

// ---------------------------------------------------------------- misc

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 font-display text-3xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">{children}</table>
    </div>
  );
}
export const th = "border-b border-line bg-sand/50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted";
export const td = "border-b border-line px-4 py-3 align-top";

export function Tabs({ items, current }: { items: { href: string; label: string; key: string; count?: number }[]; current: string }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Sections">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === current ? "page" : undefined}
          className={cn(
            "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            item.key === current ? "border-gold text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {item.label}
          {item.count !== undefined && <span className="rounded-full bg-sand px-1.5 text-xs text-ink-soft">{item.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <circle cx="12" cy="16" r="8.5" fill="none" stroke="var(--color-gold)" strokeWidth="2" />
        <circle cx="20" cy="16" r="8.5" fill="none" stroke="var(--color-ink)" strokeWidth="2" />
      </svg>
      <span className="font-display text-xl font-semibold tracking-tight text-ink">
        WeddingFlow <span className="text-gold">AI</span>
      </span>
    </span>
  );
}
