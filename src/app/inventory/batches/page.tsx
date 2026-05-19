"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface BatchRecord {
  id: string;
  batch_no: string | null;
  quantity: number;
  unit_cost: number | null;
  inbound_type: string | null;
  reference_id: string | null;
  notes: string | null;
  created_at: string;
  parts: { name: string | null; part_number: string | null } | null;
}

export default function BatchesPage() {
  const supabase = createClient();
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  async function loadData() {
    setLoading(true);
    const { data, error } = await supabase
      .from("part_batches")
      .select("id, batch_no, quantity, unit_cost, inbound_type, reference_id, notes, created_at, parts(name, part_number)")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("加载批次记录失败:", error);
      setLoading(false);
      return;
    }
    setBatches((data || []) as unknown as BatchRecord[]);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return batches;
    const sq = query.trim().toLowerCase();
    return batches.filter((b) => {
      const partName = b.parts?.name || "";
      const partNumber = b.parts?.part_number || "";
      const batchNo = b.batch_no || "";
      return (
        partName.toLowerCase().includes(sq) ||
        partNumber.toLowerCase().includes(sq) ||
        batchNo.toLowerCase().includes(sq)
      );
    });
  }, [batches, query]);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      // 防抖搜索已在 useMemo 中实现
    }, 300);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [query]);

  const inboundTypeMap: Record<string, string> = {
    purchase: "采购入库",
    manual: "手动入库",
    return: "退货入库",
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">批次管理</h1>
        <Link href="/inventory" className="text-sm text-blue-600 hover:text-blue-700">
          ← 返回库存
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="搜索配件名称、编码、批次号..."
          className="w-full max-w-sm px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() && (
          <button
            onClick={() => setQuery("")}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            清空
          </button>
        )}
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          加载中...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          暂无批次记录
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">配件名称</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">零件编码</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">批次号</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">数量</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">成本价</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">入库类型</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">关联单据</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">备注</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">入库时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-gray-900 font-medium">
                      {b.parts?.name || "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{b.parts?.part_number || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">{b.batch_no || "-"}</td>
                    <td className="px-6 py-4 text-right text-gray-900">{b.quantity}</td>
                    <td className="px-6 py-4 text-right text-gray-900">
                      {b.unit_cost != null ? `¥${b.unit_cost.toFixed(2)}` : "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                        {inboundTypeMap[b.inbound_type || ""] || b.inbound_type || "-"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {b.inbound_type === "purchase" && b.reference_id ? (
                        <Link href={`/procurement/${b.reference_id}`} className="text-xs text-blue-600 hover:text-blue-700">
                          采购单
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-xs">{b.notes || "-"}</td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {new Date(b.created_at).toLocaleString("zh-CN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
