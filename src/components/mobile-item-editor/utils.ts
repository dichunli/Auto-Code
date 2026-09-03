/* ==================== MobileItemEditor 工具函数 ====================
 * 从 MobileItemEditor.tsx 原样搬出的纯函数，无任何逻辑改动 */

import type { ConstructionLog, 编码命中配件, 配件库行 } from "./types";

export function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function formatTime(d: Date) {
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function getConstructionStatus(logs: ConstructionLog[]): "idle" | "running" | "paused" | "completed" {
  if (logs.length === 0) return "idle";
  const last = logs[logs.length - 1];
  if (last.action === "complete") return "completed";
  if (last.action === "pause") return "paused";
  if (last.action === "start" || last.action === "resume") return "running";
  return "idle";
}

export function calculateTotalSeconds(logs: ConstructionLog[], now: Date): number {
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

export function canCancelLastStart(logs: ConstructionLog[]): boolean {
  if (logs.length === 0) return false;
  const last = logs[logs.length - 1];
  if (last.action !== "start" && last.action !== "resume") return false;
  const now = new Date();
  const startTime = new Date(last.created_at);
  return now.getTime() - startTime.getTime() < 60 * 1000;
}

/* 把配件库查询行整理成命中结构（关联名称可能是对象或数组） */
export function 转命中配件(d: 配件库行): 编码命中配件 {
  const pn = d.part_names;
  const pb = d.part_brands;
  const ps = d.part_specifications;
  return {
    id: d.id,
    part_number: d.part_number,
    part_name_id: d.part_name_id,
    name: (Array.isArray(pn) ? pn[0]?.name : pn?.name) || "",
    brand: (Array.isArray(pb) ? pb[0]?.name : pb?.name) || "",
    specification: (Array.isArray(ps) ? ps[0]?.name : ps?.name) || "",
    unit_cost: d.unit_cost,
    unit_price: d.unit_price,
    document_name: d.document_name,
  };
}
