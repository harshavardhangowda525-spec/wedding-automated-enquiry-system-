"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

const TABS = [
  ["/settings", "Studio profile"],
  ["/settings/enquiry-form", "Enquiry form"],
  ["/settings/services", "Services & prices"],
  ["/settings/templates", "Message templates"],
  ["/settings/policies", "Follow-up & booking"],
  ["/settings/team", "Team"],
  ["/settings/integrations", "Integrations"],
  ["/settings/data", "AI, data & privacy"],
] as const;

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Settings sections">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", pathname === href ? "border-gold text-ink" : "border-transparent text-muted hover:text-ink")}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
