"use client";

import { createContext, useContext } from "react";
import type { ActionState } from "@/lib/action-state";

export const FormStateContext = createContext<ActionState>({});
export const useFormState = () => useContext(FormStateContext);
