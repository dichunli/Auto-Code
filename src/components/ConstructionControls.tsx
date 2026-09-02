"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface Log {
  id: string;
  action: "start" | "pause" | "resume" | "complete";
  created_at: string;
  mechanic_id: string | null;
  profiles?: { full_name: string } | null;
}

interface Mechanic {
  mechanic_id: string;
  full_name: string;
}

interface Props {
  itemId: string;
  customerOpinion?: string | null;
  mechanics?: Mechanic[];
  /* 项目是否已派工（mechanics 表 或 旧 mechanic_id 字段，服务端算好传入） */
  初始已派工: boolean;
  onStatusChange?: () => void;
}

function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function getConstructionStatus(logs: Log[]): "idle" | "running" | "paused" | "completed" {
  if (logs.length === 0) return "idle";
  const last = logs[logs.length - 1];
  if (last.action === "complete") return "completed";
  if (last.action === "pause") return "paused";
  if (last.action === "start" || last.action === "resume") return "running";
  return "idle";
}

function calculateTotalSeconds(logs: Log[], now: Date): number {
  let total = 0;
  let startTime: Date | null = null;

  for (const log of logs) {
    const t = new Date(log.created_at);
    if (log.action === "start" || log.action === "resume") {
      startTime = t;
    } else if (log.action === "pause" || log.action === "complete") {
      if (startTime) {
        total += (t.getTime() - startTime.getTime()) / 1000;
        startTime = null;
      }
    }
  }

  if (startTime) {
    total += (now.getTime() - startTime.getTime()) / 1000;
  }

  return Math.max(0, total);
}

interface PauseDetail {
  start: Date;
  end: Date;
  duration: number;
}

function getPauseDetails(logs: Log[]): PauseDetail[] {
  const details: PauseDetail[] = [];
  let pauseTime: Date | null = null;

  for (const log of logs) {
    const t = new Date(log.created_at);
    if (log.action === "pause") {
      pauseTime = t;
    } else if ((log.action === "resume" || log.action === "complete") && pauseTime) {
      details.push({
        start: pauseTime,
        end: t,
        duration: Math.round((t.getTime() - pauseTime.getTime()) / 1000),
      });
      pauseTime = null;
    }
  }

  return details;
}

