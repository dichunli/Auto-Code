"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { BarcodeScanner } from "@capacitor-mlkit/barcode-scanning";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import { 启动原生扫码 } from "@/lib/androidBarcode";
import { base64转Blob } from "@/lib/base64ToBlob";
import BrowserScanner from "./BrowserScanner";
import ScanResult from "./ScanResult";
import ScanError from "./ScanError";

/* ========== APP 环境条码格式名称（传给原生层） ========== */
const APP条码格式名称 = [
  "Code128",
  "Code39",
  "Ean13",
  "Ean8",
  "UpcA",
  "UpcE",
  "Itf",
  "Codabar",
  "QrCode",
];

interface Props {
  open: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
  /* 连续模式（2026-08-21 扫码收货）：扫到一个就回调一个，不关弹窗继续扫；
     浏览器端 2 秒内同码去重；APP 端扫完自动重启原生扫描 */
  连续模式?: boolean;
  /* 顶部标题（默认"扫码添加配件"） */
  标题?: string;
}

/**
 * 扫码弹窗主组件
 * 根据环境自动选择浏览器扫描（html5-qrcode）或 APP 原生扫描（Android 原生 Activity）
 */
export default function BarcodeScanModal({ open, onClose, onScan, 连续模式 = false, 标题 = "扫码添加配件" }: Props) {
  const [模式, set模式] = useState<"扫描中" | "识别成功" | "不支持" | "错误" | "启动中">("扫描中");
  const [识别码, set识别码] = useState<string | null>(null);
  const [错误信息, set错误信息] = useState<string | null>(null);
  const [浏览器扫描Key, set浏览器扫描Key] = useState(0);

  const 已取消Ref = useRef(false);
  const 扫描中Ref = useRef(false);
  const 已处理Ref = useRef(false);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  /* 连续模式：同码去重（2 秒内同一条码不重复回调） */
  const 上次码Ref = useRef<{ 码: string; 时间: number } | null>(null);
  const 连续模式Ref = useRef(连续模式);

  const 是App = 是Capacitor环境();

  /* 同步最新回调引用，避免放入 useEffect / useCallback 依赖数组 */
  useEffect(() => {
    onScanRef.current = onScan;
    onCloseRef.current = onClose;
    连续模式Ref.current = 连续模式;
  });

  /* 连续模式统一入口：去重后回调 + 短暂显示刚扫到的码 */
  const 连续回调 = useCallback((码: string) => {
    const 现在 = Date.now();
    if (上次码Ref.current && 上次码Ref.current.码 === 码 && 现在 - 上次码Ref.current.时间 < 2000) {
      return;
    }
    上次码Ref.current = { 码, 时间: 现在 };
    set识别码(码);
    onScanRef.current(码);
  }, []);

  /* 连续模式：重启原生扫描用（避免 useCallback 自引用） */
  const 重启APP扫码Ref = useRef<() => void>(() => {});

  /* ========== APP 环境：启动原生 Android 条码扫描 Activity ========== */
  const 启动APP扫码 = useCallback(async () => {
    if (已取消Ref.current || 扫描中Ref.current) return;
    扫描中Ref.current = true;
    已处理Ref.current = false;
    set模式("启动中");
    set错误信息(null);

    try {
      const 结果 = await 启动原生扫码(APP条码格式名称);
      if (已取消Ref.current) return;

      if (结果.barcode) {
        已处理Ref.current = true;
        if (连续模式Ref.current) {
          /* 连续模式：回调后自动重启原生扫描，直到用户关闭 */
          连续回调(结果.barcode);
          扫描中Ref.current = false;
          if (!已取消Ref.current) {
            set模式("扫描中");
            重启APP扫码Ref.current();
          }
          return;
        }
        set识别码(结果.barcode);
        set模式("识别成功");
        onScanRef.current(结果.barcode);
        onCloseRef.current();
      } else {
        /* 用户取消或原生扫码不可用 */
        set错误信息("扫描已取消，可拍照识别或手动输入条码");
        set模式("错误");
      }
    } catch (err: unknown) {
      if (已取消Ref.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      set错误信息("扫描失败: " + msg);
      set模式("错误");
    } finally {
      扫描中Ref.current = false;
    }
  }, [连续回调]);

  /* 供连续模式重启调用（始终保持最新函数引用） */
  useEffect(() => {
    重启APP扫码Ref.current = 启动APP扫码;
  }, [启动APP扫码]);

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

      /* 用 MLKit 识别图片中的条码 */
      const { barcodes } = await BarcodeScanner.readBarcodesFromImage({ blob });
      if (barcodes && barcodes.length > 0) {
        const code = barcodes[0].rawValue || barcodes[0].displayValue || "";
        if (code) {
          已处理Ref.current = true;
          set识别码(code);
          set模式("识别成功");
          onScanRef.current(code);
          onCloseRef.current();
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

  /* ========== 浏览器扫描回调 ========== */
  const handleBrowserScan = useCallback((code: string) => {
    if (连续模式Ref.current) {
      /* 连续模式：不中断扫描，去重回调 */
      连续回调(code);
      return;
    }
    set识别码(code);
    set模式("识别成功");
  }, [连续回调]);

  const handleBrowserError = useCallback((message: string) => {
    set错误信息(message);
    set模式("错误");
  }, []);

  /* ========== 打开/关闭时的生命周期 ========== */
  useEffect(() => {
    已取消Ref.current = false;

    if (!open) {
      /* 关闭弹窗：重置状态 */
      已取消Ref.current = true;
      set识别码(null);
      set错误信息(null);
      set模式("扫描中");
      扫描中Ref.current = false;
      已处理Ref.current = false;
      return;
    }

    /* 打开弹窗：重置状态 */
    set识别码(null);
    set错误信息(null);
    set模式("扫描中");
    set浏览器扫描Key((k) => k + 1);
    扫描中Ref.current = false;
    已处理Ref.current = false;

    if (是App) {
      启动APP扫码();
    }

    return () => {
      已取消Ref.current = true;
    };
  }, [open, 是App, 启动APP扫码]);

  /* ========== 确认使用 ========== */
  const 确认使用 = useCallback(() => {
    if (识别码) {
      onScanRef.current(识别码);
      onCloseRef.current();
    }
  }, [识别码]);

  /* ========== 重新扫描 ========== */
  const 重新扫描 = useCallback(async () => {
    set识别码(null);
    set错误信息(null);
    set模式("扫描中");
    扫描中Ref.current = false;
    已处理Ref.current = false;
    已取消Ref.current = false;

    if (是App) {
      await 启动APP扫码();
    } else {
      /* 浏览器：通过改变 key 强制 BrowserScanner 重新挂载 */
      set浏览器扫描Key((k) => k + 1);
    }
  }, [是App, 启动APP扫码]);

  /* ========== 手动输入确认 ========== */
  const handleManualInput = useCallback((value: string) => {
    if (!value) return;
    if (连续模式Ref.current) {
      /* 连续模式：手动输入等同扫到一个码，不关弹窗 */
      连续回调(value);
      return;
    }
    onScanRef.current(value);
    onCloseRef.current();
  }, [连续回调]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black flex flex-col">
      {/* html5-qrcode 样式覆盖 */}
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
        <span className="text-sm font-medium">{标题}</span>
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

      {/* ========== 内容区域 ========== */}
      <div className="flex-1 relative overflow-hidden">
        {/* 浏览器扫描：通过 key 控制重新挂载；连续模式扫到码也继续挂着 */}
        {!是App && 模式 !== "不支持" && (连续模式 || (!识别码 && 模式 !== "错误")) && (
          <BrowserScanner key={浏览器扫描Key} onScan={handleBrowserScan} onError={handleBrowserError} 连续模式={连续模式} />
        )}

        {/* 连续模式：右上角浮动显示刚扫到的码 */}
        {连续模式 && 识别码 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-green-600 text-white text-xs shadow-lg">
            已扫：{识别码}
          </div>
        )}

        {/* APP 启动中 loading */}
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

        {/* 浏览器不支持提示 */}
        {!是App && 模式 === "不支持" && (
          <ScanError message="当前环境不支持摄像头访问" isNotSupported onConfirm={handleManualInput} />
        )}

        {/* 错误提示 + 手动输入 */}
        {模式 === "错误" && !识别码 && (
          <ScanError message={错误信息 || "扫描失败"} onConfirm={handleManualInput} />
        )}

        {/* 识别结果（连续模式不遮罩，用浮动小条提示） */}
        {识别码 && !连续模式 && <ScanResult code={识别码} />}
      </div>

      {/* ========== 底部控制栏 ========== */}
      <div className="shrink-0 bg-black/90 pb-safe">
        <div className="flex items-center justify-center gap-6 px-4 py-4">
          {连续模式 ? (
            <span className="text-sm text-white/70">连续扫码中…扫完点右上角 × 结束</span>
          ) : !识别码 ? (
            <>
              {是App ? (
                <>
                  {/* APP 启动中提示 */}
                  {模式 === "启动中" && (
                    <span className="text-sm text-white/50">正在启动系统扫描器...</span>
                  )}
                  {/* APP 错误或扫描中：显示重新扫描 + 拍照识别 */}
                  {(模式 === "错误" || 模式 === "扫描中") && (
                    <>
                      <button
                        type="button"
                        onClick={重新扫描}
                        className="px-5 py-2.5 rounded-full bg-white/10 text-white text-sm font-medium active:bg-white/20"
                      >
                        重新扫描
                      </button>
                      <button
                        type="button"
                        onClick={拍照识别条码}
                        className="px-5 py-2.5 rounded-full bg-blue-600 text-white text-sm font-medium active:bg-blue-700"
                      >
                        拍照识别
                      </button>
                    </>
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
