"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const returnReasonMap: Record<string, string> = {
  wrong_ship: "错发",
  excess: "多发退货",
  damaged: "损坏",
  cancel: "客户悔单",
  quality: "质量问题",
};

interface ReturnOrderInfo {
  id: string;
  return_no: string;
}

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
  purchase_return_orders: ReturnOrderInfo | null;
}

export function CompletedReturnList() {
  const supabase = createClient();
  const [records, setRecords] = useState<ReturnRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    const { data, error } = await supabase
      .from("supplier_return_records")
      .select(
        "id, supplier_name, return_reason, quantity, logistics_company, tracking_no, photos, status, created_at, work_order_item_parts(name, part_number), profiles(full_name), purchase_return_orders(id, return_no)"
      )
      .eq("status", "completed")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("加载已退货记录失败:", error);
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

  async function handleRevoke(id: string) {
    if (!confirm("确认将该退货记录退回待退货状态?")) return;
    setSubmitting(`revoke-${id}`);
    try {
      /* 1. 查询关联的采退单 */
      const { data: record } = await supabase
        .from("supplier_return_records")
        .select("return_order_id")
        .eq("id", id)
        .single();

      const returnOrderId = record?.return_order_id;

      if (returnOrderId) {
        if (!confirm("该退货记录已关联采退单，撤销将同时删除采退单及关联财务记录，是否继续？")) {
          setSubmitting(null);
          return;
        }

        /* 2. 删除采退单明细 */
        await supabase
          .from("purchase_return_order_items")
          .delete()
          .eq("return_order_id", returnOrderId);

        /* 3. 删除关联财务记录 */
        await supabase
          .from("supplier_transactions")
          .delete()
          .eq("reference_type", "purchase_return_order")
          .eq("reference_id", returnOrderId);

        /* 4. 删除采退单 */
        await supabase
          .from("purchase_return_orders")
          .delete()
          .eq("id", returnOrderId);

        /* 5. 把同一张采退单下的所有退货记录改回 pending，并清除 return_order_id */
        await supabase
          .from("supplier_return_records")
          .update({ status: "pending", return_order_id: null })
          .eq("return_order_id", returnOrderId);
      } else {
        /* 没有采退单，直接改状态 */
        const { error } = await supabase
          .from("supplier_return_records")
          .update({ status: "pending" })
          .eq("id", id);
        if (error) throw error;
      }

      loadData();
    } catch (err: any) {
      alert("退回失败: " + (err.message || String(err)));
    } finally {
      setSubmitting(null);
    }
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
        暂无已退货记录
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
              <th className="px-6 py-3 text-left font-medium text-gray-500">采退单号</th>
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
                    onClick={() => handleRevoke(r.id)}
                    disabled={submitting === `revoke-${r.id}`}
                    className="text-xs text-orange-600 hover:text-orange-800 hover:underline disabled:opacity-50"
                  >
                    {submitting === `revoke-${r.id}` ? "处理中..." : "退回待退货"}
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
