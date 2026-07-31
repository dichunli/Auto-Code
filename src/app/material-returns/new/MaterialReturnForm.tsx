"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 创建退料单, type 退料明细输入 } from "@/app/material-returns/actions";
import { 退料类型选项 } from "@/lib/returnTypes";
import type { 可退记录, 领料单概要 } from "./page";

interface Props {
  领料单: (领料单概要 & { 工单id: string | null }) | null;
  记录列表: 可退记录[];
}

/* 按领料单开退料单:填每条记录的退料数量,一次开单 */
export default function MaterialReturnForm({ 领料单, 记录列表 }: Props) {
  const router = useRouter();
  const [数量, 设数量] = useState<Record<string, number>>({});
  const [退料类型, 设退料类型] = useState("excess");
  const [原因, 设原因] = useState("");
  const [备注, 设备注] = useState("");
  const [提交中, 设提交中] = useState(false);

  function 设记录数量(记录id: string, 值: number, 可退: number) {
    const 有效值 = Math.max(0, Math.min(值, 可退));
    设数量((prev) => {
      const next = { ...prev };
      if (有效值 === 0) {
        delete next[记录id];
      } else {
        next[记录id] = 有效值;
      }
      return next;
    });
  }

  const 总件数 = Object.values(数量).reduce((a, b) => a + b, 0);
  const 可提交 = 总件数 > 0;

  async function 提交() {
    if (!可提交 || 提交中 || !领料单) return;
    设提交中(true);
    try {
      const 明细: 退料明细输入[] = 记录列表
        .filter((r) => (数量[r.picking_record_id] || 0) > 0)
        .map((r) => ({
          work_order_item_part_id: r.work_order_item_part_id,
          picking_record_id: r.picking_record_id,
          part_id: r.part_id,
          batch_id: r.batch_id,
          quantity: 数量[r.picking_record_id],
          return_type: 退料类型,
          part_number: r.part_number,
          name: r.name,
          brand: r.brand,
          specification: r.specification,
          unit: r.unit,
          batch_no: r.batch_no,
          unit_cost: r.unit_cost,
        }));

      const 结果 = await 创建退料单(领料单.工单id, 领料单.id, 明细, 退料类型, 原因, 备注);
      if (!结果.success) {
        alert("开单失败: " + (结果.error || "未知错误"));
        return;
      }
      router.push(`/material-returns/${结果.data!.id}`);
    } catch (err: unknown) {
      alert("开单失败: " + (err instanceof Error ? err.message : "未知错误"));
    } finally {
      设提交中(false);
    }
  }

  if (!领料单) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          领料单不存在
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">开退料单</h1>
          <p className="text-xs text-gray-500 mt-1">
            领料单 {领料单.picking_no} · 工单 {领料单.工单号} · {领料单.车牌}
          </p>
        </div>
        <Link href="/material-returns/new" className="text-sm text-blue-600 hover:text-blue-700">
          ← 重新选择领料单
        </Link>
      </div>

      {记录列表.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          该领料单没有可退的配件
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 text-sm font-semibold text-gray-900">
              可退记录（填 0 表示不退）
            </div>
            <div className="divide-y divide-gray-100">
              {记录列表.map((r) => (
                <div key={r.picking_record_id} className="px-5 py-3 flex items-center gap-3">
                  <div className="flex-1">
                    <span className="font-medium text-gray-900">{r.name || "-"}</span>
                    <span className="text-xs text-gray-500 ml-2">
                      {r.brand || ""} {r.specification || ""} · 批次 {r.batch_no || "-"}
                    </span>
                    <div className="text-xs text-gray-400 mt-0.5">
                      已领 {r.已领} · 可退 {r.可退}
                    </div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={r.可退}
                    value={数量[r.picking_record_id] || 0}
                    onChange={(e) =>
                      设记录数量(r.picking_record_id, parseInt(e.target.value) || 0, r.可退)
                    }
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-right"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-2">退料类型</label>
              <div className="flex gap-2 flex-wrap">
                {退料类型选项.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => 设退料类型(t.key)}
                    className={`px-3 py-1.5 rounded border text-sm transition-colors ${
                      退料类型 === t.key
                        ? "bg-red-50 border-red-300 text-red-700"
                        : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 w-20">退料原因</label>
              <input
                type="text"
                value={原因}
                onChange={(e) => 设原因(e.target.value)}
                placeholder="选填"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 w-20">备注</label>
              <input
                type="text"
                value={备注}
                onChange={(e) => 设备注(e.target.value)}
                placeholder="选填"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Link
              href="/material-returns"
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              取消
            </Link>
            <button
              type="button"
              onClick={提交}
              disabled={!可提交 || 提交中}
              className="px-6 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {提交中 ? "开单中..." : `确认开单(共 ${总件数} 件)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
