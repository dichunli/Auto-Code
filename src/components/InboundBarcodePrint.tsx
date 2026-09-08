"use client";

/* ============================================================
 * 入库单条码打印（2026-09-08 两阶段入库）
 * 入库确认单（draft）和正式入库单（completed）都能用：
 * 确认前打印 = 提前贴码，确认后打印 = 补打。
 * 每种配件默认按入库数量出张数，打印前可手改；
 * 条码内容/格式与库存页一致（CODE128，barcode || part_number || part_id），
 * 打印实现复刻 InventoryTable.printBatch 的 canvas → 新窗口模式。
 * ============================================================ */

import { useState } from "react";
import JsBarcode from "jsbarcode";
import { 转义HTML } from "@/lib/escapeHtml";

export interface 条码打印行 {
  name: string;
  code: string;
  quantity: number;
}

interface Props {
  items: 条码打印行[];
  /* 按钮外观：默认蓝底；调用方可换 */
  className?: string;
}

export function InboundBarcodePrint({ items, className }: Props) {
  const [open, setOpen] = useState(false);
  /* 每行打印张数（字符串存储，打印时转整数；默认 = 入库数量） */
  const [张数, set张数] = useState<Record<number, string>>({});

  function 取张数(idx: number): string {
    return 张数[idx] ?? String(items[idx].quantity);
  }

  function 执行打印() {
    const 待打: { name: string; code: string; count: number }[] = [];
    items.forEach((it, idx) => {
      const n = parseInt(取张数(idx), 10);
      if (Number.isInteger(n) && n > 0) {
        待打.push({ name: it.name, code: it.code, count: Math.min(n, 999) });
      }
    });
    if (待打.length === 0) {
      alert("没有需要打印的条码（张数都为 0）");
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("请允许弹出窗口以打印条形码");
      return;
    }

    const canvas = document.createElement("canvas");
    let html = `<html><head><title>打印条形码</title><style>
      body { font-family: sans-serif; padding: 20px; }
      .barcode-grid { display: flex; flex-wrap: wrap; gap: 16px; }
      .barcode-item { width: 200px; text-align: center; border: 1px solid #e5e7eb; padding: 12px; border-radius: 8px; page-break-inside: avoid; }
      .barcode-name { font-size: 13px; font-weight: 500; margin-bottom: 8px; color: #111; }
      .barcode-code { font-size: 11px; color: #666; margin-top: 4px; }
      img { max-width: 100%; }
    </style></head><body><div class="barcode-grid">`;

    for (const 行 of 待打) {
      let imgData: string;
      try {
        JsBarcode(canvas, 行.code, {
          format: "CODE128",
          width: 2,
          height: 50,
          displayValue: true,
          fontSize: 12,
        });
        imgData = canvas.toDataURL("image/png");
      } catch {
        /* 编码含 CODE128 不支持的字符时跳过该行（与库存页同口径） */
        continue;
      }
      /* 名称/编码来自用户输入，拼进打印 HTML 前必须转义 */
      const 贴纸 = `<div class="barcode-item"><div class="barcode-name">${转义HTML(行.name)}</div><img src="${imgData}" /><div class="barcode-code">${转义HTML(行.code)}</div></div>`;
      html += 贴纸.repeat(行.count);
    }

    html += `</div></body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"}
      >
        打印条形码
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto print:hidden">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg my-8">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">打印条形码</h3>
              <p className="text-xs text-gray-500 mt-0.5">默认每种配件按入库数量出张数，可修改；张数 0 表示不打印</p>
            </div>
            <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
              {items.map((it, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{it.name}</div>
                    <div className="text-xs text-gray-500">{it.code} · 入库 {it.quantity} 件</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="number"
                      min={0}
                      max={999}
                      value={取张数(idx)}
                      onChange={(e) => set张数((prev) => ({ ...prev, [idx]: e.target.value }))}
                      className="w-16 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:border-blue-400"
                    />
                    <span className="text-xs text-gray-500">张</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={执行打印}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
              >
                打印
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
