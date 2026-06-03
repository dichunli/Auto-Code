"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { BarcodeScanner, BarcodeFormat } from "@capacitor-mlkit/barcode-scanning";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";

/* ========== 支持的条码格式（浏览器环境用 html5-qrcode） ========== */
const 浏览器条码格式 = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.QR_CODE,
];

/* ========== APP 环境用 MLKit 条码格式 ========== */
const APP条码格式: BarcodeFormat[] = [
  BarcodeFormat.Code128,
  BarcodeFormat.Code39,
  BarcodeFormat.Ean13,
  BarcodeFormat.Ean8,
  BarcodeFormat.UpcA,
  BarcodeFormat.UpcE,
  BarcodeFormat.Itf,
  BarcodeFormat.Codabar,
  BarcodeFormat.QrCode,
];

interface Props {
  open: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
}

/* 将 base64 转换为 Blob 对象（供 MLKit readBarcodesFromImage 使用） */
function base64转Blob(dataurl: string): Blob {
  const arr = dataurl.split(",");
  const mime = arr[0].match(/:(.*?);/)?.[1] || "image/jpeg";
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

export default function BarcodeScanModal({ open, onClose, onScan }: Props) {
  const 容器Ref = useRef<HTMLDivElement>(null);
  const 扫描器Ref = useRef<Html5Qrcode | null>(null);
  const 已取消Ref = useRef(false);
  const 扫描中Ref = useRef(false);

  const [模式, set模式] = useState<"扫描中" | "识别成功" | "拍照" | "不支持" | "错误" | "启动中">("扫描中");
  const [识别码, set识别码] = useState<string | null>(null);
  const [错误信息, set错误信息] = useState<string | null>(null);
  const [手动输入, set手动输入] = useState("");

  const 是App = 是Capacitor环境();

  /* ========== 浏览器环境：停止 html5-qrcode ========== */
  const 停止浏览器扫描 = useCallback(async () => {
    if (扫描器Ref.current) {
      try { await 扫描器Ref.current.stop(); } catch { /* 忽略 */ }
      try { await 扫描器Ref.current.clear(); } catch { /* 忽略 */ }
      扫描器Ref.current = null;
    }
    if (typeof document !== "undefined") {
      document.body.style.background = "";
      document.body.classList.remove("scanner-active");
    }
  }, []);

  /* ========== 浏览器环境：启动 html5-qrcode 实时扫描 ========== */
  const 启动浏览器扫描 = useCallback(async () => {
    if (!容器Ref.current || 已取消Ref.current) return;

    const containerId = "barcode-scanner-container";
    if (!容器Ref.current.id) {
      容器Ref.current.id = containerId;
    }

    /* 等 DOM 稳定 */
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (已取消Ref.current) return;

    try {
      const 扫描器 = new Html5Qrcode(containerId);
      扫描器Ref.current = 扫描器;

      await 扫描器.start(
        { facingMode: "environment" },
        {
          fps: 8,
          qrbox: { width: 300, height: 100 },
          formatsToSupport: 浏览器条码格式,
          videoConstraints: {
            width: { min: 640, ideal: 1280 },
            height: { min: 480, ideal: 720 },
            facingMode: "environment",
          },
        },
        (解码文本) => {
          if (已取消Ref.current) return;
          set识别码(解码文本);
          set模式("识别成功");
          /* 自动停止 */
          扫描器.stop().catch(() => {});
        },
        () => { /* 持续扫描中，忽略帧解码错误 */ }
      );

      if (!已取消Ref.current) {
        set模式("扫描中");
      }
    } catch (err: unknown) {
      if (已取消Ref.current) return;
      const 消息 = err instanceof Error ? err.message : String(err);
      if (消息.includes("NotAllowedError") || 消息.includes("Permission denied")) {
        set错误信息("摄像头权限被拒绝");
      } else if (消息.includes("NotFoundError") || 消息.includes("DevicesNotFoundError")) {
        set错误信息("未找到摄像头设备");
      } else if (消息.includes("NotReadableError") || 消息.includes("Could not start")) {
        set错误信息("摄像头被占用，请关闭其他使用摄像头的应用后重试");
      } else {
        set错误信息("无法启动摄像头: " + 消息);
      }
      set模式("错误");
    }
  }, []);

  /* ========== APP 环境：用 MLKit scan() 启动原生扫描 ========== */
  const 启动APP扫码 = useCallback(async () => {
    if (已取消Ref.current || 扫描中Ref.current) return;
    扫描中Ref.current = true;
    set模式("启动中");

    try {
      const { barcodes } = await BarcodeScanner.scan({ formats: APP条码格式 });
      if (已取消Ref.current) return;

      if (barcodes && barcodes.length > 0) {
        const code = barcodes[0].rawValue || barcodes[0].displayValue || "";
        if (code) {
          set识别码(code);
          set模式("识别成功");
          /* 短暂显示结果后自动确认 */
          setTimeout(() => {
            if (!已取消Ref.current) {
              onScan(code);
              onClose();
            }
          }, 600);
          return;
        }
      }

      /* 扫描完成但没识别到条码 */
      set错误信息("未能识别条码，请重试或手动输入");
      set模式("错误");
    } catch (err: unknown) {
      if (已取消Ref.current) return;
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes("cancel") || msg.includes("canceled") || msg.includes("denied")) {
        set错误信息("扫描已取消，可手动输入条码");
        set模式("错误");
      } else if (msg.includes("unavailable") || msg.includes("Google Play") || msg.includes("module")) {
        /* 设备不支持 Google Barcode Scanner，fallback 到拍照 */
        set错误信息("当前设备不支持自动扫描，已切换到拍照识别");
        set模式("拍照");
      } else {
        set错误信息("扫描失败: " + msg);
        set模式("错误");
      }
    } finally {
      扫描中Ref.current = false;
    }
  }, [onScan, onClose]);

  /* ========== APP 环境：拍照后识别条码（fallback） ========== */
  const 拍照识别条码 = useCallback(async () => {
    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
      });
      if (!image.base64String) return;

      const base64 = `data:image/jpeg;base64,${image.base64String}`;
      const blob = base64转Blob(base64);

      /* 用 MLKit 识别图片中的条码（替代旧版的 html5-qrcode scanFile） */
      const { barcodes } = await BarcodeScanner.readBarcodesFromImage({ blob });
      if (barcodes && barcodes.length > 0) {
        const code = barcodes[0].rawValue || barcodes[0].displayValue || "";
        if (code) {
          set识别码(code);
          set模式("识别成功");
          return;
        }
      }

      set错误信息("未能识别条码，请对准后重试或手动输入");
      set模式("错误");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("cancel") || msg.includes("denied") || msg.includes("User cancelled")) {
        return;
      }
      set错误信息("未能识别条码，请对准后重试或手动输入");
      set模式("错误");
    }
  }, []);

  /* ========== 打开/关闭时的生命周期 ========== */
  useEffect(() => {
    已取消Ref.current = false;

    if (!open) {
      /* ===== 关闭弹窗：强制清理所有资源 ===== */
      停止浏览器扫描();
      set识别码(null);
      set错误信息(null);
      set模式("扫描中");
      set手动输入("");
      扫描中Ref.current = false;
      return;
    }

    /* ===== 打开弹窗 ===== */
    set识别码(null);
    set错误信息(null);
    set模式("扫描中");
    set手动输入("");
    扫描中Ref.current = false;

    if (是App) {
      /* APP：调用 MLKit 原生扫描 */
      启动APP扫码();
    } else {
      /* 浏览器：检查支持性 */
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        set模式("不支持");
        return;
      }
      启动浏览器扫描();
    }

    return () => {
      已取消Ref.current = true;
      停止浏览器扫描();
    };
  }, [open, 是App, 停止浏览器扫描, 启动浏览器扫描, 启动APP扫码]);

  /* ========== 确认使用 ========== */
  const 确认使用 = useCallback(() => {
    if (识别码) {
      onScan(识别码);
    }
  }, [识别码, onScan]);

  /* ========== 手动输入确认 ========== */
  const 手动输入确认 = useCallback(() => {
    const trimmed = 手动输入.trim();
    if (trimmed) {
      onScan(trimmed);
    }
  }, [手动输入, onScan]);

  /* ========== 重新扫描 ========== */
  const 重新扫描 = useCallback(async () => {
    set识别码(null);
    set错误信息(null);
    set手动输入("");
    set模式("扫描中");

    if (是App) {
      await 启动APP扫码();
    } else {
      await 停止浏览器扫描();
      await 启动浏览器扫描();
    }
  }, [是App, 停止浏览器扫描, 启动浏览器扫描, 启动APP扫码]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black flex flex-col">
      {/* 覆盖 html5-qrcode 内部样式（浏览器环境用） */}
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
        @keyframes scan-line {
          0% { top: 0; }
          100% { top: 100%; }
        }
        .animate-scan-line {
          animation: scan-line 2s linear infinite;
        }
      `}</style>

      {/* ========== 顶部栏 ========== */}
      <div className="flex items-center justify-between px-4 h-12 bg-black/80 text-white shrink-0">
        <span className="text-sm font-medium">扫码添加配件</span>
        <button
          type="button"
          onClick={() => {
            /* 关闭前强制清理 */
            void 停止浏览器扫描();
            onClose();
          }}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 active:bg-white/20"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ========== 预览区域 ========== */}
      <div className="flex-1 relative overflow-hidden">
        {/* 浏览器环境：html5-qrcode 视频容器 */}
        {!是App && (
          <div ref={容器Ref} id="barcode-scanner-container" className="barcode-scanner-root absolute inset-0" />
        )}

        {/* APP 环境：启动中 loading */}
        {是App && 模式 === "启动中" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/70">
            <svg className="w-10 h-10 animate-spin mb-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm">正在启动扫码...</span>
            <span className="text-xs mt-1 opacity-50">请对准条形码或二维码</span>
          </div>
        )}

        {/* APP 拍照模式提示 */}
        {是App && 模式 === "拍照" && !识别码 && !错误信息 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/70 px-6">
            <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
              />
            </svg>
            <p className="text-xs mt-1 opacity-60">点击下方按钮拍照识别条码</p>
          </div>
        )}

        {/* 浏览器环境：取景框 */}
        {!是App && 模式 === "扫描中" && !识别码 && !错误信息 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-72 h-32">
              <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-green-400" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-green-400" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-green-400" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-green-400" />
              <div className="absolute -top-7 left-0 right-0 text-center">
                <span className="text-xs text-white/80 bg-black/40 px-2 py-0.5 rounded">
                  将条形码对准框内
                </span>
              </div>
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-green-400/80 animate-scan-line" />
            </div>
          </div>
        )}

        {/* 不支持/错误提示 + 手动输入 */}
        {(模式 === "不支持" || (模式 === "错误" && !识别码)) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/70 px-6">
            <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
              />
            </svg>
            <p className="text-sm text-center">{模式 === "不支持" ? "当前环境不支持摄像头访问" : 错误信息}</p>
            <p className="text-xs mt-3 opacity-60">可手动输入条码</p>

            <div className="mt-4 w-full max-w-xs space-y-2">
              <input
                type="text"
                value={手动输入}
                onChange={(e) => set手动输入(e.target.value)}
                placeholder="输入配件编码..."
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder:text-white/40"
                autoFocus
              />
              <button
                type="button"
                onClick={手动输入确认}
                disabled={!手动输入.trim()}
                className="w-full py-2 bg-green-600 text-white text-sm rounded-lg disabled:opacity-30"
              >
                确认
              </button>
            </div>
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

      {/* ========== 底部控制栏 ========== */}
      <div className="shrink-0 bg-black/90 pb-safe">
        <div className="flex items-center justify-center gap-6 px-4 py-4">
          {!识别码 ? (
            <>
              {是App ? (
                <>
                  {/* APP 拍照模式 fallback */}
                  {模式 === "拍照" ? (
                    <button
                      type="button"
                      onClick={拍照识别条码}
                      className="flex flex-col items-center gap-1 text-white active:text-white"
                    >
                      <div className="w-16 h-16 rounded-full border-4 border-white/80 flex items-center justify-center active:scale-95 transition-transform">
                        <div className="w-12 h-12 rounded-full bg-white" />
                      </div>
                      <span className="text-[10px]">拍照识别</span>
                    </button>
                  ) : 模式 === "启动中" ? (
                    /* APP 启动中：显示取消提示 */
                    <span className="text-sm text-white/50">正在启动系统扫描器...</span>
                  ) : (
                    /* APP 错误或取消后：显示重新扫描 */
                    <button
                      type="button"
                      onClick={重新扫描}
                      className="px-6 py-2.5 rounded-full bg-white/10 text-white text-sm font-medium active:bg-white/20"
                    >
                      重新扫描
                    </button>
                  )}
                </>
              ) : (
                /* 浏览器环境 */
                <>
                  {模式 === "扫描中" && (
                    <div className="flex items-center justify-center gap-2 text-white/70">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span className="text-sm">正在扫描...</span>
                    </div>
                  )}
                  {(模式 === "错误" || 模式 === "不支持") && (
                    <button
                      type="button"
                      onClick={重新扫描}
                      className="px-6 py-2.5 rounded-full bg-white/10 text-white text-sm font-medium active:bg-white/20"
                    >
                      重新尝试摄像头
                    </button>
                  )}
                </>
              )}
            </>
          ) : (
            /* 识别成功后的按钮 */
            <>
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
