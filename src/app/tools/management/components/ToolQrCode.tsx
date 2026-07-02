"use client";

import { useState, useRef } from "react";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";

interface Props {
  toolId: string;
  toolName: string;
  toolCode: string;
}

export default function ToolQrCode({ toolId, toolName, toolCode }: Props) {
  const [open, setOpen] = useState(false);
  const qrValue = `tool:${toolId}`;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  function 打印标签纸() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dataUrl = canvas.toDataURL("image/png");
    const 打印窗口 = window.open("", "_blank", "width=700,height=500");
    if (!打印窗口) {
      alert("请允许浏览器打开弹窗，否则无法打印");
      return;
    }

    /* 适配 5cm × 3cm 条码标签纸（50mm 宽 × 30mm 高） */
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
          <title>工具标签 - ${toolName}</title>
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
              <div class="title">${toolName}</div>
            </div>
            <div class="qr"><img src="${dataUrl}" alt="二维码" /></div>
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

  return (
    <>
      {/* 桌面版：文字按钮 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden lg:inline-flex text-xs px-2 py-1 text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
      >
        二维码
      </button>

      {/* 移动端：纯图标按钮（默认显示） */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="lg:hidden w-8 h-8 rounded-lg flex items-center justify-center text-gray-600 hover:text-blue-600 hover:bg-blue-50 active:scale-95 transition-transform"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
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
              <h3 className="text-base font-semibold text-gray-900">工具二维码</h3>
              <p className="text-sm text-gray-600">{toolName}</p>
              <p className="text-xs text-gray-400">编码：{toolCode}</p>
              <div className="flex justify-center p-4 bg-white rounded-lg relative">
                <QRCodeSVG value={qrValue} size={200} level="M" />
                {/* 隐藏的 canvas 用于生成打印图片 */}
                <div className="absolute opacity-0 pointer-events-none">
                  <QRCodeCanvas value={qrValue} size={200} level="M" ref={canvasRef} />
                </div>
              </div>
              <p className="text-xs text-gray-400">扫码可直接借用或归还该工具</p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              {/* 桌面端显示打印按钮 */}
              <button
                type="button"
                onClick={打印标签纸}
                className="hidden lg:inline-flex px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
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
