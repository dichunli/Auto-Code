"use client";

import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { createClient } from "@/lib/supabase/client";
import { calculateTotalSeconds, getConstructionStatus } from "./utils";
import type { ConstructionLog } from "./types";

type Supabase客户端 = ReturnType<typeof createClient>;

/* Hook 入参：全部来自主组件现有状态/回调，行为与原内联实现完全一致 */
interface UseItemTimerParams {
  open: boolean;
  itemId: string;
  itemType: string;
  supabase: Supabase客户端;
  loading: boolean;
  setLoading: Dispatch<SetStateAction<boolean>>;
  refresh: () => void;
}

/* 施工计时：日志加载、秒表走动、开始/暂停/继续/完工/取消（从 MobileItemEditor 原样抽出） */
export function useItemTimer({ open, itemId, itemType, supabase, loading, setLoading, refresh }: UseItemTimerParams) {
  /* 计时状态 */
  const [logs, setLogs] = useState<ConstructionLog[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  /* 加载计时记录 */
  useEffect(() => {
    if (!open || itemType !== "labor") return;
    supabase
      .from("work_order_item_construction_logs")
      .select("id, action, created_at, mechanic_id")
      .eq("work_order_item_id", itemId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        const loaded = (data || []) as ConstructionLog[];
        setLogs(loaded);
        setElapsed(calculateTotalSeconds(loaded, new Date()));
      });
  }, [open, itemId, itemType, supabase]);

  /* 实时计时 */
  useEffect(() => {
    const status = getConstructionStatus(logs);
    if (status === "running") {
      timerRef.current = setInterval(() => {
        setElapsed(calculateTotalSeconds(logs, new Date()));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [logs]);

  /* 计时操作：统一走 add_construction_log RPC（与桌面端同一入口），
   * 由 RPC 做派工/权限校验（约束1）并联动工单状态，不再直写表绕过 */
  async function timerAction(action: "start" | "pause" | "resume" | "complete") {
    if (loading) return;
    setLoading(true);

    const { data: sessionData } = await supabase.auth.getSession();
    const userData = { user: sessionData.session?.user ?? null }; /* getSession本地读不联网（2026-09-03） */
    const mechanicId = userData.user?.id || null;

    const { data: rpcData, error } = await supabase.rpc("add_construction_log", {
      p_work_order_item_id: itemId,
      p_mechanic_id: mechanicId,
      p_action: action,
    });

    setLoading(false);
    const res = rpcData as { success: boolean; error?: string } | null;
    if (error) {
      alert("操作失败: " + error.message);
      return;
    }
    if (!res?.success) {
      alert(res?.error || "操作失败");
      return;
    }

    await 重查计时日志();
  }

  /* 取消计时：走 RPC cancel（取消施工/取消完工，与桌面端同语义） */
  async function cancelTimer() {
    if (loading) return;
    if (logs.length === 0) return;
    const lastLog = logs[logs.length - 1];
    if (lastLog.action !== "start" && lastLog.action !== "resume") return;

    setLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const userData = { user: sessionData.session?.user ?? null }; /* getSession本地读不联网（2026-09-03） */
    const mechanicId = userData.user?.id || null;

    const { data: rpcData, error } = await supabase.rpc("add_construction_log", {
      p_work_order_item_id: itemId,
      p_mechanic_id: mechanicId,
      p_action: "cancel",
    });

    setLoading(false);
    const res = rpcData as { success: boolean; error?: string } | null;
    if (error) {
      alert("取消失败: " + error.message);
      return;
    }
    if (!res?.success) {
      alert(res?.error || "取消失败");
      return;
    }

    await 重查计时日志();
  }

  /* 重查计时日志并刷新界面（计时/取消后共用） */
  async function 重查计时日志() {
    const { data } = await supabase
      .from("work_order_item_construction_logs")
      .select("id, action, created_at, mechanic_id")
      .eq("work_order_item_id", itemId)
      .order("created_at", { ascending: true });
    const loaded = (data || []) as ConstructionLog[];
    setLogs(loaded);
    setElapsed(calculateTotalSeconds(loaded, new Date()));
    refresh();
    /* 广播：项目状态徽章立即刷新（待施工/施工中/已中断/待质检/已完工） */
    window.dispatchEvent(new CustomEvent("wo-item-update", { detail: { itemId } }));
  }

  return { logs, elapsed, timerAction, cancelTimer };
}
