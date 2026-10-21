import "server-only";
import { eq } from "drizzle-orm";
import type { Queryable } from "@/server/db/client";
import { activities, auditLogs, leads } from "@/server/db/schema";
import type { ServiceContext } from "@/server/auth/context";

export async function recordActivity(
  svc: Pick<ServiceContext, "tx" | "studioId" | "userId" | "actorType">,
  input: { leadId?: string | null; type: string; summary: string; data?: Record<string, unknown>; touchLead?: boolean },
) {
  await svc.tx.insert(activities).values({
    studioId: svc.studioId,
    leadId: input.leadId ?? null,
    actorType: svc.actorType,
    actorId: svc.userId,
    type: input.type,
    summary: input.summary.slice(0, 500),
    data: input.data ?? {},
  });
  if (input.leadId && input.touchLead !== false) {
    await svc.tx.update(leads).set({ lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, input.leadId));
  }
}

export async function audit(
  q: Queryable,
  input: {
    studioId: string | null;
    actorUserId: string | null;
    actorType: "user" | "system" | "automation" | "client" | "ai" | "platform_admin";
    action: string;
    targetType?: string;
    targetId?: string;
    ipHash?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await q.insert(auditLogs).values({
    studioId: input.studioId,
    actorUserId: input.actorUserId,
    actorType: input.actorType,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    ipHash: input.ipHash ?? null,
    metadata: input.metadata ?? {},
  });
}
