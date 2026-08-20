"use client";

import { useState, useCallback, createContext, useContext } from "react";

/* 全局轻提示（2026-08-20）：替代浏览器 alert 的自定义弹窗
   挂在 AppShell 根部，电脑端手机端都能用；
   成功绿色 3 秒自动消失，错误红色 5 秒，警告橙色 4 秒 */

interface ToastItem {
  id: string;
  message: string;
  type: "success" | "error" | "warning";
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastItem["type"]) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast 必须在 ToastProvider 内使用");
  return ctx;
}

const 消失时长: Record<ToastItem["type"], number> = {
  success: 3000,
  warning: 4000,
  error: 5000,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: ToastItem["type"] = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 消失时长[type]);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-4 left-0 right-0 z-[200] flex flex-col items-center gap-2 pointer-events-none px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto px-4 py-2.5 rounded-lg text-sm text-white shadow-lg animate-[fadeIn_0.2s_ease-out] max-w-md text-center ${
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
