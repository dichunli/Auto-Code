"use client";

/* ============================================================
 * 入库单条码/二维码打印（2026-09-08 两阶段入库；2026-09-13 加二维码+图片+车牌）
 * 入库确认单（draft）和正式入库单（completed）都能用：
 * 确认前打印 = 提前贴码，确认后打印 = 补打。
 * 条码内容/格式与库存页一致（CODE128，barcode || part_number || part_id）；
 * 二维码内容与条码相同（手机扫码等效），打印实现复刻
 * InventoryTable.printBatch 的 canvas → 新窗口模式。
 * 贴纸内容：图片（有则显示）+ 名称 + 条码/二维码 + 编码 + 车牌（有则显示）。
 * ============================================================ */

import { useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { QRCodeCanvas } from "qrcode.react";
import { 转义HTML } from "@/lib/escapeHtml";
import { toast } from "@/lib/globalToast";

export interface 条码打印行 {
  name: string;
  code: string;
  quantity: number;
  /* 配件图片（收货照片第一张，有则贴纸上显示） */
  photo?: string | null;
  /* 关联车牌（订件按车贴标，有则贴纸上显示） */
  plate?: string | null;
}

interface Props {
  items: 条码打印行[];
  /* 按钮外观：默认蓝底；调用方可换 */
  className?: string;
}

export function InboundBarcodePrint({ items, className }: Props) {
  const [open, setOpen] = useState(false);
  /* 码制（2026-09-13）：条形码=扫码枪/库存页同口径；二维码=手机扫码友好 */
  const [码制, set码制] = useState<"barcode" | "qrcode">("barcode");
  /* 每行打印张数（字符串存储，打印时转整数；默认 = 入库数量） */
  const [张数, set张数] = useState<Record<number, string>>({});
  /* 每行一个隐藏 QR 画布，打印时 toDataURL 取图（参照 ToolQrCode 的 canvasRef 模式） */
  const qr画布们 = useRef<Map<number, HTMLCanvasElement>>(new Map());

  function 取张数(idx: number): string {
    return 张数[idx] ?? String(items[idx].quantity);
  }

  function 执行打印() {
    const 待打: { idx: number; name: string; code: string; count: number; photo: string | null; plate: string | null }[] = [];
    items.forEach((it, idx) => {
      const n = parseInt(取张数(idx), 10);
      if (Number.isInteger(n) && n > 0) {
        待打.push({
          idx,
          name: it.name,
          code: it.code,
          count: Math.min(n, 999),
          photo: it.photo ?? null,
          plate: it.plate ?? null,
        });
      }
    });
    if (待打.length === 0) {
      toast("没有需要打印的条码（张数都为 0）", "warning");
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast("请允许弹出窗口以打印条形码", "warning");
      return;
    }

    const canvas = document.createElement("canvas");
    let html = `<html><head><title>打印条码/二维码</title><style>
      body { font-family: sans-serif; padding: 20px; }
      .barcode-grid { display: flex; flex-wrap: wrap; gap: 16px; }
      .barcode-item { width: 200px; text-align: center; border: 1px solid #e5e7eb; padding: 12px; border-radius: 8px; page-break-inside: avoid; }
      .barcode-photo { width: 100%; height: 80px; object-fit: cover; border-radius: 4px; margin-bottom: 6px; }
      .barcode-name { font-size: 13px; font-weight: 500; margin-bottom: 8px; color: #111; }
      .barcode-code { font-size: 11px; color: #666; margin-top: 4px; }
      .barcode-plate { font-size: 12px; font-weight: 600; color: #111; margin-top: 2px; }
      img { max-width: 100%; }
    </style></head><body><div class="barcode-grid">`;

    for (const 行 of 待打) {
      let imgData: string;
      if (码制 === "qrcode") {
        /* 二维码：取隐藏画布的图；画布缺失（极少见）跳过该行 */
        const qr画布 = qr画布们.current.get(行.idx);
        if (!qr画布) continue;
        imgData = qr画布.toDataURL("image/png");
      } else {
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
      }
      /* 名称/编码/车牌来自用户输入，拼进打印 HTML 前必须转义 */
      const 贴纸 =
        `<div class="barcode-item">` +
        (行.photo ? `<img src="${转义HTML(行.photo)}" class="barcode-photo" />` : "") +
        `<div class="barcode-name">${转义HTML(行.name)}</div><img src="${imgData}" />` +
        `<div class="barcode-code">${转义HTML(行.code)}</div>` +
        (行.plate ? `<div class="barcode-plate">车牌:${转义HTML(行.plate)}</div>` : "") +
        `</div>`;
      html += 贴纸.repeat(行.count);
    }

    /* 贴纸含配件照片，等全部图片加载完再弹打印框，防止打出空白图 */
    html += `</div><script>window.addEventListener('load', function () { window.print(); });<\/script></body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"}
      >
        打印条码/二维码
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto print:hidden">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg my-8">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">打印条码/二维码</h3>
              <p className="text-xs text-gray-500 mt-0.5">默认每种配件按入库数量出张数，可修改；张数 0 表示不打印</p>
            </div>
            {/* 码制切换：条形码（扫码枪，与库存页同口径）/ 二维码（手机扫码） */}
            <div className="px-6 pt-4 flex items-center gap-2">
              <span className="text-xs text-gray-500">码制:</span>
              <button
                type="button"
                onClick={() => set码制("barcode")}
                className={`px-3 py-1 text-xs rounded border transition-colors ${
                  码制 === "barcode"
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "bg-white border-gray-200 text-gray-600 hover:border-blue-400"
                }`}
              >
                条形码
              </button>
              <button
                type="button"
                onClick={() => set码制("qrcode")}
                className={`px-3 py-1 text-xs rounded border transition-colors ${
                  码制 === "qrcode"
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "bg-white border-gray-200 text-gray-600 hover:border-blue-400"
                }`}
              >
                二维码
              </button>
            </div>
            <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
              {items.map((it, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{it.name}</div>
                    <div className="text-xs text-gray-500">
                      {it.code} · 入库 {it.quantity} 件{it.plate ? ` · 车牌:${it.plate}` : ""}
                    </div>
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
            {/* 隐藏 QR 画布（仅二维码模式渲染）：打印时逐行 toDataURL 取图 */}
            {码制 === "qrcode" && (
              <div className="absolute opacity-0 pointer-events-none" aria-hidden>
                {items.map((it, idx) => (
                  <QRCodeCanvas
                    key={idx}
                    value={it.code || "-"}
                    size={160}
                    level="M"
                    ref={(el) => {
                      if (el) qr画布们.current.set(idx, el);
                      else qr画布们.current.delete(idx);
                    }}
                  />
                ))}
              </div>
            )}
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
