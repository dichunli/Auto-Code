"use client";

import { useState, useCallback, useEffect, createContext, useContext } from "react";

interface ToastItem {
  id: string;
  message: string;
  type: "success" | "error" | "warning";
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastItem["type"]) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useMobileToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useMobileToast must be used within MobileToastProvider");
  return ctx;
}

export function MobileToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: ToastItem["type"] = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-4 left-0 right-0 z-[200] flex flex-col items-center gap-2 pointer-events-none px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto px-4 py-2.5 rounded-lg text-sm text-white shadow-lg animate-[fadeIn_0.2s_ease-out] ${
              t.type === "error" ? "bg-red-600" : t.type === "warning" ? "bg-orange-500" : "bg-green-600"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
