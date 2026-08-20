import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

/* 2026-08-20 待收货改造二期：手机端到货确认单列表（首屏服务端查询） */

interface 到货单 {
  id: string;
  receipt_no: string;
  status: string;
  created_at: string;
  suppliers: { name: string } | null;
  logistics_waybills: { tracking_no: string } | null;
  arrival_receipt_items: { count: number }[];
}

const 状态标签: Record<string, { 文字: string; 样式: string }> = {
  receiving: { 文字: "验货中", 样式: "bg-orange-50 text-orange-700" },
  confirmed: { 文字: "待入库", 样式: "bg-green-50 text-green-700" },
  inbounded: { 文字: "已入库", 样式: "bg-gray-100 text-gray-500" },
};

export default async function MobileArrivalListPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("arrival_receipts")
    .select("id, receipt_no, status, created_at, suppliers(name), logistics_waybills(tracking_no), arrival_receipt_items(count)")
    .order("created_at", { ascending: false })
    .limit(50);

  const 列表 = (data || []) as unknown as 到货单[];

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-40 bg-white border-b border-gray-200 flex items-center justify-between px-4 h-12 shrink-0">
        <h1 className="text-base font-semibold text-gray-900">到货确认单</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/m/receiving"
            className="px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-600"
          >
            收货列表
          </Link>
          <Link
            href="/m/receiving/arrivals/new"
            className="px-2.5 py-1 text-xs rounded-lg bg-blue-600 text-white font-medium active:bg-blue-700"
          >
            新建到货单
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {列表.length > 0 ? (
          列表.map((单) => {
            const 标签 = 状态标签[单.status] || { 文字: 单.status, 样式: "bg-gray-100 text-gray-500" };
            return (
              <Link
                key={单.id}
                href={`/m/receiving/arrivals/${单.id}`}
                className="block bg-white rounded-xl border border-gray-200 p-3 space-y-2 active:scale-[0.98] transition-transform"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900">{单.receipt_no}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${标签.样式}`}>{标签.文字}</span>
                </div>
                <div className="text-sm text-gray-600">供应商: {单.suppliers?.name || "-"}</div>
                <div className="text-xs text-gray-400">
                  {单.logistics_waybills?.tracking_no ? `运单 ${单.logistics_waybills.tracking_no} · ` : ""}
                  {单.arrival_receipt_items?.[0]?.count ?? 0} 件 · {new Date(单.created_at).toLocaleDateString("zh-CN")}
                </div>
              </Link>
            );
          })
        ) : (
          <div className="text-center text-gray-400 py-12 text-sm">
            暂无到货确认单，点右上角「新建到货单」开始验货
          </div>
        )}
      </div>
    </div>
  );
}
