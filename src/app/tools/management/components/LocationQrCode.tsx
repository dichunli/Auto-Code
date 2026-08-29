"use client";

import { useState, useRef } from "react";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import { 转义HTML } from "@/lib/escapeHtml";

interface Props {
  location: string;
}

export default function LocationQrCode({ location }: Props) {
  const [open, setOpen] = useState(false);
  const qrValue = `location:${location}`;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  function 打印标签纸() {
    /* 适配 5cm × 3cm 条码标签纸（50mm 宽 × 30mm 高） */
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dataUrl = canvas.toDataURL("image/png");
    const 打印窗口 = window.open("", "_blank", "width=700,height=500");
    if (!打印窗口) {
      alert("请允许浏览器打开弹窗，否则无法打印");
      return;
    }

    const 样式 = `
      @page { size: 50mm 30mm; margin: 0; }
      body {
        font-family: system-ui, -apple-system, sans-serif;
        margin: 0;
        padding: 0;
        width: 50mm;
        height: 30mm;
        box-sizing: border-box;
        overflow: hidden;
      }
      .print-box {
        width: 50mm;
        height: 30mm;
        padding: 2mm;
        box-sizing: border-box;
        display: flex;
        gap: 2mm;
        align-items: center;
      }
      .left {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
      }
      .title {
        font-size: 20px;
        font-weight: bold;
        line-height: 1.2;
        word-break: break-all;
      }
      .qr img { width: 10mm; height: 10mm; }
    `;

    打印窗口.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>仓位码 - ${转义HTML(location)}</title>
          <style>
            ${样式}
            .no-print {
              margin-top: 12px;
              padding: 6px 16px;
              font-size: 14px;
              cursor: pointer;
              border: 1px solid #ccc;
              background: #fff;
              border-radius: 6px;
            }
            @media print {
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="print-box">
            <div class="left">
              <div class="title">${转义HTML(location)}</div>
            </div>
            <div class="qr"><img src="${dataUrl}" alt="仓位码" /></div>
          </div>
          <button class="no-print" onclick="window.print();">点击打印</button>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 300);
            };
          </script>
        </body>
      </html>
    `);
    打印窗口.document.close();
  }

  if (!location) return null;

  return (
    <>
      {/* 桌面版图标按钮 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="hidden sm:inline-flex ml-1 text-blue-600 hover:text-blue-800"
        title="打印仓位码"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
      </button>

      {/* 移动端图标按钮 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="sm:hidden ml-1 text-blue-600 hover:text-blue-800"
        title="打印仓位码"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center space-y-3">
              <h3 className="text-base font-semibold text-gray-900">仓位码</h3>
              <p className="text-sm text-gray-600">{location}</p>
              <div className="flex justify-center p-4 bg-white rounded-lg relative">
                <QRCodeSVG value={qrValue} size={200} level="M" />
                <div className="absolute opacity-0 pointer-events-none">
                  <QRCodeCanvas value={qrValue} size={200} level="M" ref={canvasRef} />
                </div>
              </div>
              <p className="text-xs text-gray-400">扫码可识别仓位位置</p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              {/* 桌面端显示打印按钮 */}
              <button
                type="button"
                onClick={打印标签纸}
                className="hidden sm:inline-flex px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                打印二维码
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
