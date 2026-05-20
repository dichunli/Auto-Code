import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function MobileReceivingListPage() {
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("purchase_orders")
    .select("id, order_no, status, suppliers(name), created_at")
    .in("status", ["pending_receipt", "partial_receipt"])
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-40 bg-white border-b border-gray-200 flex items-center justify-between px-4 h-12 shrink-0">
        <h1 className="text-base font-semibold text-gray-900">手机收货</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">待收货 {(orders?.length ?? 0)} 单</span>
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
              href={`/procurement/${order.id}`}
              className="block bg-white rounded-xl border border-gray-200 p-3 space-y-2 active:scale-[0.98] transition-transform"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-900">{order.order_no}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700">
                  {order.status === "pending_receipt" ? "待收货" : "部分收货"}
                </span>
              </div>
              <div className="text-sm text-gray-600">
                供应商: {order.suppliers?.name || "-"}
              </div>
              <div className="text-xs text-gray-400">
                下单日期: {new Date(order.created_at).toLocaleDateString("zh-CN")}
              </div>
            </Link>
          ))
        ) : (
          <div className="text-center text-gray-400 py-12 text-sm">
            暂无待收货采购单
          </div>
        )}
      </div>
    </div>
  );
}
