import Link from "next/link";
import { redirect } from "next/navigation";
import { signInAction } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { Field, Input } from "@/components/ui";
import { getCurrentUser } from "@/server/auth/context";
import { AuthShell } from "../auth-shell";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your studio workspace." footer={<>New to WeddingFlow AI? <Link className="font-medium text-gold-strong hover:underline" href="/register">Create a studio account</Link></>}>
      <ActionForm action={signInAction} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className="w-full" pendingText="Signing in…">
          Sign in
        </SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
