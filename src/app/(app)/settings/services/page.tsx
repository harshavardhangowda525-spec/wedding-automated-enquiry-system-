import { deleteServiceAction, saveServiceAction } from "@/app/actions/settings";
import { ActionForm, DialogButton, SubmitButton } from "@/components/client/forms";
import { Badge, Card, CardHeader, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { SERVICE_CATEGORIES, SERVICE_UNITS, SERVICE_UNIT_LABELS } from "@/lib/domain";
import { formatMoney, minorToInput } from "@/lib/money";
import { inStudio } from "@/server/auth/context";
import { listServices } from "@/server/services/settings";

export const metadata = { title: "Services & prices" };

type Svc = Awaited<ReturnType<typeof listServices>>[number];

function ServiceForm({ service, currency }: { service?: Svc; currency: string }) {
  return (
    <ActionForm action={saveServiceAction} className="space-y-4">
      {service && <input type="hidden" name="serviceId" value={service.id} />}
      <Field label="Name" htmlFor={`n-${service?.id ?? "new"}`} name="name">
        <Input id={`n-${service?.id ?? "new"}`} name="name" defaultValue={service?.name} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Category" htmlFor={`c-${service?.id ?? "new"}`}>
          <Select id={`c-${service?.id ?? "new"}`} name="category" defaultValue={service?.category ?? "photography"}>
            {SERVICE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace("_", " ")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Unit" htmlFor={`u-${service?.id ?? "new"}`}>
          <Select id={`u-${service?.id ?? "new"}`} name="unit" defaultValue={service?.unit ?? "per_event"}>
            {SERVICE_UNITS.map((u) => (
              <option key={u} value={u}>
                {SERVICE_UNIT_LABELS[u]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Price (${currency})`} htmlFor={`p-${service?.id ?? "new"}`} name="price" hint="Blank = price on request">
          <Input id={`p-${service?.id ?? "new"}`} name="price" inputMode="decimal" defaultValue={minorToInput(service?.priceMinor)} />
        </Field>
      </div>
      <Field label="Description" htmlFor={`d-${service?.id ?? "new"}`}>
        <Textarea id={`d-${service?.id ?? "new"}`} name="description" rows={2} defaultValue={service?.description ?? ""} />
      </Field>
      <div className="flex flex-wrap gap-5">
        <Checkbox name="active" defaultChecked={service?.active ?? true} label="Active" />
        <Checkbox name="showOnForm" defaultChecked={service?.showOnForm ?? true} label="Show on enquiry form" />
      </div>
      <SubmitButton>Save service</SubmitButton>
    </ActionForm>
  );
}

export default async function ServicesSettings() {
  const { services, ctx } = await inStudio("admin", async (svc, ctx) => ({ services: await listServices(svc), ctx }));
  const cur = ctx.studio.currency;
  return (
    <Card className="max-w-4xl">
      <CardHeader
        title="Services & prices"
        description="Quotations and AI drafts only ever use these prices. Services without a price are shown as “price on request”."
        action={
          <DialogButton label="Add service" title="Add service" variant="primary" size="sm">
            <ServiceForm currency={cur} />
          </DialogButton>
        }
      />
      <ul className="divide-y divide-line">
        {services.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div>
              <p className="font-medium">
                {s.name} {!s.active && <Badge>Inactive</Badge>} {s.active && !s.showOnForm && <Badge tone="info">Hidden from form</Badge>}
              </p>
              <p className="text-xs text-muted">
                {s.category.replace("_", " ")} · {s.priceMinor === null ? <span className="text-warning">price not set</span> : `${formatMoney(s.priceMinor, cur)} ${SERVICE_UNIT_LABELS[s.unit as keyof typeof SERVICE_UNIT_LABELS] ?? ""}`}
              </p>
            </div>
            <div className="flex gap-2">
              <DialogButton label="Edit" title={`Edit ${s.name}`} size="sm">
                <ServiceForm service={s} currency={cur} />
              </DialogButton>
              {s.active && (
                <ActionForm action={deleteServiceAction} showMessage={false}>
                  <input type="hidden" name="serviceId" value={s.id} />
                  <SubmitButton size="sm" variant="ghost">
                    Deactivate
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
