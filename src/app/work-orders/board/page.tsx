import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

const COLUMNS = [
  { key: "pending_diagnosis", label: "待诊断", color: "bg-gray-50 border-gray-200" },
  { key: "pending_dispatch", label: "待派工", color: "bg-slate-50 border-slate-200" },
  { key: "pending_construction", label: "待施工", color: "bg-orange-50 border-orange-200" },
  { key: "in_progress", label: "施工中", color: "bg-blue-50 border-blue-200" },
  { key: "paused", label: "已中断", color: "bg-yellow-50 border-yellow-200" },
  { key: "completed", label: "已完工", color: "bg-green-50 border-green-200" },
  { key: "pending_qc", label: "已质检", color: "bg-purple-50 border-purple-200" },
  { key: "settled", label: "已结单", color: "bg-emerald-50 border-emerald-200" },
];

// 工单"已结单"对应的几种 work_orders.status
const SETTLED_STATUSES = ["settled", "delivered", "pending_close", "pending_settlement"];

// 工单状态（work_orders.status）的中文标签和颜色
const ORDER_STATUS_LABELS: Record<string, string> = {
  received: "已接车",
  pending_diagnosis: "待诊断",
  pending_repair: "待维修",
  repairing: "维修中",
  pending_quality_check: "已质检",
  pending_close: "待结算",
  pending_settlement: "待结算",
  settled: "已结算",
  delivered: "已交车",
};

const ORDER_STATUS_COLORS: Record<string, string> = {
  received: "bg-gray-100 text-gray-700",
  pending_diagnosis: "bg-yellow-100 text-yellow-700",
  pending_repair: "bg-orange-100 text-orange-700",
  repairing: "bg-blue-100 text-blue-700",
  pending_quality_check: "bg-purple-100 text-purple-700",
  pending_close: "bg-indigo-100 text-indigo-700",
  pending_settlement: "bg-emerald-100 text-emerald-700",
  settled: "bg-green-100 text-green-700",
  delivered: "bg-slate-100 text-slate-700",
};

// 单个维修项目（labor）按"项目状态 + 工单状态"判断归属看板列
function getItemColumnKey(item: any, orderStatus: string): string {
  if (SETTLED_STATUSES.includes(orderStatus)) return "settled";
  if (orderStatus === "pending_quality_check") return "pending_qc";

  if (item.status === "completed") return "completed";
  if (item.status === "paused") return "paused";
  if (item.status === "in_progress") return "in_progress";

  if (item.status === "pending_dispatch") return "pending_dispatch";
  if (item.status === "pending_construction") return "pending_construction";

  if (!item.mechanic_id) return "pending_dispatch";
  return "pending_construction";
}

// 没有维修项目的工单整体归到哪一列
function getEmptyOrderColumnKey(orderStatus: string): string {
  if (SETTLED_STATUSES.includes(orderStatus)) return "settled";
  if (orderStatus === "pending_quality_check") return "pending_qc";
  return "pending_diagnosis";
}

