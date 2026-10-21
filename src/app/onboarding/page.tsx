import { redirect } from "next/navigation";
import { createStudioAction, signOutAction } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { Field, Input, Logo, Select } from "@/components/ui";
import { getMemberships, requireUser } from "@/server/auth/context";
import { env } from "@/server/env";

export const metadata = { title: "Set up your studio" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const memberships = await getMemberships(user.id);
  if (memberships.length > 0) redirect("/dashboard");
  const origin = env().APP_URL.replace(/\/$/, "");
  return (
    <div className="min-h-dvh bg-ivory px-4 py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex items-center justify-between">
          <Logo />
          <form action={signOutAction}>
            <button className="text-sm text-muted hover:text-ink">Sign out</button>
          </form>
        </div>
        <div className="rounded-2xl border border-line bg-white p-7 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-gold">Step 1 of 2</p>
          <h1 className="mt-1 font-display text-3xl font-semibold">Tell us about your studio</h1>
          <p className="mt-1 text-sm text-muted">We&apos;ll set up your enquiry form, a starter service list (you add your own prices) and gentle default follow-up rules you can edit.</p>
          <ActionForm action={createStudioAction} className="mt-6 space-y-4">
                <Field label="Studio name" htmlFor="name" required>
                  <Input id="name" name="name" placeholder="Aurora Wedding Films" required />
                </Field>
                <Field label="Enquiry link" htmlFor="slug" hint={`Your public form will be at ${origin}/enquire/your-link. Leave blank to use the studio name.`}>
                  <div className="flex items-center rounded-lg border border-line-strong bg-sand/50 pl-3 text-sm text-muted focus-within:ring-2 focus-within:ring-gold/20">
                    <span className="whitespace-nowrap">/enquire/</span>
                    <input id="slug" name="slug" className="h-10 w-full rounded-r-lg border-0 bg-white px-2 text-ink focus:outline-none" placeholder="aurora-films" pattern="[a-z0-9-]*" />
                  </div>
                </Field>
                <Field label="What do you offer?" htmlFor="businessType" required>
                  <Select id="businessType" name="businessType" defaultValue="photo_video">
                    <option value="photo_video">Photography &amp; cinematography</option>
                    <option value="photography">Photography</option>
                    <option value="cinematography">Cinematography</option>
                  </Select>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="City" htmlFor="city">
                    <Input id="city" name="city" placeholder="Bengaluru" />
                  </Field>
                  <Field label="Studio phone" htmlFor="phone">
                    <Input id="phone" name="phone" placeholder="+91 98765 43210" />
                  </Field>
                </div>
                <Field label="Studio email" htmlFor="email">
                  <Input id="email" name="email" type="email" defaultValue={user.email} />
                </Field>
                <SubmitButton className="w-full" variant="gold" pendingText="Creating studio…">
                  Create studio
                </SubmitButton>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
