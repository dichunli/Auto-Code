"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import { WorkOrderTabBar } from "@/components/WorkOrderTabBar";
import WorkOrderSearch from "@/components/WorkOrderSearch";

interface Order {
  id: string;
  order_no: string;
  status: string;
  boardStage: string;
  total_cost: number;
  created_at: string;
  vehicles: { plate_number: string; brand: string; model: string; vin: string } | null;
  customers: { name: string; phone: string; company: string } | null;
}

// 工单"已结单"对应的几种 work_orders.status
const SETTLED_STATUSES = ["settled", "delivered", "pending_close", "pending_settlement"];

const STAGE_LABELS: Record<string, string> = {
  pending_diagnosis: "待诊断",
  pending_dispatch: "待派工",
  pending_construction: "待施工",
  in_progress: "施工中",
  paused: "已中断",
  completed: "已完工",
  pending_qc: "已质检",
  settled: "已结单",
};

const STAGE_COLORS: Record<string, string> = {
  pending_diagnosis: "bg-gray-100 text-gray-700",
  pending_dispatch: "bg-slate-100 text-slate-700",
  pending_construction: "bg-orange-100 text-orange-700",
  in_progress: "bg-blue-100 text-blue-700",
  paused: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  pending_qc: "bg-purple-100 text-purple-700",
  settled: "bg-emerald-100 text-emerald-700",
};

// 综合 work_orders.status + work_order_items 计算该工单的"代表看板阶段"
function computeBoardStage(raw: any): string {
  const orderStatus = raw.status;
  if (SETTLED_STATUSES.includes(orderStatus)) return "settled";
  if (orderStatus === "pending_quality_check") return "pending_qc";

  const labors = (raw.work_order_items || []).filter((it: any) => it.item_type === "labor");
  if (labors.length === 0) return "pending_diagnosis";

  // 优先级（高→低）：已中断 → 施工中 → 已完工 → 待派工 → 待施工
  if (labors.some((it: any) => it.status === "paused")) return "paused";
  if (labors.some((it: any) => it.status === "in_progress")) return "in_progress";
  if (labors.every((it: any) => it.status === "completed")) return "completed";

  const hasUnassigned = labors.some(
    (it: any) => (it.status === "pending" || !it.status) && !it.mechanic_id
  );
  if (hasUnassigned) return "pending_dispatch";

  return "pending_construction";
}

function normalizeOrder(raw: any): Order {
  const v = raw.vehicles;
  const c = raw.customers;
  return {
    id: raw.id,
    order_no: raw.order_no,
    status: raw.status,
    boardStage: computeBoardStage(raw),
    total_cost: raw.total_cost,
    created_at: raw.created_at,
    vehicles: Array.isArray(v) ? v[0] || null : v || null,
    customers: Array.isArray(c) ? c[0] || null : c || null,
  };
}

const statusFilters = [
  { value: "", label: "全部" },
  { value: "pending_diagnosis", label: "待诊断" },
  { value: "pending_dispatch", label: "待派工" },
  { value: "pending_construction", label: "待施工" },
  { value: "in_progress", label: "施工中" },
  { value: "paused", label: "已中断" },
  { value: "completed", label: "已完工" },
  { value: "pending_qc", label: "已质检" },
  { value: "settled", label: "已结单" },
];

const typeLabelMap: Record<string, string> = {
  normal: "正常工单",
  appointment: "预约单",
  quote: "报价单",
  maintenance: "保养工单",
  cancelled: "作废工单",
};

