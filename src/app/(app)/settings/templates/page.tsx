import { saveTemplateAction } from "@/app/actions/settings";
import { ActionForm, DialogButton, SubmitButton } from "@/components/client/forms";
import { Alert, Badge, Card, CardHeader, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { inStudio } from "@/server/auth/context";
import { listTemplates } from "@/server/services/settings";

export const metadata = { title: "Message templates" };

type Tpl = Awaited<ReturnType<typeof listTemplates>>[number];

function TemplateForm({ t }: { t?: Tpl }) {
  const k = t?.id ?? "new";
  return (
    <ActionForm action={saveTemplateAction} className="space-y-4">
      {t && <input type="hidden" name="templateId" value={t.id} />}
      <Field label="Name" htmlFor={`tn-${k}`} name="name">
        <Input id={`tn-${k}`} name="name" defaultValue={t?.name} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Channel" htmlFor={`tc-${k}`}>
          <Select id={`tc-${k}`} name="channel" defaultValue={t?.channel ?? "whatsapp"}>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
          </Select>
        </Field>
        <Field label="Purpose" htmlFor={`tp-${k}`}>
          <Select id={`tp-${k}`} name="purpose" defaultValue={t?.purpose ?? "general"}>
            <option value="acknowledgement">Acknowledgement</option>
            <option value="follow_up">Follow-up</option>
            <option value="quotation">Quotation</option>
            <option value="general">General</option>
          </Select>
        </Field>
        <Field label="Language" htmlFor={`tl-${k}`}>
          <Input id={`tl-${k}`} name="language" defaultValue={t?.language ?? "en"} />
        </Field>
      </div>
      <Field label="WhatsApp template name" htmlFor={`tw-${k}`} name="whatsappTemplateName" hint="Exactly as approved in WhatsApp Manager. Placeholders map to {{1}}, {{2}}… in order.">
        <Input id={`tw-${k}`} name="whatsappTemplateName" defaultValue={t?.whatsappTemplateName ?? ""} />
      </Field>
      <Field label="Email subject" htmlFor={`ts-${k}`} name="subject">
        <Input id={`ts-${k}`} name="subject" defaultValue={t?.subject ?? ""} />
      </Field>
      <Field label="Body" htmlFor={`tb-${k}`} name="body" hint="Placeholders: {{contact_name}} {{partner_name}} {{studio_name}} {{reference}} {{event_type}} {{event_date}} {{city}}">
        <Textarea id={`tb-${k}`} name="body" rows={6} defaultValue={t?.body} required />
      </Field>
      <div className="flex flex-wrap gap-5">
        <Checkbox name="active" defaultChecked={t?.active ?? true} label="Active" />
        <Checkbox name="approved" defaultChecked={t?.approved ?? false} label="Approved for automated use (WhatsApp: approved by Meta)" />
      </div>
      <SubmitButton>Save template</SubmitButton>
    </ActionForm>
  );
}

export default async function TemplatesSettings() {
  const templates = await inStudio("admin", (svc) => listTemplates(svc));
  return (
    <div className="max-w-4xl space-y-4">
      <Alert tone="info">
        WhatsApp only allows free-form messages within 24 hours of the client&apos;s last message. Outside that window, sends must use a template approved in WhatsApp Manager. Mark a template “approved” only after Meta has approved it.
      </Alert>
      <Card>
        <CardHeader
          title="Templates"
          action={
            <DialogButton label="New template" title="New template" variant="primary" size="sm">
              <TemplateForm />
            </DialogButton>
          }
        />
        <ul className="divide-y divide-line">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0 max-w-2xl">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {t.name}
                  <Badge tone={t.channel === "whatsapp" ? "success" : "info"}>{t.channel}</Badge>
                  <Badge>{t.purpose.replace("_", " ")}</Badge>
                  {t.approved ? <Badge tone="success">Approved</Badge> : <Badge tone="warning">Not approved</Badge>}
                  {!t.active && <Badge>Inactive</Badge>}
                </p>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{t.body}</p>
              </div>
              <DialogButton label="Edit" title={`Edit ${t.name}`} size="sm">
                <TemplateForm t={t} />
              </DialogButton>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