export function ConstructionControls({
  itemId,
  customerOpinion,
  mechanics,
  初始已派工,
  onStatusChange,
}: Props) {
  const supabase = createClient();
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  /* 当前用户角色（约束1：admin/boss/receptionist 可代操作计时） */
  const [当前用户角色, set当前用户角色] = useState<string[]>([]);
  /* 派工名单（可随派工操作实时刷新，不用整页刷新） */
  const [liveMechanics, setLiveMechanics] = useState<Mechanic[]>(mechanics || []);
  const [已派工, set已派工] = useState(初始已派工);
  const [elapsed, setElapsed] = useState(0);

  const status = getConstructionStatus(logs);
  const isRunning = status === "running";
  const isCompleted = status === "completed";

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: sessionData }) => {
      const data = { user: sessionData.session?.user ?? null }; /* getSession本地读不联网 */
      if (!data.user) return;
      setCurrentUserId(data.user.id);
      const { data: prs } = await supabase
        .from("profile_roles")
        .select("roles(name)")
        .eq("profile_id", data.user.id);
      set当前用户角色(
        (prs || [])
          .map((r) => (r.roles as unknown as { name: string } | null)?.name || "")
          .filter(Boolean)
      );
    });
  }, [supabase]);

  /* 重查派工名单（派工弹窗保存后广播 wo-item-update 触发） */
  const 重查派工 = useCallback(async () => {
    const { data } = await supabase
      .from("work_order_items")
      .select("mechanic_id, work_order_item_mechanics(mechanic_id, profiles(full_name))")
      .eq("id", itemId)
      .single();
    /* supabase 关联查询推导类型与目标结构重叠不足，先转 unknown 再断言 */
    const row = data as unknown as {
      mechanic_id: string | null;
      work_order_item_mechanics: { mechanic_id: string; profiles?: { full_name: string } | null }[] | null;
    } | null;
    if (!row) return;
    const list = row.work_order_item_mechanics || [];
    setLiveMechanics(
      list.map((m) => ({ mechanic_id: m.mechanic_id, full_name: m.profiles?.full_name || "-" }))
    );
    set已派工(list.length > 0 || !!row.mechanic_id);
  }, [supabase, itemId]);

  useEffect(() => {
    function handle(e: Event) {
      const detail = (e as CustomEvent).detail as { itemId?: string };
      if (detail?.itemId === itemId) 重查派工();
    }
    window.addEventListener("wo-item-update", handle as EventListener);
    return () => window.removeEventListener("wo-item-update", handle as EventListener);
  }, [itemId, 重查派工]);

  const fetchLogs = useCallback(async () => {
    const { data } = await supabase
      .from("work_order_item_construction_logs")
      .select("id, action, created_at, mechanic_id, profiles(full_name)")
      .eq("work_order_item_id", itemId)
      .order("created_at", { ascending: true });
    setLogs((data || []) as unknown as Log[]);
  }, [supabase, itemId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // 实时计时
  useEffect(() => {
    if (!isRunning) {
      setElapsed(calculateTotalSeconds(logs, new Date()));
      return;
    }
    const interval = setInterval(() => {
      setElapsed(calculateTotalSeconds(logs, new Date()));
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning, logs]);

  /* 计时操作：统一走 add_construction_log RPC。
   * 工时统计（construction_stats）已搬进 RPC 自动维护（建行/结算/取消），
   * 前端不再用定时器补写——根治"页面关了统计就丢"。 */
  async function addLog(action: "start" | "pause" | "resume" | "complete" | "cancel") {
    setLoading(true);
    try {
      const { data: result, error: rpcErr } = await supabase.rpc("add_construction_log", {
        p_work_order_item_id: itemId,
        p_mechanic_id: currentUserId || null,
        p_action: action,
      });

      if (rpcErr) throw new Error(rpcErr.message);

      const rpcResult = result as { success: boolean; error?: string; item_status?: string };
      if (!rpcResult?.success) {
        throw new Error(rpcResult?.error || "操作失败");
      }

      await fetchLogs();
      onStatusChange?.();
    } catch (err: unknown) {
      alert("操作失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }

  const canStart = customerOpinion === "agree";
  /* 约束1：项目已派工，且操作人为施工人本人或管理角色（admin/boss/receptionist）。
   * UI 层禁用+提示；服务端 add_construction_log RPC 有同样校验兜底 */
  const 是管理角色 = 当前用户角色.some((r) => ["admin", "boss", "receptionist"].includes(r));
  const 本人施工 = !!currentUserId && liveMechanics.some((m) => m.mechanic_id === currentUserId);
  const 可操作计时 = 已派工 && (本人施工 || 是管理角色);
  const 权限提示 = !已派工
    ? "项目未派工，不能操作计时"
    : !可操作计时
      ? "仅施工人本人或管理人员可操作计时"
      : "";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {status === "idle" && (
        <>
          <button
            type="button"
            onClick={() => addLog("start")}
            disabled={loading || !canStart || !可操作计时}
            className="text-[10px] px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 disabled:opacity-50"
          >
            开始施工
          </button>
          {权限提示 ? (
            <span className="text-[10px] text-red-500">{权限提示}</span>
          ) : (
            !canStart && <span className="text-[10px] text-red-500">需客户同意后才能施工</span>
          )}
        </>
      )}

      {status === "running" && (
        <>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
            施工中
          </span>
          <span className="text-[10px] text-gray-500 font-mono">{formatDuration(elapsed)}</span>
          <button
            type="button"
            onClick={() => addLog("pause")}
            disabled={loading || !可操作计时}
            className="text-[10px] px-2 py-1 rounded bg-yellow-50 text-yellow-600 hover:bg-yellow-100 border border-yellow-200 disabled:opacity-50"
          >
            中断
          </button>
          <button
            type="button"
            onClick={() => addLog("complete")}
            disabled={loading || !可操作计时}
            className="text-[10px] px-2 py-1 rounded bg-green-50 text-green-600 hover:bg-green-100 border border-green-200 disabled:opacity-50"
          >
            完工
          </button>
          <button
            type="button"
            onClick={() => addLog("cancel")}
            disabled={loading || !可操作计时}
            className="text-[10px] px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 disabled:opacity-50"
          >
            取消施工
          </button>
          {权限提示 && <span className="text-[10px] text-red-500">{权限提示}</span>}
        </>
      )}

      {status === "paused" && (
        <>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-700 border border-yellow-200">
            已中断
          </span>
          <span className="text-[10px] text-gray-500 font-mono">{formatDuration(elapsed)}</span>
          <button
            type="button"
            onClick={() => addLog("resume")}
            disabled={loading || !可操作计时}
            className="text-[10px] px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 disabled:opacity-50"
          >
            恢复施工
          </button>
          <button
            type="button"
            onClick={() => addLog("complete")}
            disabled={loading || !可操作计时}
            className="text-[10px] px-2 py-1 rounded bg-green-50 text-green-600 hover:bg-green-100 border border-green-200 disabled:opacity-50"
          >
            完工
          </button>
          <button
            type="button"
            onClick={() => addLog("cancel")}
            disabled={loading || !可操作计时}
            className="text-[10px] px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 disabled:opacity-50"
          >
            取消施工
          </button>
          {权限提示 && <span className="text-[10px] text-red-500">{权限提示}</span>}
        </>
      )}

      {isCompleted && (
        <>
          <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200 text-[10px]">已完工</span>
          <span className="text-gray-500 text-[10px]">用时 {formatDuration(elapsed)}</span>
          <button
            type="button"
            onClick={() => addLog("cancel")}
            disabled={loading || !可操作计时}
            className="text-[10px] px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 disabled:opacity-50"
          >
            取消完工
          </button>
          {权限提示 && <span className="text-[10px] text-red-500">{权限提示}</span>}
        </>
      )}

      {/* 中断明细 */}
      {(() => {
        const details = getPauseDetails(logs);
        if (details.length === 0) return null;
        return (
          <div className="w-full mt-1 space-y-0.5">
            {details.map((d, idx) => (
              <div key={idx} className="text-[10px] text-gray-400 flex items-center gap-1">
                <span className="text-yellow-500">中断 {idx + 1}</span>
                <span>{d.start.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} ~ {d.end.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                <span className="font-mono">({formatDuration(d.duration)})</span>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
