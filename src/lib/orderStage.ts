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
  | "pending_confirm"      // 待确认（客户意见未填）
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
  pending_confirm: "待确认",
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
  pending_confirm: "bg-rose-100 text-rose-700",
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
  pending_confirm: "bg-rose-500",
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
  "pending_confirm",
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
  customer_opinion?: string | null; // pending / agree / reject（客户意见）
  已派工: boolean;               // work_order_item_mechanics 是否有记录
}

/* 项目显示状态（7态）；返回 null 表示"不进入任何阶段"：
 * 非 labor 项目（配件走配件流程十态）、客户否决（reject）的项目（用户拍板：否决不显示）。
 * 判定顺序：reject → 待确认（意见 pending）→ 待派工（未派工）→ 待施工 → 施工中/已中断 → 待质检/已完工 */
export function getItemStageKey(item: 项目状态输入): 阶段key | null {
  if (item.item_type !== "labor") return null;
  /* 客户否决的项目不进任何阶段（详情页仍可见，不阻塞结单） */
  if (item.customer_opinion === "reject") return null;

  if (item.status === "completed") {
    /* 须质检且未质检 → 待质检；不须质检 或 已合格 → 已完工 */
    if (item.require_qc && (item.qc_status || "none") === "none") return "pending_qc";
    return "completed";
  }
  if (item.status === "in_progress") return "in_progress";
  if (item.status === "paused") return "paused";
  /* status = pending：客户意见未确认最优先（先确认再派工施工） */
  if ((item.customer_opinion || "pending") !== "agree") return "pending_confirm";
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

/* 待结单判定（唯一通道，2026-07-31 用户拍板；**客户否决 reject 的项目排除在外**——不做的项目不阻塞结单）：
 *   labor 全部已派工 + 选中配件全部出库 + 工单至少有一个项目或选中配件（无配件时只看全部派工）。
 * 2026-07-31 前另有"通道A（全部完工+质检全合格直接可结单）"——它不看配件出库，
 * 导致配件还欠着就显示待结单，已删除：完工的项目必然已派工（完工有派工门禁），
 * 统一走唯一通道，配件未出齐一律不允许结单。
 * 与数据库 fn_order_ready_to_close 同口径，改动必须两边同步。 */
export function readyToClose(input: 工单状态输入): boolean {
  const labors = input.项目列表.filter(
    (it) => it.item_type === "labor" && it.customer_opinion !== "reject"
  );

  const 选中配件 = input.配件列表.filter((p) => p.is_selected !== false);
  const 配件全出库 = 选中配件.every(
    (p) => (p.quantity ?? 0) <= 0 || p.净出库 >= (p.quantity ?? 0)
  );

  return (
    labors.every((it) => it.已派工) &&
    配件全出库 &&
    (labors.length > 0 || 选中配件.length > 0)
  );
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

  /* 项目阶段聚合（多阶段共存，含"已完工"——已完工页面要显示各车辆已完工项目） */
  for (const it of labors) {
    const s = getItemStageKey(it);
    if (s) 徽章.add(s);
  }

  /* 待结单：唯一通道判定（可与"已完工/待质检"等共存——可结单但流程还没走完） */
  if (readyToClose(input)) 徽章.add("pending_close");

  return 阶段顺序.filter((s) => 徽章.has(s));
}
