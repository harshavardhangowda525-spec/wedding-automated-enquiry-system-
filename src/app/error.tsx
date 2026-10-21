"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const forbidden = /permission|restricted/i.test(error.message);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="font-display text-3xl font-semibold">{forbidden ? "You don't have access to this" : "Something went wrong"}</h1>
      <p className="max-w-md text-sm text-muted">{forbidden ? "Ask a studio owner or admin if you need access." : "The error has been logged. Please try again."}</p>
      {error.digest && <p className="font-mono text-xs text-muted">Reference: {error.digest}</p>}
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
