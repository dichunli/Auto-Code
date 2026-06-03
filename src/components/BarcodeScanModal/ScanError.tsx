"use client";

import { useState } from "react";

interface Props {
  message: string;
  isNotSupported?: boolean;
  onConfirm: (value: string) => void;
}

/**
 * 扫码错误提示 + 手动输入组件
 * 显示错误图标、错误信息，并提供手动输入条码的输入框
 */
export default function ScanError({ message, isNotSupported, onConfirm }: Props) {
  const [输入值, set输入值] = useState("");

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-white/70 px-6">
      <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
        />
      </svg>
      <p className="text-sm text-center">{isNotSupported ? "当前环境不支持摄像头访问" : message}</p>
      <p className="text-xs mt-3 opacity-60">可手动输入条码</p>

      <div className="mt-4 w-full max-w-xs space-y-2">
        <input
          type="text"
          value={输入值}
          onChange={(e) => set输入值(e.target.value)}
          placeholder="输入配件编码..."
          className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder:text-white/40"
          autoFocus
        />
        <button
          type="button"
          onClick={() => onConfirm(输入值.trim())}
          disabled={!输入值.trim()}
          className="w-full py-2 bg-green-600 text-white text-sm rounded-lg disabled:opacity-30"
        >
          确认
        </button>
      </div>
    </div>
  );
}
