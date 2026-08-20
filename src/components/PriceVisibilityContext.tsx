"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

/* 2026-08-20 待收货改造一期④：价格开关加角色门禁。
   仅 admin / boss / warehouse 三角色可切换价格显示；
   其余角色 showPrices 恒为 false（快捷键、开关一律无效），永远看不到价格 */
const 可看价格角色 = ["admin", "boss", "warehouse"];

interface PriceVisibilityState {
  showPrices: boolean;
  /* 当前用户是否有权切换价格显示（角色未加载完成前为 false，宁可先藏） */
  canTogglePrices: boolean;
  togglePrices: () => void;
}

const Context = createContext<PriceVisibilityState>({
  showPrices: false,
  canTogglePrices: false,
  togglePrices: () => {},
});

export function PriceVisibilityProvider({ children }: { children: ReactNode }) {
  const [showPrices, setShowPrices] = useState(true);
  const [canTogglePrices, setCanTogglePrices] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    const saved = localStorage.getItem("show_prices");
    if (saved !== null) {
      setShowPrices(saved !== "false");
    }
  }, []);

  /* 加载当前用户角色，判定是否允许看价格 */
  useEffect(() => {
    let 已卸载 = false;
    async function 加载角色() {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        if (!已卸载) setCanTogglePrices(false);
        return;
      }
      const { data: prs } = await supabase
        .from("profile_roles")
        .select("roles(name)")
        .eq("profile_id", data.user.id);
      const 角色列表 = (prs || [])
        .map((r) => (r.roles as unknown as { name: string } | null)?.name || "")
        .filter(Boolean);
      if (!已卸载) {
        setCanTogglePrices(角色列表.some((r) => 可看价格角色.includes(r)));
      }
    }
    加载角色();
    return () => {
      已卸载 = true;
    };
  }, [supabase]);

  function togglePrices() {
    /* 无权限角色一律忽略（含 Ctrl+Shift+Z 快捷键） */
    if (!canTogglePrices) return;
    setShowPrices((prev) => {
      const next = !prev;
      localStorage.setItem("show_prices", String(next));
      return next;
    });
  }

  return (
    <Context.Provider
      value={{
        /* 无权限角色强制隐藏，即使 localStorage 里存过 true 也无效 */
        showPrices: canTogglePrices && showPrices,
        canTogglePrices,
        togglePrices,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function usePriceVisibility() {
  return useContext(Context);
}

export function PriceValue({
  value,
  prefix = "¥",
  className,
}: {
  value: number | string | null;
  prefix?: string;
  className?: string;
}) {
  const { showPrices } = usePriceVisibility();
  if (!showPrices) {
    return <span className={className}>***</span>;
  }
  const num = typeof value === "string" ? parseFloat(value) : value;
  return (
    <span className={className}>
      {prefix}
      {Number(num || 0).toFixed(2)}
    </span>
  );
}
