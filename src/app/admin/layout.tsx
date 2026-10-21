import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/actions/auth";
import { Badge, Logo } from "@/components/ui";
import { requirePlatformAdmin } from "@/server/auth/context";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requirePlatformAdmin();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-ink text-ivory">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3 lg:px-8">
          <Link href="/admin" className="[&_*]:!text-ivory">
            <Logo />
          </Link>
          <Badge tone="gold">Platform admin</Badge>
          <nav className="flex flex-1 flex-wrap gap-1 text-sm" aria-label="Admin">
            {[
              ["/admin", "Overview"],
              ["/admin/failures", "Failures"],
              ["/admin/ai-usage", "AI usage"],
              ["/admin/audit", "Audit log"],
              ["/dashboard", "Studio app"],
            ].map(([href, label]) => (
              <Link key={href} href={href} className="rounded px-2.5 py-1 text-ivory/80 hover:bg-white/10 hover:text-ivory">
                {label}
              </Link>
            ))}
          </nav>
          <span className="text-xs text-ivory/70">{user.email}</span>
          <form action={signOutAction}>
            <button className="text-xs text-ivory/70 hover:text-ivory">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 lg:px-8">{children}</main>
    </div>
  );
}