export default function WorkOrdersContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = createClient();

  const status = searchParams.get("status") || "";
  const keyword = searchParams.get("keyword") || "";
  const type = searchParams.get("type") || "";
  const tabsParam = searchParams.get("tabs") || "";
  const tabs = tabsParam.split(",").filter(Boolean);

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [queryError, setQueryError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("work_orders")
        .select(`
          id, order_no, status, total_cost, created_at,
          vehicles(plate_number, brand, model, vin),
          customers(name, phone, company),
          work_order_items(id, status, mechanic_id, item_type)
        `)
        .order("created_at", { ascending: false });

      if (error) {
        setQueryError(error.message);
        setOrders([]);
      } else {
        setQueryError(null);
        let result = (data || []).map(normalizeOrder);

        // 按看板阶段筛选（URL 中的 status 参数实际表示 boardStage）
        if (status) {
          result = result.filter((o) => o.boardStage === status);
        }

        if (keyword?.trim()) {
          const k = keyword.trim().toLowerCase();
          result = result.filter((order) => {
            const orderNo = order.order_no?.toLowerCase() || "";
            const plate = order.vehicles?.plate_number?.toLowerCase() || "";
            const vin = order.vehicles?.vin?.toLowerCase() || "";
            const brand = order.vehicles?.brand?.toLowerCase() || "";
            const model = order.vehicles?.model?.toLowerCase() || "";
            const customerName = order.customers?.name?.toLowerCase() || "";
            const phone = order.customers?.phone?.toLowerCase() || "";
            const company = order.customers?.company?.toLowerCase() || "";
            return (
              orderNo.includes(k) ||
              plate.includes(k) ||
              vin.includes(k) ||
              brand.includes(k) ||
              model.includes(k) ||
              customerName.includes(k) ||
              phone.includes(k) ||
              company.includes(k)
            );
          });
        }
        setOrders(result);
      }
      setLoading(false);
    }
    load();
  }, [status, keyword, type, supabase]);

  function buildLink(params: Record<string, string>) {
    const sp = new URLSearchParams();
    if (type) sp.set("type", type);
    if (tabsParam) sp.set("tabs", tabsParam);
    Object.entries(params).forEach(([k, v]) => {
      if (v) sp.set(k, v);
      else sp.delete(k);
    });
    const qs = sp.toString();
    return qs ? `/work-orders?${qs}` : "/work-orders";
  }

  function openOrderTab(orderId: string) {
    const newTabs = tabs.includes(orderId) ? tabs : [...tabs, orderId];
    router.push(`/work-orders/${orderId}?tabs=${newTabs.join(",")}`);
  }

  const pageTitle = type ? typeLabelMap[type] || "工单管理" : "工单管理";

  return (
    <div>
      <WorkOrderTabBar tabs={tabsParam} />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">{pageTitle}</h1>
        <Link
          href="/work-orders/new"
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          新建工单
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-4 overflow-x-auto pb-1">
        <div className="flex gap-2">
          {statusFilters.map((filter) => (
            <Link
              key={filter.value}
              href={buildLink({ status: filter.value })}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                (status || "") === filter.value
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              {filter.label}
            </Link>
          ))}
        </div>
        <div className="flex-1" />
        <WorkOrderSearch />
      </div>

      <div className="flex items-center gap-2 mb-6">
        <Link
          href={buildLink({})}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200"
        >
          列表视图
        </Link>
        <Link
          href="/work-orders/board"
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
        >
          维修看板
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">工单号</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">车牌号</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">VIN</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">车型</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">客户名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">电话</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">单位</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">金额</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">创建时间</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders?.map((order: any) => (
                <tr key={order.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    <button
                      onClick={() => openOrderTab(order.id)}
                      className="text-blue-600 hover:text-blue-700 hover:underline text-left"
                    >
                      {order.order_no}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-gray-900">{order.vehicles?.plate_number || "-"}</td>
                  <td className="px-6 py-4 text-gray-600 font-mono text-xs">{order.vehicles?.vin || "-"}</td>
                  <td className="px-6 py-4 text-gray-600">{order.vehicles?.brand} {order.vehicles?.model}</td>
                  <td className="px-6 py-4 text-gray-900">{order.customers?.name || "-"}</td>
                  <td className="px-6 py-4 text-gray-500">{order.customers?.phone || "-"}</td>
                  <td className="px-6 py-4 text-gray-500">{order.customers?.company || "-"}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        STAGE_COLORS[order.boardStage] || "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {STAGE_LABELS[order.boardStage] || order.boardStage}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-900">{formatCurrency(order.total_cost)}</td>
                  <td className="px-6 py-4 text-gray-500">{formatDate(order.created_at)}</td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => openOrderTab(order.id)}
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                      查看详情
                    </button>
                  </td>
                </tr>
              ))}
              {queryError && (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-red-500">
                    查询失败: {queryError}
                  </td>
                </tr>
              )}
              {(!queryError && (!orders || orders.length === 0) && !loading) && (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-gray-400">
                    暂无工单数据
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-gray-400">
                    加载中...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
