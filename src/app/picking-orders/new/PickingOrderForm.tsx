"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 创建领料单, type 领料明细输入 } from "@/app/picking-orders/actions";
import type { 待领料分支, 可用批次, 工单概要 } from "./page";

interface Props {
  工单: 工单概要 | null;
  分支列表: 待领料分支[];
  批次列表: 可用批次[];
}

/* 批量开领料单表单:勾选配件 → 分配批次 → 一次开单 */
export default function PickingOrderForm({ 工单, 分支列表, 批次列表 }: Props) {
  const router = useRouter();
  const [勾选, 设勾选] = useState<Set<string>>(() => new Set(分支列表.map((b) => b.id)));
  const [分配, 设分配] = useState<Record<string, Record<string, number>>>({});
  const [领料人, 设领料人] = useState("");
  const [备注, 设备注] = useState("");
  const [提交中, 设提交中] = useState(false);

  const 批次按配件 = useMemo(() => {
    const map: Record<string, 可用批次[]> = {};
    for (const b of 批次列表) {
      if (!map[b.part_id]) map[b.part_id] = [];
      map[b.part_id].push(b);
    }
    return map;
  }, [批次列表]);

  function 分支已配数量(分支id: string): number {
    return Object.values(分配[分支id] || {}).reduce((a, b) => a + b, 0);
  }

  function 设批次数量(分支id: string, 批次id: string, 数量: number, 批次剩余: number) {
    const 有效值 = Math.max(0, Math.min(数量, 批次剩余));
    设分配((prev) => {
      const 分支分配 = { ...(prev[分支id] || {}) };
      if (有效值 === 0) {
        delete 分支分配[批次id];
      } else {
        分支分配[批次id] = 有效值;
      }
      return { ...prev, [分支id]: 分支分配 };
    });
  }

  /* 自动按先进先出分配满该分支的剩余需领数量 */
  function 自动分配(分支: 待领料分支) {
    const 批次 = 批次按配件[分支.part_id] || [];
    let 待分 = 分支.剩余需领;
    const 结果: Record<string, number> = {};
    for (const b of 批次) {
      if (待分 <= 0) break;
      const 本批 = Math.min(待分, b.remaining);
      if (本批 > 0) {
        结果[b.id] = 本批;
        待分 -= 本批;
      }
    }
    设分配((prev) => ({ ...prev, [分支.id]: 结果 }));
  }

  function 切换勾选(分支id: string) {
    设勾选((prev) => {
      const next = new Set(prev);
      if (next.has(分支id)) {
        next.delete(分支id);
      } else {
        next.add(分支id);
      }
      return next;
    });
  }

  /* 校验:每个勾选分支的分配数量必须在 1 ~ 剩余需领 之间 */
  const 勾选分支 = 分支列表.filter((b) => 勾选.has(b.id));
  const 可提交 =
    勾选分支.length > 0 &&
    勾选分支.every((b) => {
      const 已配 = 分支已配数量(b.id);
      return 已配 > 0 && 已配 <= b.剩余需领;
    });

  async function 提交() {
    if (!可提交 || 提交中) return;
    设提交中(true);
    try {
      const 明细: 领料明细输入[] = [];
      for (const b of 勾选分支) {
        const 分支批次 = 批次按配件[b.part_id] || [];
        for (const [批次id, 数量] of Object.entries(分配[b.id] || {})) {
          if (数量 <= 0) continue;
          const 批次 = 分支批次.find((x) => x.id === 批次id);
          明细.push({
            work_order_item_part_id: b.id,
            part_id: b.part_id,
            batch_id: 批次id,
            quantity: 数量,
            part_number: b.part_number,
            name: b.name,
            brand: b.brand,
            specification: b.specification,
            unit: b.unit,
            batch_no: 批次?.batch_no || null,
            unit_cost: 批次?.unit_cost ?? null,
          });
        }
      }

      const 结果 = await 创建领料单(工单?.id || null, 明细, 领料人, 备注);
      if (!结果.success) {
        alert("开单失败: " + (结果.error || "未知错误"));
        return;
      }
      router.push(`/picking-orders/${结果.data!.id}`);
    } catch (err: unknown) {
      alert("开单失败: " + (err instanceof Error ? err.message : "未知错误"));
    } finally {
      设提交中(false);
    }
  }

  if (!工单) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          工单不存在
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">开领料单</h1>
          <p className="text-xs text-gray-500 mt-1">
            工单 {工单.order_no} · {工单.车牌} · {工单.客户}
          </p>
        </div>
        <Link href="/picking-orders/new" className="text-sm text-blue-600 hover:text-blue-700">
          ← 重新选择工单
        </Link>
      </div>

      {分支列表.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          该工单没有待领料的配件
        </div>
      ) : (
        <div className="space-y-4">
          {分支列表.map((b) => {
            const 批次 = 批次按配件[b.part_id] || [];
            const 已配 = 分支已配数量(b.id);
            return (
              <div
                key={b.id}
                className={`bg-white rounded-xl border overflow-hidden ${
                  勾选.has(b.id) ? "border-blue-300" : "border-gray-200 opacity-60"
                }`}
              >
                <div className="px-5 py-3 flex items-center gap-3 border-b border-gray-100">
                  <input
                    type="checkbox"
                    checked={勾选.has(b.id)}
                    onChange={() => 切换勾选(b.id)}
                    className="w-4 h-4"
                  />
                  <div className="flex-1">
                    <span className="font-medium text-gray-900">{b.name || "-"}</span>
                    <span className="text-xs text-gray-500 ml-2">
                      {b.brand || ""} {b.specification || ""}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    需领 <span className="font-medium text-gray-900">{b.剩余需领}</span>
                    {b.已领数量 > 0 && <span className="ml-1">(已领 {b.已领数量})</span>}
                  </div>
                  {勾选.has(b.id) && 批次.length > 0 && (
                    <button
                      type="button"
                      onClick={() => 自动分配(b)}
                      className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
                    >
                      自动分配
                    </button>
                  )}
                </div>

                {勾选.has(b.id) && (
                  <div className="px-5 py-3">
                    {批次.length === 0 ? (
                      <div className="text-sm text-red-500">该配件没有可用库存批次,请先入库</div>
                    ) : (
                      <div className="space-y-2">
                        {批次.map((p) => (
                          <div key={p.id} className="flex items-center gap-3 text-sm">
                            <div className="flex-1 text-gray-600">
                              批次 {p.batch_no || "-"}
                              <span className="text-xs text-gray-400 ml-2">
                                剩余 {p.remaining}
                                {p.unit_cost != null && ` · ¥${p.unit_cost}`}
                                {p.inbound_at && ` · ${p.inbound_at.slice(0, 10)} 入库`}
                              </span>
                            </div>
                            <input
                              type="number"
                              min={0}
                              max={p.remaining}
                              value={(分配[b.id] || {})[p.id] || 0}
                              onChange={(e) =>
                                设批次数量(b.id, p.id, parseInt(e.target.value) || 0, p.remaining)
                              }
                              className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-right"
                            />
                          </div>
                        ))}
                        <div
                          className={`text-xs pt-1 ${
                            已配 === 0
                              ? "text-gray-400"
                              : 已配 > b.剩余需领
                                ? "text-red-500"
                                : "text-green-600"
                          }`}
                        >
                          已分配 {已配} / 需领 {b.剩余需领}
                          {已配 > b.剩余需领 && " (超出需领数量)"}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 w-20">领料人</label>
              <input
                type="text"
                value={领料人}
                onChange={(e) => 设领料人(e.target.value)}
                placeholder="谁领的料(选填)"
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
              href="/picking-orders"
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              取消
            </Link>
            <button
              type="button"
              onClick={提交}
              disabled={!可提交 || 提交中}
              className="px-6 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {提交中 ? "开单中..." : `确认开单(共 ${勾选分支.reduce((s, b) => s + 分支已配数量(b.id), 0)} 件)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
