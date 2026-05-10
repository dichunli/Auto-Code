"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import { WorkOrderTabBar } from "@/components/WorkOrderTabBar";
import WorkOrderSearch from "@/components/WorkOrderSearch";

interface Order {
  id: string;
  order_no: string;
  status: string;
  total_cost: number;
  created_at: string;
  vehicles: { plate_number: string; brand: string; model: string; vin: string } | null;
  customers: { name: string; phone: string; company: string } | null;
}

function normalizeOrder(raw: any): Order {
  const v = raw.vehicles;
  const c = raw.customers;
  return {
    id: raw.id,
    order_no: raw.order_no,
    status: raw.status,
    total_cost: raw.total_cost,
    created_at: raw.created_at,
    vehicles: Array.isArray(v) ? v[0] || null : v || null,
    customers: Array.isArray(c) ? c[0] || null : c || null,
  };
}

const statusFilters = [
  { value: "", label: "全部" },
  { value: "pending_diagnosis", label: "待诊断" },
  { value: "pending_repair", label: "待维修" },
  { value: "repairing", label: "维修中" },
  { value: "pending_quality_check", label: "待质检" },
  { value: "pending_close", label: "待结单" },
  { value: "pending_settlement", label: "待结算" },
  { value: "settled", label: "已结算" },
];

const typeLabelMap: Record<string, string> = {
  normal: "正常工单",
  appointment: "预约单",
  quote: "报价单",
  maintenance: "保养工单",
  cancelled: "作废工单",
};

export default function WorkOrdersPage() {
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
      let q = supabase
        .from("work_orders")
        .select("id, order_no, status, total_cost, created_at, vehicles(plate_number, brand, model, vin), customers(name, phone, company)")
        .order("created_at", { ascending: false });

      if (status) q = q.eq("status", status);

      const { data, error } = await q;
      if (error) {
        setQueryError(error.message);
        setOrders([]);
      } else {
        setQueryError(null);
        let result = (data || []).map(normalizeOrder);
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
                    <StatusBadge status={order.status} />
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
