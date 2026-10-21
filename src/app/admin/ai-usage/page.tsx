import { Alert, Badge, Card, PageHeader, td, th } from "@/components/ui";
import { requirePlatformAdmin } from "@/server/auth/context";
import { adminAiUsage } from "@/server/services/admin";

export const metadata = { title: "AI usage (admin)" };

export default async function AdminAiUsage() {
  const user = await requirePlatformAdmin();
  const u = await adminAiUsage(user, 30);
  const totalCost = u.rows.reduce((a, r) => a + (r.estimatedCostUsd ?? 0), 0);
  return (
    <>
      <PageHeader title="AI usage" description="Last 30 days, from recorded API usage (token counts reported by the provider)." />
      {!u.pricingConfigured ? (
        <Alert tone="info" className="mb-4">
          Cost estimates are hidden because AI_PRICE_INPUT_PER_MTOK_USD and AI_PRICE_OUTPUT_PER_MTOK_USD are not set. Set them from your provider&apos;s current pricing to enable estimates.
        </Alert>
      ) : (
        <Alert tone="info" className="mb-4">
          Estimated cost (from configured per-token prices): <strong>${totalCost.toFixed(2)}</strong>. Verify against your provider invoice.
        </Alert>
      )}
      <Card>
        {u.rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">No AI usage recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr>
                  <th className={th}>Studio</th>
                  <th className={th}>Feature</th>
                  <th className={th}>Model</th>
                  <th className={th}>Status</th>
                  <th className={th}>Calls</th>
                  <th className={th}>Input tokens</th>
                  <th className={th}>Output tokens</th>
                  <th className={th}>Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {u.rows.map((r, i) => (
                  <tr key={i}>
                    <td className={td}>{r.studioName ?? "—"}</td>
                    <td className={td}>{r.feature}</td>
                    <td className={`${td} font-mono text-xs`}>{r.model ?? "—"}</td>
                    <td className={td}>
                      <Badge tone={r.status === "ok" ? "success" : "warning"}>{r.status}</Badge>
                    </td>
                    <td className={td}>{r.calls}</td>
                    <td className={td}>{r.inputTokens.toLocaleString()}</td>
                    <td className={td}>{r.outputTokens.toLocaleString()}</td>
                    <td className={td}>{r.estimatedCostUsd === null ? "—" : `$${r.estimatedCostUsd.toFixed(4)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
