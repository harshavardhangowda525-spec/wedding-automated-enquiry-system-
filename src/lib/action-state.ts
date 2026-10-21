export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Monotonic counter so clients can react to each submission. */
  at?: number;
  data?: Record<string, unknown>;
};

export const initialActionState: ActionState = {};
