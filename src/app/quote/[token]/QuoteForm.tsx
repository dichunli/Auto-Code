"use client";

import { useState } from "react";
import { 按编码查配件, 提交报价, type 询价单公开信息 } from "../actions";

/* 供应商报价表单（手机端优先，大输入框大按钮）
 * 每行填：编码/品牌/规格（选填）+ 采购价（必填）；
 * 编码失焦自动查系统配件库带出品牌规格；
 * 提交后仍可修改，采购员采用后锁死只读 */

interface 行状态 {
  itemId: string;
  partName: string;
  quantity: number | null;
  unit: string;
  vehicleModel: string;
  partNumber: string;
  brand: string;
  spec: string;
  price: string;
  notes: string;
  /* 编码匹配反馈：matched=系统有这个编码 / none=没有 / ""=还没查 */
  matchHint: "" | "matched" | "none";
}

interface Props {
  token: string;
  初始数据: 询价单公开信息;
}

export default function QuoteForm({ token, 初始数据 }: Props) {
  const 只读 = 初始数据.status === "adopted";
  const [行列表, set行列表] = useState<行状态[]>(
    初始数据.items.map((i) => ({
      itemId: i.itemId,
      partName: i.partName,
      quantity: i.quantity,
      unit: i.unit,
      vehicleModel: i.vehicleModel,
      partNumber: i.quotedPartNumber,
      brand: i.quotedBrand,
      spec: i.quotedSpec,
      price: i.quotedPrice,
      notes: i.quotedNotes,
      matchHint: "",
    }))
  );
  const [提交中, set提交中] = useState(false);
  const [提交成功, set提交成功] = useState(初始数据.status === "submitted");

  function 改行(itemId: string, 字段: "partNumber" | "brand" | "spec" | "price" | "notes", 值: string) {
    set行列表((prev) =>
      prev.map((r) => (r.itemId === itemId ? { ...r, [字段]: 值, ...(字段 === "partNumber" ? { matchHint: "" as const } : {}) } : r))
    );
  }

  /* 编码失焦：查系统配件库，带出品牌/规格（供应商可再改） */
  async function 编码失焦(itemId: string) {
    const 行 = 行列表.find((r) => r.itemId === itemId);
    if (!行 || !行.partNumber.trim()) return;
    try {
      const 结果 = await 按编码查配件(token, 行.partNumber);
      set行列表((prev) =>
        prev.map((r) => {
          if (r.itemId !== itemId) return r;
          if (结果.success && 结果.data) {
            return {
              ...r,
              partNumber: 结果.data.partNumber || r.partNumber,
              brand: r.brand || 结果.data.brand,
              spec: r.spec || 结果.data.spec,
              matchHint: "matched" as const,
            };
          }
          return { ...r, matchHint: "none" as const };
        })
      );
    } catch {
      /* 查询失败不打扰填价 */
    }
  }

  async function 提交() {
    /* 前端先校验：每行都要填采购价 */
    for (const r of 行列表) {
      const 价 = Number(r.price);
      if (!r.price.trim() || !Number.isFinite(价) || 价 <= 0) {
        alert(`「${r.partName}」还没填采购价，每行都要填`);
        return;
      }
    }
    set提交中(true);
    try {
      const 结果 = await 提交报价(
        token,
        行列表.map((r) => ({
          itemId: r.itemId,
          partNumber: r.partNumber,
          brand: r.brand,
          spec: r.spec,
          price: r.price,
          notes: r.notes,
        }))
      );
      set提交中(false);
      if (!结果.success) {
        alert("提交失败: " + (结果.error || "未知错误"));
        return;
      }
      set提交成功(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: unknown) {
      set提交中(false);
      alert("提交失败: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  const 截止时间 = new Date(初始数据.expiresAt).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="max-w-lg mx-auto">
        {/* 头部 */}
        <div className="bg-blue-600 text-white px-5 py-6">
          <div className="text-lg font-bold">配件报价单</div>
          <div className="text-blue-100 text-sm mt-1">
            {初始数据.supplierName} 您好，请为以下 {行列表.length} 个配件报价
          </div>
        </div>

        {/* 状态横幅 */}
        {只读 && (
          <div className="mx-4 mt-4 rounded-xl bg-gray-100 border border-gray-200 px-4 py-3 text-sm text-gray-600 text-center">
            该报价已被采购员采用，不能再修改。感谢您的配合！
          </div>
        )}
        {提交成功 && !只读 && (
          <div className="mx-4 mt-4 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 text-center">
            ✅ 报价已提交。如需修改，直接改完重新提交即可
          </div>
        )}
        {!只读 && (
          <div className="mx-4 mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs text-amber-700 text-center">
            请于 {截止时间} 前提交，过期链接将失效
          </div>
        )}

        {/* 配件行 */}
        <div className="px-4 mt-4 space-y-4">
          {行列表.map((r, 序号) => (
            <div key={r.itemId} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="text-base font-semibold text-gray-900">
                  {序号 + 1}. {r.partName}
                </div>
                <div className="shrink-0 text-sm text-gray-500">
                  {r.quantity ?? "—"} {r.unit}
                </div>
              </div>
              {r.vehicleModel && (
                <div className="text-xs text-gray-400 mb-3">车型：{r.vehicleModel}</div>
              )}

              <div className="space-y-3">
                <div>
                  <input
                    type="text"
                    disabled={只读}
                    value={r.partNumber}
                    onChange={(e) => 改行(r.itemId, "partNumber", e.target.value)}
                    onBlur={() => 编码失焦(r.itemId)}
                    placeholder="配件编码（选填）"
                    className="w-full px-3 py-2.5 text-base rounded-lg border border-gray-200 focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
                  />
                  {r.matchHint === "matched" && (
                    <div className="text-xs text-green-600 mt-1">✓ 编码已匹配系统配件，品牌规格已带出</div>
                  )}
                  {r.matchHint === "none" && (
                    <div className="text-xs text-gray-400 mt-1">编码不在系统配件库中，将按您填写的保存</div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    disabled={只读}
                    value={r.brand}
                    onChange={(e) => 改行(r.itemId, "brand", e.target.value)}
                    placeholder="品牌（选填）"
                    className="w-full px-3 py-2.5 text-base rounded-lg border border-gray-200 focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
                  />
                  <input
                    type="text"
                    disabled={只读}
                    value={r.spec}
                    onChange={(e) => 改行(r.itemId, "spec", e.target.value)}
                    placeholder="规格（选填）"
                    className="w-full px-3 py-2.5 text-base rounded-lg border border-gray-200 focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg text-gray-500">¥</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    disabled={只读}
                    value={r.price}
                    onChange={(e) => 改行(r.itemId, "price", e.target.value)}
                    placeholder="采购价（必填）"
                    className="flex-1 px-3 py-2.5 text-lg font-semibold rounded-lg border border-gray-200 focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
                  />
                  <span className="text-sm text-gray-400">/{r.unit}</span>
                </div>
                <input
                  type="text"
                  disabled={只读}
                  value={r.notes}
                  onChange={(e) => 改行(r.itemId, "notes", e.target.value)}
                  placeholder="备注（选填，如货期、替代品牌）"
                  className="w-full px-3 py-2.5 text-base rounded-lg border border-gray-200 focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
                />
              </div>
            </div>
          ))}
        </div>

        {/* 提交按钮（吸底） */}
        {!只读 && (
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4">
            <div className="max-w-lg mx-auto">
              <button
                type="button"
                onClick={提交}
                disabled={提交中}
                className="w-full py-3.5 text-lg font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {提交中 ? "提交中..." : 提交成功 ? "重新提交报价" : "提交报价"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
