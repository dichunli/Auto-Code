import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function MobileInspectionListPage() {
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("work_orders")
    .select("id, order_no, status, mileage_in, vehicles(plate_number, brand, model), customers(name, phone)")
    .in("status", ["received", "pending_diagnosis"])
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-40 bg-white border-b border-gray-200 flex items-center justify-between px-4 h-12 shrink-0">
        <h1 className="text-base font-semibold text-gray-900">车况检查</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">待检查 {(orders?.length ?? 0)} 单</span>
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
              href={`/work-orders/${order.id}/inspection/new`}
              className="block bg-white rounded-xl border border-gray-200 p-3 space-y-2 active:scale-[0.98] transition-transform"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-900">
                  {order.vehicles?.plate_number || "无车牌"}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-orange-50 text-orange-700">
                  待检查
                </span>
              </div>
              <div className="text-sm text-gray-600">
                {order.customers?.name} · {order.customers?.phone}
              </div>
              <div className="text-xs text-gray-400">
                里程: {order.mileage_in} km · 工单: {order.order_no}
              </div>
            </Link>
          ))
        ) : (
          <div className="text-center text-gray-400 py-12 text-sm">
            暂无待检查工单
          </div>
        )}
      </div>
    </div>
  );
}
