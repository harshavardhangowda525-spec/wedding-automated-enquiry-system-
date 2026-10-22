import type { ReactNode } from "react";
import Link from "next/link";
import { Alert, Logo } from "@/components/ui";
import { authMode } from "@/server/auth/session";

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  const mode = authMode();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ivory px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex justify-center">
          <Logo />
        </Link>
        <div className="rounded-2xl border border-line bg-white p-7 shadow-sm">
          <h1 className="font-display text-3xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
          {mode === "local_demo" && (
            <Alert tone="warning" className="mt-4" title="Demo login">
              Supabase Auth is not configured, so this demo environment uses a local login. Production mode requires Supabase.
            </Alert>
          )}
          {mode === "unconfigured" && (
            <Alert tone="danger" className="mt-4" title="Authentication is not configured">
              Set SUPABASE_URL and SUPABASE_ANON_KEY.
            </Alert>
          )}
          <div className="mt-6">{children}</div>
        </div>
        <div className="mt-5 text-center text-sm text-muted">{footer}</div>
      </div>
    </div>
  );
}
