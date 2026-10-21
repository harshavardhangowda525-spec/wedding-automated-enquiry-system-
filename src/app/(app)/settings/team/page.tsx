import { changeRoleAction, inviteMemberAction, removeMemberAction, revokeInviteAction } from "@/app/actions/settings";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/client/forms";
import { Badge, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { MEMBER_ROLES } from "@/lib/domain";
import { formatInTz } from "@/lib/time";
import { inStudio } from "@/server/auth/context";
import { listTeam } from "@/server/services/settings";

export const metadata = { title: "Team" };

const ROLE_HELP: Record<string, string> = {
  owner: "Everything, including integrations, data export and retention",
  admin: "Settings, automations, team and lead export",
  staff: "Work leads, tasks, messages and quotations",
  viewer: "Read-only access",
};

export default async function TeamSettings() {
  const { team, ctx } = await inStudio("admin", async (svc, ctx) => ({ team: await listTeam(svc), ctx }));
  const tz = ctx.studio.timezone;
  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Members" />
        <ul className="divide-y divide-line">
          {team.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div>
                <p className="font-medium">
                  {m.fullName ?? m.email} {m.userId === ctx.user.id && <Badge>You</Badge>}
                </p>
                <p className="text-xs text-muted">{m.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <ActionForm action={changeRoleAction} showMessage={false} className="flex items-center gap-2">
                  <input type="hidden" name="memberId" value={m.id} />
                  <Select name="role" defaultValue={m.role} aria-label={`Role for ${m.email}`} className="h-8 w-28">
                    {MEMBER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </Select>
                  <SubmitButton size="sm" variant="secondary">
                    Save
                  </SubmitButton>
                </ActionForm>
                {m.role !== "owner" && m.userId !== ctx.user.id && (
                  <ConfirmAction action={removeMemberAction} label="Remove" size="sm" variant="ghost" title={`Remove ${m.email}?`} description="They lose access immediately. Their leads become unassigned." confirmLabel="Remove" hidden={{ memberId: m.id }} />
                )}
              </div>
            </li>
          ))}
        </ul>
        {team.invites.length > 0 && (
          <>
            <CardHeader title="Invitations" />
            <ul className="divide-y divide-line">
              {team.invites.map((i) => (
                <li key={i.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span>
                    {i.email} <Badge>{i.role}</Badge> {i.acceptedAt ? <Badge tone="success">Joined {formatInTz(i.acceptedAt, tz, "d MMM")}</Badge> : <Badge tone="warning">Pending</Badge>}
                  </span>
                  {!i.acceptedAt && (
                    <ActionForm action={revokeInviteAction} showMessage={false}>
                      <input type="hidden" name="inviteId" value={i.id} />
                      <SubmitButton size="sm" variant="ghost">
                        Revoke
                      </SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Invite a team member</h2>
        <p className="mt-1 text-xs text-muted">They join this studio automatically when they sign up or sign in with this email. No email is sent by WeddingFlow AI – share the sign-up link yourself.</p>
        <ActionForm action={inviteMemberAction} resetOnSuccess className="mt-4 space-y-3">
          <Field label="Email" htmlFor="invite-email" name="email">
            <Input id="invite-email" name="email" type="email" required />
          </Field>
          <Field label="Role" htmlFor="invite-role">
            <Select id="invite-role" name="role" defaultValue="staff">
              {MEMBER_ROLES.filter((r) => r !== "owner" || ctx.role === "owner").map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <ul className="space-y-1 text-xs text-muted">
            {Object.entries(ROLE_HELP).map(([r, h]) => (
              <li key={r}>
                <strong className="capitalize text-ink-soft">{r}:</strong> {h}
              </li>
            ))}
          </ul>
          <SubmitButton>Invite</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
