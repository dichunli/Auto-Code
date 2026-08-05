"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { 生成询价单 } from "@/app/quote/actions";

/* 生成询价链接弹窗：待询价页勾选行后，选供应商 → 生成 3 小时有效的链接发给供应商 */

interface 选中行 {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  supplier_name: string | null;
}

interface 供应商 {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  rows: 选中行[];
  suppliers: 供应商[];
  onClose: () => void;
}

export default function QuoteSheetModal({ open, rows, suppliers, onClose }: Props) {
  const [搜索, set搜索] = useState("");
  /* 选中行若已是同一供应商则预填 */
  const 共同供应商 = useMemo(() => {
    const 名集合 = new Set(rows.map((r) => r.supplier_name).filter(Boolean));
    return 名集合.size === 1 ? [...名集合][0]! : "";
  }, [rows]);
  const [选中的供应商, set选中的供应商] = useState<供应商 | null>(null);
  const [生成中, set生成中] = useState(false);
  const [链接, set链接] = useState("");
  const [复制成功, set复制成功] = useState(false);

  useEffect(() => {
    if (open) {
      set搜索("");
      set链接("");
      set复制成功(false);
      set选中的供应商(null);
      /* 预填共同供应商 */
      if (共同供应商) {
        const 命中 = suppliers.find((s) => s.name === 共同供应商);
        if (命中) set选中的供应商(命中);
      }
    }
  }, [open, 共同供应商, suppliers]);

  const 过滤供应商 = useMemo(() => {
    const q = 搜索.trim().toLowerCase();
    return suppliers
      .filter((s) => !q || (s.name || "").toLowerCase().includes(q))
      .slice(0, 50);
  }, [suppliers, 搜索]);

  async function 确认生成() {
    if (!选中的供应商) {
      alert("请先选择供应商");
      return;
    }
    set生成中(true);
    try {
      const 结果 = await 生成询价单({
        partRowIds: rows.map((r) => r.id),
        supplierId: 选中的供应商.id,
        supplierName: 选中的供应商.name,
      });
      set生成中(false);
      if (!结果.success || !结果.token) {
        alert("生成失败: " + (结果.error || "未知错误"));
        return;
      }
      set链接(`${window.location.origin}/quote/${结果.token}`);
    } catch (err: unknown) {
      set生成中(false);
      alert("生成失败: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function 复制链接() {
    try {
      await navigator.clipboard.writeText(链接);
      set复制成功(true);
    } catch {
      /* 剪贴板不可用时选中输入框内容手动复制 */
      const input = document.getElementById("quote-link-input") as HTMLInputElement | null;
      input?.select();
      alert("自动复制失败，请按 Ctrl+C 手动复制");
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">生成询价链接</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>

        {!链接 ? (
          <div className="p-5 space-y-4">
            <div className="text-xs text-gray-500">
              已选 <span className="font-semibold text-gray-900">{rows.length}</span> 行配件，生成链接发给供应商，供应商填价提交后配件自动进入「待报价」。链接 <span className="text-amber-600 font-medium">3 小时内有效</span>。
            </div>

            {/* 选中配件预览 */}
            <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 space-y-1">
              {rows.map((r) => (
                <div key={r.id} className="text-xs text-gray-700 flex justify-between">
                  <span className="truncate">{r.name || "未命名"}</span>
                  <span className={`shrink-0 ml-2 ${r.quantity == null ? "text-red-500" : "text-gray-400"}`}>
                    {r.quantity != null ? `${r.quantity} ${r.unit || "件"}` : "数量未填"}
                  </span>
                </div>
              ))}
            </div>

            {/* 供应商选择 */}
            <div>
              <div className="text-xs font-medium text-gray-700 mb-1.5">选择供应商</div>
              {选中的供应商 ? (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-blue-300 bg-blue-50">
                  <span className="text-sm text-blue-800 font-medium">{选中的供应商.name}</span>
                  <button type="button" onClick={() => set选中的供应商(null)} className="text-xs text-blue-500 hover:text-blue-700">更换</button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={搜索}
                    onChange={(e) => set搜索(e.target.value)}
                    placeholder="搜索供应商..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:border-blue-500 focus:outline-none mb-1.5"
                  />
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200">
                    {过滤供应商.length === 0 && (
                      <div className="px-3 py-2 text-xs text-gray-400">无匹配供应商</div>
                    )}
                    {过滤供应商.map((s) => (
                      <div
                        key={s.id}
                        onClick={() => set选中的供应商(s)}
                        className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer border-t border-gray-50 first:border-t-0"
                      >
                        {s.name}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={确认生成}
              disabled={生成中 || !选中的供应商}
              className="w-full py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {生成中 ? "生成中..." : "生成询价链接"}
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
              ✅ 链接已生成，<span className="font-medium">3 小时内有效</span>，请用微信发给「{选中的供应商?.name}」
            </div>
            <div className="flex gap-2">
              <input
                id="quote-link-input"
                type="text"
                readOnly
                value={链接}
                onFocus={(e) => e.target.select()}
                className="flex-1 min-w-0 px-3 py-2 text-xs rounded-lg border border-gray-200 bg-gray-50"
              />
              <button
                type="button"
                onClick={复制链接}
                className="shrink-0 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                {复制成功 ? "已复制 ✓" : "复制"}
              </button>
            </div>
            <div className="text-xs text-gray-400">
              供应商提交报价后，这些配件会自动填上采购价和供应商，进入「待报价」。在采购管理「询价单」页签可查看进度或作废。
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              关闭
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
