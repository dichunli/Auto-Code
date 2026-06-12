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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs px-2 py-1 text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
      >
        二维码
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
