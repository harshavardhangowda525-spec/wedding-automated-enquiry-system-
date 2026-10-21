import { and, count, eq, isNull, or } from "drizzle-orm";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction, switchStudioAction } from "@/app/actions/auth";
import { AppNav, NotificationsBell } from "@/components/client/app-nav";
import { Badge, Logo } from "@/components/ui";
import { requireStudio } from "@/server/auth/context";
import { withStudio } from "@/server/db/client";
import { messages, notifications } from "@/server/db/schema";
import { isDemoMode } from "@/server/env";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireStudio();
  const [approvals, unread] = await withStudio(ctx.studio.id, async (tx) => {
    const [a] = await tx.select({ n: count() }).from(messages).where(and(eq(messages.studioId, ctx.studio.id), eq(messages.status, "awaiting_approval")));
    const [u] = await tx
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.studioId, ctx.studio.id), isNull(notifications.readAt), or(isNull(notifications.userId), eq(notifications.userId, ctx.user.id))));
    return [Number(a.n), Number(u.n)];
  });
  const demo = isDemoMode() || ctx.studio.isDemo;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="hidden border-r border-line bg-sand/60 lg:flex lg:flex-col lg:gap-6 lg:px-3 lg:py-5">
        <Link href="/dashboard" className="px-3">
          <Logo />
        </Link>
        <AppNav approvals={approvals} isPlatformAdmin={ctx.user.isPlatformAdmin} />
        <div className="mt-auto px-3 text-[11px] leading-relaxed text-muted">
          WeddingFlow AI
          <br />
          by Infinity Web &amp; Apps
        </div>
      </aside>
      <div className="min-w-0">
        {demo && (
          <div className="border-b border-warning/20 bg-warning-soft px-4 py-1.5 text-center text-xs font-medium text-warning">
            Demo mode — messages are simulated (“Demo — not sent”) and sample records are not real customers.
          </div>
        )}
        {ctx.studio.automationPaused && (
          <div className="border-b border-danger/20 bg-danger-soft px-4 py-1.5 text-center text-xs font-medium text-danger">
            Automation is paused for this studio. <Link href="/automations" className="underline">Manage</Link>
          </div>
        )}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-ivory/90 px-4 backdrop-blur lg:px-8">
          <div className="lg:hidden">
            <AppNav approvals={approvals} isPlatformAdmin={ctx.user.isPlatformAdmin} />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {ctx.memberships.length > 1 ? (
              <form action={switchStudioAction} className="flex items-center gap-2">
                <label htmlFor="studio-switch" className="sr-only">
                  Active studio
                </label>
                <select id="studio-switch" name="studioId" defaultValue={ctx.studio.id} className="h-9 max-w-[14rem] truncate rounded-lg border border-line bg-white px-2 text-sm">
                  {ctx.memberships.map((m) => (
                    <option key={m.studio.id} value={m.studio.id}>
                      {m.studio.name}
                    </option>
                  ))}
                </select>
                <button className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs">Switch</button>
              </form>
            ) : (
              <span className="truncate text-sm font-semibold text-ink">{ctx.studio.name}</span>
            )}
            {ctx.studio.isDemo && <Badge tone="warning">Sample studio</Badge>}
          </div>
          <NotificationsBell count={unread} />
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight">{ctx.user.fullName ?? ctx.user.email}</p>
            <p className="text-xs capitalize leading-tight text-muted">{ctx.role}</p>
          </div>
          <form action={signOutAction}>
            <button className="rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-sand hover:text-ink">Sign out</button>
          </form>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
