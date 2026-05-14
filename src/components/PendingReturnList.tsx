"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const returnReasonMap: Record<string, string> = {
  wrong_ship: "错发",
  excess: "多发",
  damaged: "损坏",
  cancel: "客户悔单",
  quality: "质量问题",
};

interface ReturnRecord {
  id: string;
  supplier_name: string | null;
  return_reason: string;
  quantity: number;
  logistics_company: string | null;
  tracking_no: string | null;
  photos: string[] | null;
  status: string;
  created_at: string;
  work_order_item_parts: { name: string; part_number: string | null } | null;
  profiles: { full_name: string | null } | null;
}

export function PendingReturnList() {
  const supabase = createClient();
  const [records, setRecords] = useState<ReturnRecord[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    const { data, error } = await supabase
      .from("supplier_return_records")
      .select(
        "id, supplier_name, return_reason, quantity, logistics_company, tracking_no, photos, status, created_at, work_order_item_parts(name, part_number), profiles(full_name)"
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("加载待退货记录失败:", error);
      setLoading(false);
      return;
    }

    setRecords((data || []) as unknown as ReturnRecord[]);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleComplete(id: string) {
    if (!confirm("确认标记为已完成？")) return;
    const { error } = await supabase
      .from("supplier_return_records")
      .update({ status: "completed" })
      .eq("id", id);
    if (error) {
      alert("更新失败: " + error.message);
      return;
    }
    loadData();
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        加载中...
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        暂无待退货记录
      </div>
    );
  }

  return (
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
              <th className="px-6 py-3 text-left font-medium text-gray-500">退货照片</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">时间</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {records.map((r) => (
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
                  {r.photos && r.photos.length > 0 ? (
                    <div className="flex gap-1">
                      {r.photos.slice(0, 3).map((url, i) => (
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
                  <button
                    onClick={() => handleComplete(r.id)}
                    className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    标记完成
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