function formatDeliveryDate(date: string | null) {
  if (!date) return "";
  const d = new Date(date);
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Group = {
  order: any;
  items: any[]; // 该列下该工单的项目；可能为空（如已结单工单）
  isPlaceholder: boolean; // 是否是"待添加维修项目"占位
};

export default async function WorkOrderBoardPage() {
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("work_orders")
    .select(`
      id, order_no, status, estimated_completion_at, created_at,
      vehicles(plate_number, brand, model),
      work_order_items(
        id, name, alias_name, status, mechanic_id, item_type,
        profiles!work_order_items_mechanic_id_fkey(full_name)
      )
    `)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(300);

  // 每列下按车牌（工单）分组
  const columnGroups: Record<string, Group[]> = {};
  COLUMNS.forEach((c) => (columnGroups[c.key] = []));

  (orders || []).forEach((order: any) => {
    const labors = (order.work_order_items || []).filter((it: any) => it.item_type === "labor");

    // 已结单 — 整张工单作为一个分区进入"已结单"列，不展开项目
    if (SETTLED_STATUSES.includes(order.status)) {
      columnGroups.settled.push({ order, items: [], isPlaceholder: false });
      return;
    }

    // 没有维修项目 — 分区进入对应列（默认待诊断），分区内显示占位
    if (labors.length === 0) {
      const key = getEmptyOrderColumnKey(order.status);
      columnGroups[key].push({ order, items: [], isPlaceholder: true });
      return;
    }

    // 把项目按所属列汇总同一工单的项目
    const itemsByColumn: Record<string, any[]> = {};
    labors.forEach((it: any) => {
      const key = getItemColumnKey(it, order.status);
      if (!itemsByColumn[key]) itemsByColumn[key] = [];
      itemsByColumn[key].push(it);
    });

    Object.entries(itemsByColumn).forEach(([colKey, items]) => {
      if (columnGroups[colKey]) {
        columnGroups[colKey].push({ order, items, isPlaceholder: false });
      }
    });
  });

  // 各列内按交车日期升序排序：早交车的排前面；无交车日期的排最后
  const compareByDelivery = (a: Group, b: Group) => {
    const at = a.order.estimated_completion_at;
    const bt = b.order.estimated_completion_at;
    if (!at && !bt) return 0;
    if (!at) return 1;
    if (!bt) return -1;
    return new Date(at).getTime() - new Date(bt).getTime();
  };
  COLUMNS.forEach((c) => columnGroups[c.key].sort(compareByDelivery));

  // 各列总数（统计的是"分区数"和"项目数"两个口径，这里用分区数）
  const columnCounts: Record<string, number> = {};
  COLUMNS.forEach((c) => (columnCounts[c.key] = columnGroups[c.key].length));

  return (
    <div>
      <PageHeader title="维修看板" description="按车牌分区查看每个阶段的车辆与项目" />

      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/work-orders"
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
        >
          列表视图
        </Link>
        <Link
          href="/work-orders/board"
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200"
        >
          维修看板
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {COLUMNS.map((col) => {
          const groups = columnGroups[col.key];
          return (
            <div key={col.key} className={`rounded-xl border ${col.color} p-3`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">{col.label}</h3>
                <span className="text-xs text-gray-500">{columnCounts[col.key]}</span>
              </div>
              <div className="space-y-2.5">
                {groups.length === 0 && (
                  <div className="text-xs text-gray-400 text-center py-4">暂无</div>
                )}
                {groups.map((g, idx) => (
                  <div
                    key={`${col.key}_${g.order.id}_${idx}`}
                    className="bg-white rounded-lg border border-gray-100 p-2 hover:shadow-sm transition-shadow"
                  >
                    {/* 分区头：车牌 + 工单状态 + 工单号/车型 + 交车时间 */}
                    <Link href={`/work-orders/${g.order.id}`} className="block">
                      <div className="flex items-center justify-between gap-1">
                        <div className="text-sm font-semibold text-gray-900 truncate">
                          {g.order.vehicles?.plate_number || "-"}
                        </div>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                            ORDER_STATUS_COLORS[g.order.status] || "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {ORDER_STATUS_LABELS[g.order.status] || g.order.status}
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-500 truncate mt-0.5">
                        {g.order.order_no}
                        {g.order.vehicles?.brand ? " · " : ""}
                        {g.order.vehicles?.brand}
                        {g.order.vehicles?.model ? " " : ""}
                        {g.order.vehicles?.model}
                      </div>
                      {g.order.estimated_completion_at && (
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          交车 {formatDeliveryDate(g.order.estimated_completion_at)}
                        </div>
                      )}
                    </Link>

                    {/* 分区内容 */}
                    {col.key === "settled" ? (
                      <div className="text-xs text-emerald-700 font-medium text-center mt-1.5 pt-1.5 border-t border-emerald-100">
                        ✓ 已结单
                      </div>
                    ) : g.isPlaceholder ? (
                      <div className="text-xs text-gray-500 italic text-center mt-1.5 pt-1.5 border-t border-dashed border-gray-200">
                        待添加维修项目
                      </div>
                    ) : (
                      <div className="mt-1.5 pt-1.5 border-t border-gray-100 space-y-1">
                        {g.items.map((it: any) => (
                          <div key={it.id} className="text-xs">
                            <div className="text-gray-900 truncate">{it.alias_name || it.name}</div>
                            <div className="text-[10px] text-gray-500 truncate">
                              {it.profiles?.full_name || "未派工"}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
