"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

interface Props {
  toolId: string;
  toolName: string;
  toolCode: string;
}

export default function ToolQrCode({ toolId, toolName, toolCode }: Props) {
  const [open, setOpen] = useState(false);
  const qrValue = `tool:${toolId}`;

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
              <div className="flex justify-center p-4 bg-white rounded-lg">
                <QRCodeSVG value={qrValue} size={200} level="M" />
              </div>
              <p className="text-xs text-gray-400">扫码可直接借用或归还该工具</p>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
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
