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

  /* 加载当前用户角色，判定是否允许看价格。
     2026-08-31 修复"老板也全站 ***"：判定改走服务端 has_role RPC（SECURITY DEFINER，
     用 auth.uid() 判定，绕开客户端查表受 RLS 策略不全影响的变数）；
     并用 onAuthStateChange 监听，根治两类时序竞态：
       ① 整页刷新瞬间 getUser 未就绪返回 null → 误判无角色锁死
       ② 登录页 SPA 跳转回系统，Provider 不重挂载保持"未登录"旧判定 */
  useEffect(() => {
    let 已卸载 = false;
    async function 判定() {
      const { data, error } = await supabase.rpc("has_role", {
        p_roles: 可看价格角色,
      });
      if (!已卸载) {
        setCanTogglePrices(!error && data === true);
      }
    }
    /* 立即判定一次 + 登录态变化时再判定；
       用 getSession（本地读不联网）拿身份——getUser 网络验证在代理/弱网下会挂起 */
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) 判定();
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        判定();
      } else if (!已卸载) {
        setCanTogglePrices(false);
      }
    });
    return () => {
      已卸载 = true;
      subscription.unsubscribe();
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
  force = false,
}: {
  value: number | string | null;
  prefix?: string;
  className?: string;
  /* 销售价专用（2026-08-31 用户拍板"销售价不需要隐藏"）：
     面向客户的报价/工单费用不算商业秘密，加 force 始终显示；
     采购价/成本价/采购单金额不加，仍受门禁控制 */
  force?: boolean;
}) {
  const { showPrices } = usePriceVisibility();
  if (!showPrices && !force) {
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
