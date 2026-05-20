import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function MobileAssignmentListPage() {
  const supabase = await createClient();

  /* 可领工单: 待维修 */
  const { data: availableOrders } = await supabase
    .from("work_orders")
    .select("id, order_no, status, vehicles(plate_number, brand, model), customers(name, phone)")
    .eq("status", "pending_repair")
    .order("created_at", { ascending: false })
    .limit(30);

  /* 维修中工单 */
  const { data: activeOrders } = await supabase
    .from("work_orders")
    .select("id, order_no, status, vehicles(plate_number, brand, model), customers(name, phone)")
    .eq("status", "repairing")
    .order("created_at", { ascending: false })
    .limit(30);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-40 bg-white border-b border-gray-200 flex items-center justify-between px-4 h-12 shrink-0">
        <h1 className="text-base font-semibold text-gray-900">派工领单</h1>
        <Link href="/m/" className="flex items-center justify-center w-8 h-8 text-gray-500 hover:text-blue-600 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* 可领工单 */}
        <div>
          <div className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            可领工单 ({availableOrders?.length ?? 0})
          </div>
          {availableOrders && availableOrders.length > 0 ? (
            <div className="space-y-3">
              {availableOrders.map((order: any) => (
                <Link
                  key={order.id}
                  href={`/work-orders/${order.id}`}
                  className="block bg-white rounded-xl border border-gray-200 p-3 space-y-2 active:scale-[0.98] transition-transform"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900">
                      {order.vehicles?.plate_number || "无车牌"}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700">
                      可领
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">
                    {order.customers?.name} · {order.customers?.phone}
                  </div>
                  <div className="text-xs text-gray-400">
                    工单: {order.order_no}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-400 py-6 text-sm bg-white rounded-xl border border-gray-200">
              暂无可领工单
            </div>
          )}
        </div>

        {/* 维修中 */}
        <div>
          <div className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            维修中 ({activeOrders?.length ?? 0})
          </div>
          {activeOrders && activeOrders.length > 0 ? (
            <div className="space-y-3">
              {activeOrders.map((order: any) => (
                <Link
                  key={order.id}
                  href={`/work-orders/${order.id}`}
                  className="block bg-white rounded-xl border border-gray-200 p-3 space-y-2 active:scale-[0.98] transition-transform"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900">
                      {order.vehicles?.plate_number || "无车牌"}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                      维修中
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">
                    {order.customers?.name} · {order.customers?.phone}
                  </div>
                  <div className="text-xs text-gray-400">
                    工单: {order.order_no}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-400 py-6 text-sm bg-white rounded-xl border border-gray-200">
              暂无维修中工单
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
