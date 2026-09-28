"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastAction = { label: string; run: () => void };
type ToastFn = (msg: string, action?: ToastAction) => void;

const Ctx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [t, setT] = useState<{ msg: string; action?: ToastAction; show: boolean }>({ msg: "", show: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback<ToastFn>((msg, action) => {
    if (timer.current) clearTimeout(timer.current);
    setT({ msg, action, show: true });
    timer.current = setTimeout(() => setT((x) => ({ ...x, show: false })), action ? 7000 : 3800);
  }, []);

  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className={"toast" + (t.show ? " show" : "")} role="status" aria-live="polite">
        <span>{t.msg}</span>
        {t.action && (
          <button
            type="button"
            onClick={() => {
              setT((x) => ({ ...x, show: false }));
              t.action?.run();
            }}
          >
            {t.action.label}
          </button>
        )}
      </div>
    </Ctx.Provider>
  );
}
