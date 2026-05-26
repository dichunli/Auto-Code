"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

interface Props {
  open: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
}

/* 支持的条码格式 */
const 条码格式 = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.QR_CODE,
];

export default function BarcodeScanModal({ open, onClose, onScan }: Props) {
  const 容器Ref = useRef<HTMLDivElement>(null);
  const 扫描器Ref = useRef<Html5Qrcode | null>(null);
  const 已扫描Ref = useRef(false);
  const 已取消Ref = useRef(false);

  const [扫描中, set扫描中] = useState(false);
  const [识别码, set识别码] = useState<string | null>(null);
  const [错误信息, set错误信息] = useState<string | null>(null);
  const [不支持, set不支持] = useState(false);

  /* 停止扫描 */
  const 停止扫描 = useCallback(async () => {
    if (扫描器Ref.current) {
      try {
        await 扫描器Ref.current.stop();
      } catch {
        /* 忽略停止错误 */
      }
      扫描器Ref.current = null;
    }
  }, []);

  /* 启动扫描 */
  const 启动扫描 = useCallback(async () => {
    if (!容器Ref.current || 已取消Ref.current) return;

    const 扫描器 = new Html5Qrcode(容器Ref.current);
    扫描器Ref.current = 扫描器;

    try {
      await 扫描器.start(
        { facingMode: "environment" },
        {
          fps: 10,
          /* 不显示库自带的扫描框，使用自定义取景框 */
          qrbox: undefined,
          formatsToSupport: 条码格式,
        },
        (解码文本) => {
          if (已扫描Ref.current || 已取消Ref.current) return;
          已扫描Ref.current = true;
          set识别码(解码文本);
          set扫描中(false);
          扫描器.stop().catch(() => {});
        },
        () => {
          /* 持续扫描中的错误，忽略 */
        }
      );
      if (!已取消Ref.current) {
        set扫描中(true);
      }
    } catch (err: unknown) {
      if (已取消Ref.current) return;
      const 消息 = err instanceof Error ? err.message : String(err);
      if (消息.includes("NotAllowedError") || 消息.includes("Permission denied")) {
        set错误信息("摄像头权限被拒绝");
      } else if (消息.includes("NotFoundError")) {
        set错误信息("未找到摄像头设备");
      } else {
        set错误信息("无法启动摄像头");
      }
      set扫描中(false);
    }
  }, []);

  /* 打开/关闭时的处理 */
  useEffect(() => {
    已取消Ref.current = false;

    if (!open) {
      停止扫描();
      set识别码(null);
      set错误信息(null);
      set扫描中(false);
      set不支持(false);
      已扫描Ref.current = false;
      return;
    }

    /* 检查浏览器是否支持 getUserMedia */
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      set不支持(true);
      return;
    }

    set识别码(null);
    set错误信息(null);
    set不支持(false);
    已扫描Ref.current = false;

    启动扫描();

    return () => {
      已取消Ref.current = true;
      停止扫描();
    };
  }, [open, 停止扫描, 启动扫描]);

  /* 确认使用 */
  const 确认使用 = useCallback(() => {
    if (识别码) {
      onScan(识别码);
    }
  }, [识别码, onScan]);

  /* 重新扫描 */
  const 重新扫描 = useCallback(async () => {
    set识别码(null);
    set错误信息(null);
    已扫描Ref.current = false;
    await 停止扫描();
    await 启动扫描();
  }, [停止扫描, 启动扫描]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black flex flex-col">
      {/* 覆盖 html5-qrcode 内部样式 */}
      <style>{`
        .barcode-scanner-root video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }
        .barcode-scanner-root [id$="__dashboard"] {
          display: none !important;
        }
        .barcode-scanner-root [id$="__scan_region"] {
          width: 100% !important;
          height: 100% !important;
        }
        .barcode-scanner-root [id$="__scan_region"] img {
          display: none !important;
        }
      `}</style>

      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 h-12 bg-black/80 text-white shrink-0">
        <span className="text-sm font-medium">扫码添加配件</span>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 active:bg-white/20"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 预览区域 */}
      <div className="flex-1 relative overflow-hidden">
        {/* 扫描容器 - html5-qrcode 会在这里创建 video */}
        <div ref={容器Ref} className="barcode-scanner-root absolute inset-0" />

        {/* 取景框 */}
        {扫描中 && !识别码 && !错误信息 && !不支持 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-72 h-32">
              {/* 四边角 */}
              <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-green-400" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-green-400" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-green-400" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-green-400" />
              {/* 提示文字 */}
              <div className="absolute -top-7 left-0 right-0 text-center">
                <span className="text-xs text-white/80 bg-black/40 px-2 py-0.5 rounded">
                  将条形码对准框内
                </span>
              </div>
              {/* 扫描线动画 */}
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-green-400/80 animate-scan-line" />
            </div>
          </div>
        )}

        {/* 错误/不支持提示 */}
        {(不支持 || 错误信息) && !识别码 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/70">
            <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
              />
            </svg>
            <p className="text-sm">{不支持 ? "当前浏览器不支持摄像头访问" : 错误信息}</p>
            <p className="text-xs mt-1 opacity-60">请手动输入配件编码搜索</p>
          </div>
        )}

        {/* 识别结果预览 */}
        {识别码 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
            <div className="text-center py-2">
              <div className="text-xs text-white/50 mb-1">识别结果</div>
              <div className="inline-flex items-center gap-2 bg-green-600/20 border border-green-500/40 rounded-lg px-4 py-2">
                <span className="text-lg font-bold text-green-400 tracking-wider font-mono">{识别码}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 底部控制栏 */}
      <div className="shrink-0 bg-black/90 pb-safe">
        <div className="flex items-center justify-center gap-6 px-4 py-4">
          {!识别码 ? (
            <>
              {扫描中 && (
                <div className="flex items-center justify-center gap-2 text-white/70">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  <span className="text-sm">正在扫描...</span>
                </div>
              )}
              {!扫描中 && !不支持 && (
                <button
                  type="button"
                  onClick={重新扫描}
                  className="px-6 py-2.5 rounded-full bg-white/10 text-white text-sm font-medium active:bg-white/20"
                >
                  重试
                </button>
              )}
            </>
          ) : (
            <>
              {/* 重新扫描 */}
              <button
                type="button"
                onClick={重新扫描}
                className="flex flex-col items-center gap-1 text-white/70 active:text-white"
              >
                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </div>
                <span className="text-[10px]">重扫</span>
              </button>

              {/* 确认 */}
              <button
                type="button"
                onClick={确认使用}
                className="px-6 py-2.5 rounded-full bg-green-600 text-white text-sm font-medium active:bg-green-700"
              >
                使用此编码
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
