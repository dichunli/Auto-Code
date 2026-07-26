"use client";

import { useRef, useEffect } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import ScanOverlay from "./ScanOverlay";

/* ========== 浏览器环境支持的条码格式 ========== */
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

interface Props {
  onScan: (code: string) => void;
  onError: (message: string) => void;
}

/**
 * 浏览器环境条码扫描器
 * 使用 html5-qrcode 库实现摄像头实时扫描
 * 组件挂载时自动启动，卸载时自动停止
 */
export default function BrowserScanner({ onScan, onError }: Props) {
  const 容器Ref = useRef<HTMLDivElement>(null);
  const 扫描器Ref = useRef<Html5Qrcode | null>(null);
  const 已取消Ref = useRef(false);
  const onScanRef = useRef(onScan);
  const onErrorRef = useRef(onError);

  /* 同步最新回调引用，避免放入 useEffect 依赖数组 */
  useEffect(() => {
    onScanRef.current = onScan;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    已取消Ref.current = false;

    async function 启动() {
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
            /* 库的 start 配置类型未声明 formatsToSupport，但 2.x 运行时支持（条码格式白名单） */
            formatsToSupport: 浏览器条码格式,
            videoConstraints: {
              width: { min: 640, ideal: 1280 },
              height: { min: 480, ideal: 720 },
              facingMode: "environment",
            },
          } as Parameters<typeof 扫描器.start>[1],
          (解码文本) => {
            if (已取消Ref.current) return;
            onScanRef.current(解码文本);
            /* 自动停止 */
            扫描器.stop().catch(() => {});
          },
          () => { /* 持续扫描中，忽略帧解码错误 */ }
        );
      } catch (err: unknown) {
        if (已取消Ref.current) return;
        const 消息 = err instanceof Error ? err.message : String(err);
        if (消息.includes("NotAllowedError") || 消息.includes("Permission denied")) {
          onErrorRef.current("摄像头权限被拒绝");
        } else if (消息.includes("NotFoundError") || 消息.includes("DevicesNotFoundError")) {
          onErrorRef.current("未找到摄像头设备");
        } else if (消息.includes("NotReadableError") || 消息.includes("Could not start")) {
          onErrorRef.current("摄像头被占用，请关闭其他使用摄像头的应用后重试");
        } else {
          onErrorRef.current("无法启动摄像头: " + 消息);
        }
      }
    }

    启动();

    return () => {
      已取消Ref.current = true;
      if (扫描器Ref.current) {
        扫描器Ref.current.stop().catch(() => {});
        /* clear() 返回 void（同步），不能接 .catch */
        扫描器Ref.current.clear();
        扫描器Ref.current = null;
      }
    };
  }, []);

  return (
    <>
      <div ref={容器Ref} id="barcode-scanner-container" className="barcode-scanner-root absolute inset-0" />
      <ScanOverlay />
    </>
  );
}
