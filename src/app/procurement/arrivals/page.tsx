import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

/* 2026-08-20 待收货改造二期：电脑端到货确认单列表（首屏服务端查询） */

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
  receiving: { 文字: "验货中", 样式: "bg-orange-100 text-orange-700" },
  confirmed: { 文字: "待入库", 样式: "bg-green-100 text-green-700" },
  inbounded: { 文字: "已入库", 样式: "bg-gray-100 text-gray-500" },
};

export default async function ArrivalListPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("arrival_receipts")
    .select("id, receipt_no, status, created_at, suppliers(name), logistics_waybills(tracking_no), arrival_receipt_items(count)")
    .order("created_at", { ascending: false })
    .limit(100);

  const 列表 = (data || []) as unknown as 到货单[];

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">到货确认单</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/procurement?tab=pending_receipt"
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            返回待收货
          </Link>
          <Link
            href="/procurement/arrivals/new"
            className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            新建到货单
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {列表.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">单号</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">供应商</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">运单</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">件数</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">状态</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {列表.map((单) => {
                const 标签 = 状态标签[单.status] || { 文字: 单.status, 样式: "bg-gray-100 text-gray-500" };
                return (
                  <tr key={单.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <Link href={`/procurement/arrivals/${单.id}`} className="text-blue-600 hover:underline font-medium">
                        {单.receipt_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-gray-700">{单.suppliers?.name || "-"}</td>
                    <td className="px-4 py-2 text-gray-500">{单.logistics_waybills?.tracking_no || "本地供货"}</td>
                    <td className="px-4 py-2 text-right text-gray-700">{单.arrival_receipt_items?.[0]?.count ?? 0}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${标签.样式}`}>{标签.文字}</span>
                    </td>
                    <td className="px-4 py-2 text-gray-500">{new Date(单.created_at).toLocaleString("zh-CN")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="p-12 text-center text-gray-400">暂无到货确认单，点右上角「新建到货单」开始验货</div>
        )}
      </div>
    </div>
  );
}
