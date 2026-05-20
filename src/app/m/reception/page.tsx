import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function MobileReceptionListPage() {
  const supabase = await createClient();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: orders } = await supabase
    .from("work_orders")
    .select("id, order_no, status, received_at, mileage_in, fuel_level, vehicles(plate_number, brand, model), customers(name, phone)")
    .gte("created_at", today.toISOString())
    .order("created_at", { ascending: false });

  const statusLabel: Record<string, string> = {
    received: "已接车",
    pending_diagnosis: "待诊断",
    pending_repair: "待维修",
    repairing: "维修中",
    pending_quality_check: "待质检",
    pending_close: "待结算",
    pending_settlement: "待结算",
    settled: "已结算",
    delivered: "已交车",
  };

  const statusColor: Record<string, string> = {
    received: "bg-blue-50 text-blue-700",
    pending_diagnosis: "bg-orange-50 text-orange-700",
    pending_repair: "bg-yellow-50 text-yellow-700",
    repairing: "bg-green-50 text-green-700",
    pending_quality_check: "bg-purple-50 text-purple-700",
    pending_close: "bg-gray-50 text-gray-700",
    pending_settlement: "bg-gray-50 text-gray-700",
    settled: "bg-gray-50 text-gray-500",
    delivered: "bg-gray-50 text-gray-400",
  };

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-40 bg-white border-b border-gray-200 flex items-center justify-between px-4 h-12 shrink-0">
        <h1 className="text-base font-semibold text-gray-900">接车登记</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">今日 {orders?.length ?? 0} 单</span>
          <Link href="/m/" className="flex items-center justify-center w-8 h-8 text-gray-500 hover:text-blue-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {orders && orders.length > 0 ? (
          orders.map((order: any) => (
            <Link
              key={order.id}
              href={`/work-orders/${order.id}`}
              className="block bg-white rounded-xl border border-gray-200 p-3 space-y-2 active:scale-[0.98] transition-transform"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-900">
                  {order.vehicles?.plate_number || "无车牌"}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded ${statusColor[order.status] || "bg-gray-50 text-gray-600"}`}>
                  {statusLabel[order.status] || order.status}
                </span>
              </div>
              <div className="text-sm text-gray-600">
                {order.customers?.name} · {order.customers?.phone}
              </div>
              <div className="text-xs text-gray-400 flex items-center gap-3">
                <span>里程: {order.mileage_in} km</span>
                {order.fuel_level != null && <span>油量: {order.fuel_level}%</span>}
              </div>
            </Link>
          ))
        ) : (
          <div className="text-center text-gray-400 py-12 text-sm">
            今日暂无接车记录
          </div>
        )}
      </div>

      <div className="p-3 bg-white border-t border-gray-200 shrink-0">
        <Link
          href="/m/reception/new"
          className="block w-full py-3 bg-blue-600 text-white text-center text-sm font-medium rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors"
        >
          + 新建接车登记
        </Link>
      </div>
    </div>
  );
}
