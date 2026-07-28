/* ═════════════════════════════════════════════════════════════════
 * 工单/项目状态显示口径（全站唯一来源）
 *
 * 原则：存储态与显示态分离——
 *   存储态（落库）：work_orders.status（9值枚举）、work_order_items.status
 *     （pending/in_progress/paused/completed）、qc_status（none/passed/failed）
 *   显示态（本文件实时计算，不落库）：用户看到的 10 个工单状态、6 个项目状态
 *
 * 项目状态规则（仅 labor 项目）：
 *   未派工 → 待派工；已派工未开始 → 待施工；in_progress → 施工中；
 *   paused → 已中断；completed 且须质检未检 → 待质检；
 *   completed 且（不须质检 或 已合格）→ 已完工
 *
 * 工单状态规则（多徽章同时显示，按流程顺序）：
 *   存储态直达（互斥）：settled/delivered→已结算；pending_settlement→待结算；
 *     pending_close→待结单
 *   在修阶段（可多个共存）：无项目或有需求未指派→待诊断；有未派工项目→待派工；
 *     有已派工未开始→待施工；有施工中→施工中；有中断→已中断；
 *     有完工待质检→待质检；满足待结单判定→待结单
 * ═════════════════════════════════════════════════════════════════ */

export type 阶段key =
  | "pending_diagnosis"    // 待诊断（工单级）
  | "pending_dispatch"     // 待派工
  | "pending_construction" // 待施工
  | "in_progress"          // 施工中
  | "paused"               // 已中断
  | "pending_qc"           // 待质检
  | "completed"            // 已完工
  | "pending_close"        // 待结单（工单级）
  | "pending_settlement"   // 待结算（工单级）
  | "settled";             // 已结算（工单级）

export const 阶段文案: Record<阶段key, string> = {
  pending_diagnosis: "待诊断",
  pending_dispatch: "待派工",
  pending_construction: "待施工",
  in_progress: "施工中",
  paused: "已中断",
  pending_qc: "待质检",
  completed: "已完工",
  pending_close: "待结单",
  pending_settlement: "待结算",
  settled: "已结算",
};

export const 阶段颜色: Record<阶段key, string> = {
  pending_diagnosis: "bg-gray-100 text-gray-700",
  pending_dispatch: "bg-slate-100 text-slate-700",
  pending_construction: "bg-orange-100 text-orange-700",
  in_progress: "bg-blue-100 text-blue-700",
  paused: "bg-yellow-100 text-yellow-700",
  pending_qc: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
  pending_close: "bg-teal-100 text-teal-700",
  pending_settlement: "bg-cyan-100 text-cyan-700",
  settled: "bg-emerald-100 text-emerald-700",
};

/* 阶段深色系（与浅色徽章同族）：用于列表筛选标签的数量角标，醒目易读 */
export const 阶段深色: Record<阶段key, string> = {
  pending_diagnosis: "bg-gray-500",
  pending_dispatch: "bg-slate-500",
  pending_construction: "bg-orange-500",
  in_progress: "bg-blue-500",
  paused: "bg-yellow-500",
  pending_qc: "bg-purple-500",
  completed: "bg-green-500",
  pending_close: "bg-teal-600",
  pending_settlement: "bg-cyan-600",
  settled: "bg-emerald-600",
};

/* 徽章显示顺序（流程顺序） */
export const 阶段顺序: 阶段key[] = [
  "pending_diagnosis",
  "pending_dispatch",
  "pending_construction",
  "in_progress",
  "paused",
  "pending_qc",
  "completed",
  "pending_close",
  "pending_settlement",
  "settled",
];

/* ── 项目级状态判定 ─────────────────────────────────────────── */

export interface 项目状态输入 {
  item_type?: string | null;
  status?: string | null;       // pending / in_progress / paused / completed
  require_qc?: boolean | null;  // 是否必须质检
  qc_status?: string | null;    // none / passed / failed
  已派工: boolean;               // work_order_item_mechanics 是否有记录
}

/* 项目显示状态（6态）；非 labor 项目返回 null（配件走配件流程十态） */
export function getItemStageKey(item: 项目状态输入): 阶段key | null {
  if (item.item_type !== "labor") return null;

  if (item.status === "completed") {
    /* 须质检且未质检 → 待质检；不须质检 或 已合格 → 已完工 */
    if (item.require_qc && (item.qc_status || "none") === "none") return "pending_qc";
    return "completed";
  }
  if (item.status === "in_progress") return "in_progress";
  if (item.status === "paused") return "paused";
  /* status = pending（含质检不合格被打回的项目，同样显示待施工） */
  if (!item.已派工) return "pending_dispatch";
  return "pending_construction";
}

/* ── 工单级状态判定 ─────────────────────────────────────────── */

export interface 配件出库输入 {
  is_selected?: boolean | null;
  quantity?: number | null;
  净出库: number; /* 领料合计 - 退库合计 */
}

export interface 工单状态输入 {
  status: string;          // work_orders.status
  有未指派需求: boolean;    // 存在 assigned_to 为空的需求
  项目列表: 项目状态输入[];
  配件列表: 配件出库输入[];
}

/* 待结单判定（双通道）：
 * 通道A（正常流程）：labor 项目非空、全部完工、须质检项目全部合格
 * 通道B（快速通道，约束3）：labor 项目全部已派工、选中配件全部出库完成，
 *   且工单至少有一个项目或选中配件（防空工单直接可结单） */
export function readyToClose(input: 工单状态输入): boolean {
  const labors = input.项目列表.filter((it) => it.item_type === "labor");

  const 通道A =
    labors.length > 0 &&
    labors.every((it) => it.status === "completed") &&
    labors.every((it) => !it.require_qc || it.qc_status === "passed");

  const 选中配件 = input.配件列表.filter((p) => p.is_selected !== false);
  const 配件全出库 = 选中配件.every(
    (p) => (p.quantity ?? 0) <= 0 || p.净出库 >= (p.quantity ?? 0)
  );
  const 通道B =
    labors.every((it) => it.已派工) &&
    配件全出库 &&
    (labors.length > 0 || 选中配件.length > 0);

  return 通道A || 通道B;
}

/* 工单显示状态（多徽章）：返回按流程顺序排序的阶段数组 */
export function computeBoardStages(input: 工单状态输入): 阶段key[] {
  /* 存储态直达（互斥，只显示一个） */
  if (input.status === "settled" || input.status === "delivered") return ["settled"];
  if (input.status === "pending_settlement") return ["pending_settlement"];
  if (input.status === "pending_close") return ["pending_close"];

  const 徽章 = new Set<阶段key>();
  const labors = input.项目列表.filter((it) => it.item_type === "labor");

  /* 待诊断：还没开项目（现状口径）或 有需求未指派（用户规则1） */
  if (labors.length === 0 || input.有未指派需求) 徽章.add("pending_diagnosis");

  /* 项目阶段聚合（多阶段共存）。
   * "已完工"不单独聚合：部分完工没有行动意义；全部完工必命中 readyToClose → 待结单 */
  for (const it of labors) {
    const s = getItemStageKey(it);
    if (s && s !== "completed") 徽章.add(s);
  }

  /* 待结单：双通道判定（可与"待质检/待施工"等共存——可结单但流程还没走完） */
  if (readyToClose(input)) 徽章.add("pending_close");

  return 阶段顺序.filter((s) => 徽章.has(s));
}
