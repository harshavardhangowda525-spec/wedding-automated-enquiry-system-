import Link from "next/link";
import { redirect } from "next/navigation";
import { signUpAction } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { Field, Input } from "@/components/ui";
import { getCurrentUser } from "@/server/auth/context";
import { AuthShell } from "../auth-shell";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <AuthShell title="Create your account" subtitle="Set up WeddingFlow AI for your studio in a few minutes." footer={<>Already have an account? <Link className="font-medium text-gold-strong hover:underline" href="/login">Sign in</Link></>}>
      <ActionForm action={signUpAction} className="space-y-4">
        <Field label="Your name" htmlFor="fullName">
          <Input id="fullName" name="fullName" autoComplete="name" required />
        </Field>
        <Field label="Work email" htmlFor="email" hint="If a studio invited you, use the invited email to join it automatically.">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters.">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <SubmitButton className="w-full" pendingText="Creating account…">
          Create account
        </SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
