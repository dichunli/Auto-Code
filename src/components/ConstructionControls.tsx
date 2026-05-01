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

interface Props {
  itemId: string;
  workOrderId: string;
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

export function ConstructionControls({ itemId, workOrderId, onStatusChange }: Props) {
  const supabase = createClient();
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);

  const status = getConstructionStatus(logs);
  const isRunning = status === "running";
  const isCompleted = status === "completed";

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setCurrentUserId(data.user.id);
    });
  }, [supabase]);

  const fetchLogs = useCallback(async () => {
    const { data } = await supabase
      .from("work_order_item_construction_logs")
      .select("id, action, created_at, mechanic_id, profiles(full_name)")
      .eq("work_order_item_id", itemId)
      .order("created_at", { ascending: true });
    setLogs((data || []) as any);
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

  async function addLog(action: "start" | "pause" | "resume" | "complete") {
    setLoading(true);
    try {
      const { error } = await supabase.from("work_order_item_construction_logs").insert({
        work_order_item_id: itemId,
        mechanic_id: currentUserId || null,
        action,
      });
      if (error) throw error;

      // 同步更新维修项目状态
      let itemStatus = "pending";
      if (action === "start" || action === "resume") itemStatus = "in_progress";
      if (action === "pause") itemStatus = "paused";
      if (action === "complete") itemStatus = "completed";

      await supabase.from("work_order_items").update({ status: itemStatus }).eq("id", itemId);

      // 尝试推进工单状态
      await advanceWorkOrderStatus(workOrderId, action);

      await fetchLogs();
      onStatusChange?.();
    } catch (err: any) {
      alert("操作失败: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function advanceWorkOrderStatus(orderId: string, action: string) {
    const { data: order } = await supabase
      .from("work_orders")
      .select("status")
      .eq("id", orderId)
      .single();

    if (!order) return;

    // 开始施工：pending_repair → repairing
    if ((action === "start" || action === "resume") && order.status === "pending_repair") {
      await supabase
        .from("work_orders")
        .update({ status: "repairing", started_at: new Date().toISOString() })
        .eq("id", orderId);
      return;
    }

    // 完工：检查所有项目是否都已完成
    if (action === "complete") {
      const { data: items } = await supabase
        .from("work_order_items")
        .select("status")
        .eq("work_order_id", orderId);

      if (!items || items.length === 0) return;

      const allCompleted = items.every((i: any) => i.status === "completed");
      if (!allCompleted) return;

      if (order.status === "repairing" || order.status === "pending_repair") {
        await supabase
          .from("work_orders")
          .update({ status: "pending_quality_check", completed_at: new Date().toISOString() })
          .eq("id", orderId);
      }
    }
  }

  if (isCompleted) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">已完工</span>
        <span className="text-gray-500">用时 {formatDuration(elapsed)}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {status === "idle" && (
        <button
          type="button"
          onClick={() => addLog("start")}
          disabled={loading}
          className="text-[10px] px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 disabled:opacity-50"
        >
          开始施工
        </button>
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
            disabled={loading}
            className="text-[10px] px-2 py-1 rounded bg-yellow-50 text-yellow-600 hover:bg-yellow-100 border border-yellow-200 disabled:opacity-50"
          >
            中断
          </button>
          <button
            type="button"
            onClick={() => addLog("complete")}
            disabled={loading}
            className="text-[10px] px-2 py-1 rounded bg-green-50 text-green-600 hover:bg-green-100 border border-green-200 disabled:opacity-50"
          >
            完工
          </button>
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
            disabled={loading}
            className="text-[10px] px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 disabled:opacity-50"
          >
            恢复施工
          </button>
          <button
            type="button"
            onClick={() => addLog("complete")}
            disabled={loading}
            className="text-[10px] px-2 py-1 rounded bg-green-50 text-green-600 hover:bg-green-100 border border-green-200 disabled:opacity-50"
          >
            完工
          </button>
        </>
      )}
    </div>
  );
}
