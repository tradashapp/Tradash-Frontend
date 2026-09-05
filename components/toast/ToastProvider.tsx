"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ToastViewport } from "./ToastViewport";

export type ToastType = "success" | "error" | "info" | "loading";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  action?: ToastAction;
  /** ms before auto-dismiss; 0 = sticky (must be dismissed/updated). */
  duration: number;
  /** Celebrate this toast with a confetti burst (profitable closes only). */
  confetti?: boolean;
}

export interface ToastOptions {
  type?: ToastType;
  description?: string;
  action?: ToastAction;
  duration?: number;
  /** Stable id — reuse to UPDATE an existing toast (e.g. loading → success). */
  id?: string;
  /**
   * Fire a confetti burst behind this toast. Reserved for genuinely good news
   * the user earned — a profitable close — so it keeps its meaning.
   */
  confetti?: boolean;
}

interface ToastContextValue {
  /** Show (or update, if `id` is reused) a toast. Returns its id. */
  toast: (title: string, opts?: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3500,
  error: 5000,
  info: 3500,
  loading: 0, // sticky until updated/dismissed
};

const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
    const timer = timers.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timers.current[id];
    }
  }, []);

  const arm = useCallback(
    (id: string, duration: number) => {
      const existing = timers.current[id];
      if (existing) clearTimeout(existing);
      if (duration > 0) {
        timers.current[id] = setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss]
  );

  const toast = useCallback(
    (title: string, opts: ToastOptions = {}) => {
      const type = opts.type ?? "info";
      const id = opts.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const duration = opts.duration ?? DEFAULT_DURATION[type];
      const next: Toast = {
        id,
        type,
        title,
        description: opts.description,
        action: opts.action,
        duration,
        confetti: opts.confetti,
      };

      setToasts((cur) => {
        const idx = cur.findIndex((t) => t.id === id);
        if (idx >= 0) {
          // Update in place (e.g. a loading toast becoming success).
          const copy = cur.slice();
          copy[idx] = next;
          return copy;
        }
        const appended = [...cur, next];
        // Cap the stack; drop the oldest when over the limit.
        return appended.slice(-MAX_VISIBLE);
      });
      arm(id, duration);
      return id;
    },
    [arm]
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // No-op fallback so calling useToast outside the provider never throws.
    return { toast: () => "", dismiss: () => {} };
  }
  return ctx;
}
