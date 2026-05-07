"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  workOrderId: string;
  customerOpinion?: string | null;
  itemName?: string;
  vehicleBrand?: string;
  vehicleSeries?: string;
  vehicleModelName?: string;
  vehicleDisplacement?: string;
  vehicleEngine?: string;
  vehicleChassis?: string;
  vehicleTransmission?: string;
  mechanics?: Mechanic[];
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

function calculatePauseSeconds(logs: Log[]): number {
  if (logs.length === 0) return 0;
  const startLog = logs.find((l) => l.action === "start" || l.action === "resume");
  const completeLog = logs.find((l) => l.action === "complete");
  if (!startLog || !completeLog) return 0;
  const firstStart = new Date(startLog.created_at);
  const lastEnd = new Date(completeLog.created_at);
  const totalSpan = (lastEnd.getTime() - firstStart.getTime()) / 1000;
  const constructionSeconds = calculateTotalSeconds(logs, lastEnd);
  return Math.max(0, Math.round(totalSpan - constructionSeconds));
}

export function ConstructionControls({
  itemId,
  workOrderId,
  customerOpinion,
  itemName,
  vehicleBrand,
  vehicleSeries,
  vehicleModelName,
  vehicleDisplacement,
  vehicleEngine,
  vehicleChassis,
  vehicleTransmission,
  mechanics,
  onStatusChange,
}: Props) {
  const supabase = createClient();
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);
  const [statsIds, setStatsIds] = useState<Record<string, string>>({});
  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const fetchStats = useCallback(async () => {
    const { data } = await supabase
      .from("work_order_item_construction_stats")
      .select("id, mechanic_name")
      .eq("work_order_item_id", itemId)
      .eq("status", "in_progress");
    const map: Record<string, string> = {};
    (data || []).forEach((row: any) => {
      map[row.mechanic_name] = row.id;
    });
    setStatsIds(map);
  }, [supabase, itemId]);

  useEffect(() => {
    fetchLogs();
    fetchStats();
  }, [fetchLogs, fetchStats]);

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

  async function createStatsForMechanic(mechanicName: string): Promise<string | null> {
    const { data, error } = await supabase
      .from("work_order_item_construction_stats")
      .insert({
        work_order_item_id: itemId,
        work_order_id: workOrderId,
        item_name: itemName || "",
        vehicle_brand: vehicleBrand || "",
        vehicle_series: vehicleSeries || "",
        vehicle_model_name: vehicleModelName || "",
        vehicle_displacement: vehicleDisplacement || "",
        vehicle_engine: vehicleEngine || "",
        vehicle_chassis: vehicleChassis || "",
        vehicle_transmission: vehicleTransmission || "",
        mechanic_name: mechanicName,
        status: "in_progress",
      })
      .select("id")
      .single();
    if (error) {
      console.error("创建统计记录失败", error);
      return null;
    }
    return data?.id || null;
  }

  async function updateStatsForMechanic(id: string) {
    const constructionSecs = Math.round(calculateTotalSeconds(logs, new Date()));
    const pauseSecs = calculatePauseSeconds(logs);
    const { error } = await supabase
      .from("work_order_item_construction_stats")
      .update({
        construction_seconds: constructionSecs,
        pause_seconds: pauseSecs,
        total_seconds: constructionSecs + pauseSecs,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      console.error("更新统计记录失败", error);
    }
  }

  async function addLog(action: "start" | "pause" | "resume" | "complete" | "cancel") {
    const wasCompleted = status === "completed";
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

      const mechanicList = mechanics && mechanics.length > 0 ? mechanics : [{ mechanic_id: currentUserId, full_name: "未分配" }];

      if (action === "start") {
        startTimeoutRef.current = setTimeout(async () => {
          const newMap: Record<string, string> = {};
          for (const m of mechanicList) {
            const newId = await createStatsForMechanic(m.full_name);
            if (newId) newMap[m.full_name] = newId;
          }
          setStatsIds((prev) => ({ ...prev, ...newMap }));
        }, 60000);
      } else if (action === "cancel") {
        if (wasCompleted) {
          // 取消完工：清除完工定时器，恢复统计记录为进行中
          if (completeTimeoutRef.current) {
            clearTimeout(completeTimeoutRef.current);
            completeTimeoutRef.current = null;
          }
          for (const id of Object.values(statsIds)) {
            await supabase.from("work_order_item_construction_stats").update({ status: "in_progress", completed_at: null }).eq("id", id);
          }
        } else {
          // 取消施工：清除开始定时器，删除统计记录
          if (startTimeoutRef.current) {
            clearTimeout(startTimeoutRef.current);
            startTimeoutRef.current = null;
          }
          for (const id of Object.values(statsIds)) {
            await supabase.from("work_order_item_construction_stats").delete().eq("id", id);
          }
          setStatsIds({});
        }
      } else if (action === "complete") {
        if (startTimeoutRef.current) {
          clearTimeout(startTimeoutRef.current);
          startTimeoutRef.current = null;
        }
        // 完工后2分钟生成/更新统计记录
        completeTimeoutRef.current = setTimeout(async () => {
          for (const m of mechanicList) {
            const id = statsIds[m.full_name];
            if (id) {
              await updateStatsForMechanic(id);
            } else {
              const newId = await createStatsForMechanic(m.full_name);
              if (newId) await updateStatsForMechanic(newId);
            }
          }
        }, 120000);
      }
    } catch (err: any) {
      alert("操作失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }

  const canStart = customerOpinion === "agree";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {status === "idle" && (
        <>
          <button
            type="button"
            onClick={() => addLog("start")}
            disabled={loading || !canStart}
            className="text-[10px] px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 disabled:opacity-50"
          >
            开始施工
          </button>
          {!canStart && (
            <span className="text-[10px] text-red-500">需客户同意后才能施工</span>
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
          <button
            type="button"
            onClick={() => addLog("cancel")}
            disabled={loading}
            className="text-[10px] px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 disabled:opacity-50"
          >
            取消施工
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
          <button
            type="button"
            onClick={() => addLog("cancel")}
            disabled={loading}
            className="text-[10px] px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 disabled:opacity-50"
          >
            取消施工
          </button>
        </>
      )}

      {isCompleted && (
        <>
          <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200 text-[10px]">已完工</span>
          <span className="text-gray-500 text-[10px]">用时 {formatDuration(elapsed)}</span>
          <button
            type="button"
            onClick={() => addLog("cancel")}
            disabled={loading}
            className="text-[10px] px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 disabled:opacity-50"
          >
            取消完工
          </button>
        </>
      )}
    </div>
  );
}
