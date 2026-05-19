"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";

const returnReasonMap: Record<string, string> = {
  wrong_ship: "错发",
  excess: "多发退货",
  damaged: "损坏",
  cancel: "客户悔单",
  quality: "质量问题",
};

const statusMap: Record<string, { label: string; class: string }> = {
  pending: { label: "待处理", class: "bg-yellow-50 text-yellow-700" },
  completed: { label: "已完成", class: "bg-green-50 text-green-700" },
};

export default function SupplierReturnsPage() {
  const supabase = createClient();
  const [records, setRecords] = useState<any[]>([]);
  const [allRecords, setAllRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  async function loadRecords() {
    setLoading(true);
    let q = supabase
      .from("supplier_return_records")
      .select("*, work_order_item_parts(name, part_number), profiles(full_name), purchase_return_orders(id, return_no)")
      .order("created_at", { ascending: false });

    if (statusFilter) {
      q = q.eq("status", statusFilter);
    }

    const { data, error } = await q;
    if (error) {
      alert("加载失败: " + error.message);
      setLoading(false);
      return;
    }

    const result = data || [];
    setAllRecords(result);
    filterRecords(result, query);
    setLoading(false);
  }

  function filterRecords(source: any[], search: string) {
    if (!search.trim()) {
      setRecords(source);
      return;
    }
    const sq = search.trim().toLowerCase();
    const filtered = source.filter((r) => {
      const partName = r.work_order_item_parts?.name || "";
      const partNumber = r.work_order_item_parts?.part_number || "";
      const supplierName = r.supplier_name || "";
      return (
        partName.toLowerCase().includes(sq) ||
        partNumber.toLowerCase().includes(sq) ||
        supplierName.toLowerCase().includes(sq)
      );
    });
    setRecords(filtered);
  }

  useEffect(() => {
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, supabase]);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      filterRecords(allRecords, query);
    }, 300);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [query, allRecords]);

  async function handleUpdateStatus(id: string, newStatus: string) {
    const { error } = await supabase
      .from("supplier_return_records")
      .update({ status: newStatus })
      .eq("id", id);
    if (error) {
      alert("更新失败: " + error.message);
      return;
    }
    loadRecords();
  }

  return (
    <div>
      <PageHeader
        title="退货记录"
        description="管理供应商退货记录"
        action={{ href: "/procurement", label: "采购管理" }}
      />

      {/* 快捷入口 */}
      <div className="mb-4 flex items-center gap-2">
        <Link
          href="/return-orders"
          className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          采退单列表
        </Link>
        <Link
          href="/inbound-orders"
          className="px-3 py-1.5 text-xs rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
        >
          入库单列表
        </Link>
      </div>

      {/* 筛选栏 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="搜索配件名称、编号、供应商..."
          className="w-full max-w-sm px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">全部状态</option>
          <option value="pending">待处理</option>
          <option value="completed">已完成</option>
        </select>
        {query.trim() && (
          <button
            onClick={() => setQuery("")}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            清空
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">配件名称</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">退货原因</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">数量</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">供应商</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">物流信息</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">状态</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">关联采退单</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">退货照片</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">时间</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records.map((r) => {
                const s = statusMap[r.status] || { label: r.status, class: "bg-gray-50 text-gray-600" };
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{r.work_order_item_parts?.name || "-"}</div>
                      {r.work_order_item_parts?.part_number && (
                        <div className="text-xs text-gray-400">{r.work_order_item_parts.part_number}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{returnReasonMap[r.return_reason] || r.return_reason}</td>
                    <td className="px-6 py-4 text-gray-600">{r.quantity}</td>
                    <td className="px-6 py-4 text-gray-600">{r.supplier_name || "-"}</td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {r.logistics_company && r.tracking_no ? (
                        <div>
                          <div>{r.logistics_company}</div>
                          <div className="text-gray-400">{r.tracking_no}</div>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded ${s.class}`}>{s.label}</span>
                    </td>
                    <td className="px-6 py-4">
                      {r.purchase_return_orders ? (
                        <Link
                          href={`/return-orders/${r.purchase_return_orders.id}`}
                          className="text-xs text-blue-600 hover:text-blue-700"
                        >
                          {r.purchase_return_orders.return_no}
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {r.photos && r.photos.length > 0 ? (
                        <div className="flex gap-1">
                          {r.photos.slice(0, 3).map((url: string, i: number) => (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                              <img src={url} alt="" className="w-8 h-8 object-cover rounded border border-gray-200 hover:opacity-80" />
                            </a>
                          ))}
                          {r.photos.length > 3 && (
                            <span className="text-xs text-gray-400 self-center">+{r.photos.length - 3}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {new Date(r.created_at).toLocaleString("zh-CN")}
                    </td>
                    <td className="px-6 py-4">
                      {r.status === "pending" && !r.purchase_return_orders && (
                        <button
                          onClick={() => {
                            if (confirm("确认标记为已完成？")) {
                              handleUpdateStatus(r.id, "completed");
                            }
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          标记完成
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(!records || records.length === 0) && (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-gray-400">
                    {loading ? "加载中..." : "暂无退货记录"}
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
