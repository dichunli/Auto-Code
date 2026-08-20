import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

/* 2026-08-20 手机收货页重设计：
   顶部两个大操作卡（新建到货单/批量建运单）→ 到货单进度卡片（主战场）
   → 老流程待收货采购单收底（在途旧单收完为止） */

interface 采购单 {
  id: string;
  order_no: string;
  status: string;
  suppliers: { name: string } | null;
  created_at: string;
}

interface 到货单 {
  id: string;
  receipt_no: string;
  status: string;
  created_at: string;
  suppliers: { name: string } | null;
  arrival_receipt_items: { id: string; handling: string | null }[];
}

const 采购单状态标签: Record<string, string> = {
  submitted: "待收货",
  approved: "待收货",
  partial_received: "部分收货",
};

export default async function MobileReceivingListPage() {
  const supabase = await createClient();

  const [{ data: orders }, { data: receipts }] = await Promise.all([
    /* 老流程待收货采购单（合法状态：submitted/approved/partial_received） */
    supabase
      .from("purchase_orders")
      .select("id, order_no, status, suppliers(name), created_at")
      .in("status", ["submitted", "approved", "partial_received"])
      .order("created_at", { ascending: false })
      .limit(50),
    /* 进行中的到货单（验货中+待入库），带明细算进度 */
    supabase
      .from("arrival_receipts")
      .select("id, receipt_no, status, created_at, suppliers(name), arrival_receipt_items(id, handling)")
      .in("status", ["receiving", "confirmed"])
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const 单列表 = (orders || []) as unknown as 采购单[];
  const 到货列表 = (receipts || []) as unknown as 到货单[];

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-40 bg-white border-b border-gray-200 flex items-center justify-between px-4 h-12 shrink-0">
        <h1 className="text-base font-semibold text-gray-900">收货</h1>
        <Link href="/m/" className="flex items-center justify-center w-8 h-8 text-gray-500 hover:text-blue-600 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* 两个大操作卡 */}
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/m/receiving/arrivals/new"
            className="bg-green-600 rounded-xl p-4 text-white active:scale-[0.98] transition-transform"
          >
            <svg className="w-7 h-7 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <div className="font-semibold text-sm">新建到货单</div>
            <div className="text-xs text-green-100 mt-0.5">逐件验货 · 定仓位</div>
          </Link>
          <Link
            href="/m/receiving/waybills"
            className="bg-blue-600 rounded-xl p-4 text-white active:scale-[0.98] transition-transform"
          >
            <svg className="w-7 h-7 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8m-8 4h8m-8 4h5m-9 8h10a2 2 0 002-2V7a2 2 0 00-2-2H8a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <div className="font-semibold text-sm">批量建运单</div>
            <div className="text-xs text-blue-100 mt-0.5">选公司 · 批量录入</div>
          </Link>
        </div>

        {/* 到货单（主战场） */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-900">到货确认单</h2>
            <Link href="/m/receiving/arrivals" className="text-xs text-blue-600">
              全部 →
            </Link>
          </div>
          {到货列表.length > 0 ? (
            <div className="space-y-2">
              {到货列表.map((单) => {
                const 总数 = 单.arrival_receipt_items?.length || 0;
                const 已验 = (单.arrival_receipt_items || []).filter((i) => i.handling && i.handling !== "skipped").length;
                const 验货中 = 单.status === "receiving";
                return (
                  <Link
                    key={单.id}
                    href={`/m/receiving/arrivals/${单.id}`}
                    className="block bg-white rounded-xl border border-gray-200 p-3 active:scale-[0.98] transition-transform"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-gray-900 text-sm">{单.receipt_no}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${验货中 ? "bg-orange-50 text-orange-700" : "bg-green-50 text-green-700"}`}>
                        {验货中 ? "验货中" : "待入库"}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mb-2">
                      {单.suppliers?.name || "-"} · {new Date(单.created_at).toLocaleDateString("zh-CN")}
                    </div>
                    {/* 验货进度条 */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${验货中 ? "bg-orange-400" : "bg-green-500"}`}
                          style={{ width: 总数 > 0 ? `${Math.round((已验 / 总数) * 100)}%` : "0%" }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">{已验}/{总数}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-dashed border-gray-200 p-6 text-center text-gray-400 text-sm">
              收到货点上面「新建到货单」开始验货
            </div>
          )}
        </div>

        {/* 老流程待收货采购单（收底） */}
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-2">
            待收货采购单
            <span className="ml-2 text-xs font-normal text-gray-400">老流程 · 共 {单列表.length} 单</span>
          </h2>
          {单列表.length > 0 ? (
            <div className="space-y-2">
              {单列表.map((order) => (
                <Link
                  key={order.id}
                  href={`/procurement/${order.id}`}
                  className="block bg-white rounded-xl border border-gray-200 p-3 space-y-1 active:scale-[0.98] transition-transform"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900 text-sm">{order.order_no}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700">
                      {采购单状态标签[order.status] || order.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {order.suppliers?.name || "-"} · {new Date(order.created_at).toLocaleDateString("zh-CN")}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-dashed border-gray-200 p-6 text-center text-gray-400 text-sm">
              暂无待收货采购单
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
