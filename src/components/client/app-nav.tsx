"use client";

import { BarChart3, Bell, CalendarDays, CheckSquare, FileText, LayoutDashboard, Menu, MessageSquare, Settings, Shield, Users, Workflow, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/components/ui";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/tasks", label: "Follow-ups", icon: CheckSquare },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/quotations", label: "Quotations", icon: FileText },
  { href: "/messages", label: "Messages", icon: MessageSquare, badgeKey: "approvals" as const },
  { href: "/automations", label: "Automations", icon: Workflow },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppNav({ approvals, isPlatformAdmin }: { approvals: number; isPlatformAdmin: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const links = (
    <ul className="space-y-0.5">
      {items.map(({ href, label, icon: Icon, badgeKey }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={() => setOpen(false)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-white text-ink shadow-sm ring-1 ring-line" : "text-ink-soft hover:bg-white/70 hover:text-ink",
              )}
            >
              <Icon size={17} className={active ? "text-gold" : "text-muted"} aria-hidden />
              <span className="flex-1">{label}</span>
              {badgeKey && approvals > 0 && (
                <span className="rounded-full bg-gold px-1.5 text-xs font-semibold text-white" aria-label={`${approvals} awaiting approval`}>
                  {approvals}
                </span>
              )}
            </Link>
          </li>
        );
      })}
      {isPlatformAdmin && (
        <li className="pt-3">
          <Link href="/admin" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-white/70">
            <Shield size={17} className="text-muted" aria-hidden /> Platform admin
          </Link>
        </li>
      )}
    </ul>
  );
  return (
    <>
      <button type="button" className="rounded-lg p-2 text-ink-soft hover:bg-sand lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation" aria-expanded={open}>
        <Menu size={20} />
      </button>
      <nav aria-label="Main" className="hidden lg:block">
        {links}
      </nav>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 bg-sand p-4 shadow-xl">
            <div className="mb-4 flex justify-end">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-white" aria-label="Close navigation">
                <X size={18} />
              </button>
            </div>
            {links}
          </div>
        </div>
      )}
    </>
  );
}

export function NotificationsBell({ count }: { count: number }) {
  return (
    <Link href="/dashboard#notifications" className="relative rounded-lg p-2 text-ink-soft hover:bg-sand" aria-label={`Notifications${count ? ` (${count} unread)` : ""}`}>
      <Bell size={19} />
      {count > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-gold" />}
    </Link>
  );
}
