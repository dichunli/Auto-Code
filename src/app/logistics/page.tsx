"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function LogisticsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [waybills, setWaybills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    loadWaybills();
  }, [filter]);

  async function loadWaybills() {
    setLoading(true);
    let query = supabase
      .from("logistics_waybills")
      .select("*, logistics_companies(name)")
      .order("created_at", { ascending: false });

    if (filter !== "all") {
      query = query.eq("status", filter);
    }

    const { data } = await query;
    setWaybills(data || []);
    setLoading(false);
  }

  const statusMap: Record<string, string> = {
    pending: "待签收",
    received: "已签收",
    returned: "已退回",
  };

  const statusColor: Record<string, string> = {
    pending: "bg-yellow-50 text-yellow-700",
    received: "bg-green-50 text-green-700",
    returned: "bg-red-50 text-red-700",
  };

  return (
    <div>
      <PageHeader
        title="物流运单"
        description="管理物流单号、运费、代收款"
      />

      <div className="flex items-center gap-3 mb-4">
        <select
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">全部状态</option>
          <option value="pending">待签收</option>
          <option value="received">已签收</option>
          <option value="returned">已退回</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">物流单号</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">物流公司</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">运费</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">代收款</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">状态</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">创建时间</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">备注</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {waybills.map((w) => (
              <tr key={w.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{w.tracking_no}</td>
                <td className="px-4 py-3 text-gray-600">{w.logistics_companies?.name || w.logistics_company_name || "-"}</td>
                <td className="px-4 py-3 text-gray-600">{formatCurrency(w.freight_amount)}</td>
                <td className="px-4 py-3 text-gray-600">{formatCurrency(w.cod_amount)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${statusColor[w.status] || "bg-gray-50 text-gray-500"}`}>
                    {statusMap[w.status] || w.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500">{formatDate(w.created_at)}</td>
                <td className="px-4 py-3 text-gray-500">{w.notes || "-"}</td>
              </tr>
            ))}
            {waybills.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  暂无运单记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
