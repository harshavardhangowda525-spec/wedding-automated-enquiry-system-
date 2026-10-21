"use client";

import { createContext, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cn } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { FormStateContext } from "./form-context";

export type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

const DialogContext = createContext<(() => void) | null>(null);

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  className,
  disabled,
  name,
  value,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "gold";
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} aria-busy={pending} className={buttonClass(variant, size, className)}>
      {pending && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
      {pending ? (pendingText ?? children) : children}
    </button>
  );
}

export function FormMessage({ state, className }: { state: ActionState; className?: string }) {
  if (state.error)
    return (
      <p role="alert" className={cn("rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger", className)}>
        {state.error}
      </p>
    );
  if (state.ok && state.message)
    return (
      <p role="status" className={cn("rounded-lg border border-success/20 bg-success-soft px-3 py-2 text-sm text-success", className)}>
        {state.message}
      </p>
    );
  return null;
}

/**
 * A form bound to a server action with inline success/error feedback.
 * Children may be a render function receiving the latest state (for field errors).
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  onSuccess,
  showMessage = true,
  id,
}: {
  action: FormAction;
  children: ReactNode | ((state: ActionState) => ReactNode);
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (state: ActionState) => void;
  showMessage?: boolean;
  id?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  const closeDialog = useContext(DialogContext);
  const lastAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state.at && state.at !== lastAt.current) {
      lastAt.current = state.at;
      if (state.ok) {
        if (resetOnSuccess) ref.current?.reset();
        onSuccess?.(state);
        closeDialog?.();
      }
    }
  }, [state, resetOnSuccess, onSuccess, closeDialog]);
  return (
    <FormStateContext value={state}>
      <form ref={ref} action={formAction} className={className} id={id} noValidate>
        {typeof children === "function" ? children(state) : children}
        {showMessage && <FormMessage state={state} className="mt-3" />}
      </form>
    </FormStateContext>
  );
}

/** A button that asks for confirmation in a modal dialog before submitting its action. */
export function ConfirmAction({
  action,
  label,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "secondary",
  confirmVariant = "danger",
  size = "md",
  hidden,
  children,
}: {
  action: FormAction;
  label: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "gold";
  confirmVariant?: "primary" | "danger" | "gold";
  size?: "sm" | "md";
  hidden?: Record<string, string>;
  children?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={buttonClass(variant, size)} onClick={() => dialog.current?.showModal()}>
        {label}
      </button>
      <dialog ref={dialog} className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-white p-0 shadow-xl">
        <ActionForm action={action} onSuccess={() => dialog.current?.close()} className="p-5">
          {Object.entries(hidden ?? {}).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          {description && <div className="mt-2 text-sm text-muted">{description}</div>}
          {children && <div className="mt-4 space-y-3">{children}</div>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={buttonClass("secondary")} onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <SubmitButton variant={confirmVariant}>{confirmLabel}</SubmitButton>
          </div>
        </ActionForm>
      </dialog>
    </>
  );
}

/** Opens content (usually an ActionForm) in a modal dialog; a successful ActionForm inside closes it. */
export function DialogButton({
  label,
  title,
  children,
  variant = "secondary",
  size = "md",
}: {
  label: ReactNode;
  title: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "gold";
  size?: "sm" | "md";
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  return (
    <>
      <button type="button" className={buttonClass(variant, size)} onClick={() => dialog.current?.showModal()}>
        {label}
      </button>
      <dialog ref={dialog} className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl border border-line bg-white p-0 shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button type="button" onClick={close} className="rounded p-1 text-muted hover:bg-sand" aria-label="Close dialog">
            ✕
          </button>
        </div>
        <DialogContext value={close}>
          <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
        </DialogContext>
      </dialog>
    </>
  );
}
