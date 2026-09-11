"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 退料类型标签 } from "@/lib/returnTypes";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { 确认退料申请, 取消退料申请 } from "@/app/material-returns/actions";

/* 待退料申请行（page.tsx 首屏查询注入） */
export interface 退料申请行 {
  id: string;
  quantity: number;
  return_type: string;
  reason: string | null;
  created_at: string;
  requested_by: string | null;
  work_order_item_parts: {
    id: string;
    name: string | null;
    alias_name: string | null;
    part_number: string | null;
    brand: string | null;
    specification: string | null;
    unit: string | null;
    part_names: { name: string } | null;
    work_order_items: {
      name: string;
      work_orders: { id: string; order_no: string; vehicles: { plate_number: string } | null } | null;
    } | null;
  } | null;
  part_picking_records: {
    id: string;
    quantity: number;
    picking_orders: { id: string; picking_no: string } | null;
  } | null;
}

interface Props {
  initialRequests: 退料申请行[];
  /* requested_by → 姓名（无外键，服务端单独查好传入） */
  申请人姓名: Record<string, string>;
}

/* 待退料列表：库管勾选申请 → 确认生成退料单（TL-）；也可驳回 */
export function PendingReturnRequestList({ initialRequests, 申请人姓名 }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [勾选, set勾选] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  function 切换勾选(id: string) {
    set勾选((prev) => {
      const 下一 = new Set(prev);
      if (下一.has(id)) 下一.delete(id);
      else 下一.add(id);
      return 下一;
    });
  }

  function 全选切换() {
    if (勾选.size === initialRequests.length) {
      set勾选(new Set());
    } else {
      set勾选(new Set(initialRequests.map((r) => r.id)));
    }
  }

  /* 确认退料：生成退料单（触发器加回库存），申请标 done。提示走全局轻提示条 */
  async function 确认退料() {
    if (勾选.size === 0) {
      showToast("请先勾选要确认的退料申请", "warning");
      return;
    }
    const 数量合计 = initialRequests
      .filter((r) => 勾选.has(r.id))
      .reduce((s, r) => s + r.quantity, 0);
    if (!(await 请求确认({ message: `确认这 ${勾选.size} 条退料申请（共 ${数量合计} 件）？将生成退料单并加回库存`, danger: false }))) {
      return;
    }
    setLoading(true);
    try {
      const r = await 确认退料申请(Array.from(勾选));
      if (!r.success) {
        showToast("确认退料失败: " + (r.error || "未知错误"), "error");
        return;
      }
      set勾选(new Set());
      showToast(`退料单已生成${r.退料单号?.length ? `（${r.退料单号.join("、")}）` : ""}，库存已加回`, "success");
      router.refresh();
    } catch (err: unknown) {
      showToast("确认退料失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setLoading(false);
    }
  }

  /* 驳回申请（标 cancelled，师傅端可重新发起） */
  async function 驳回(id: string) {
    if (!(await 请求确认("驳回这条退料申请？"))) return;
    setLoading(true);
    try {
      const r = await 取消退料申请(id);
      if (!r.success) {
        showToast("驳回失败: " + (r.error || "未知错误"), "error");
        return;
      }
      set勾选((prev) => {
        const 下一 = new Set(prev);
        下一.delete(id);
        return 下一;
      });
      router.refresh();
    } catch (err: unknown) {
      showToast("驳回失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setLoading(false);
    }
  }

  if (initialRequests.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        暂无待退料申请（师傅在手机端发起退料申请后会出现在这里）
      </div>
    );
  }

  return (
    <div>
      {/* 操作条 */}
      <div className="flex items-center gap-3 mb-3">
        <button
          type="button"
          onClick={确认退料}
          disabled={loading || 勾选.size === 0}
          className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? "处理中..." : `确认退料${勾选.size > 0 ? `（已选 ${勾选.size} 条）` : ""}`}
        </button>
        <span className="text-xs text-gray-400">确认后自动生成退料单并把库存加回</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={勾选.size === initialRequests.length && initialRequests.length > 0}
                    onChange={全选切换}
                    aria-label="全选"
                    className="accent-red-600"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">配件</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">所属工单</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">对应领料单</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">退料数量</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">类型</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">原因</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">申请人</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">申请时间</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {initialRequests.map((r) => {
                const 分支 = r.work_order_item_parts;
                const 工单 = 分支?.work_order_items?.work_orders;
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={勾选.has(r.id)}
                        onChange={() => 切换勾选(r.id)}
                        aria-label="选择该申请"
                        className="accent-red-600"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {分支?.alias_name || 分支?.name || 分支?.part_names?.name || "未命名配件"}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {[分支?.brand, 分支?.specification].filter(Boolean).join(" / ")}
                        {分支?.part_number && ` · ${分支.part_number}`}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {工单 ? (
                        <>
                          <Link
                            href={`/work-orders/${工单.id}`}
                            className="text-blue-600 hover:text-blue-700 font-medium"
                          >
                            {工单.order_no}
                          </Link>
                          <div className="text-xs text-gray-400">{工单.vehicles?.plate_number || "-"}</div>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {r.part_picking_records?.picking_orders ? (
                        <Link
                          href={`/picking-orders/${r.part_picking_records.picking_orders.id}`}
                          className="text-blue-600 hover:text-blue-700"
                        >
                          {r.part_picking_records.picking_orders.picking_no}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      {r.quantity} {分支?.unit || "个"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                        {退料类型标签[r.return_type] || r.return_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs max-w-[10rem] truncate">
                      {r.reason || "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {(r.requested_by && 申请人姓名[r.requested_by]) || "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(r.created_at).toLocaleString("zh-CN", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => 驳回(r.id)}
                        disabled={loading}
                        className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                      >
                        驳回
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {确认弹窗}
    </div>
  );
}
