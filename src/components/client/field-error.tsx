"use client";

import type { ReactNode } from "react";
import { useFormState } from "./form-context";

/** Shows the server-side validation error for `name` from the surrounding ActionForm, or a hint. */
export function FieldError({ name, hint }: { name: string; hint?: ReactNode }) {
  const state = useFormState();
  const message = state.fieldErrors?.[name]?.[0];
  if (message)
    return (
      <p className="text-xs text-danger" role="alert">
        {message}
      </p>
    );
  return hint ? <p className="text-xs text-muted">{hint}</p> : null;
}
