"use client";

import { useState, useRef, ReactNode, useEffect } from "react";
import { recognizeLicensePlate } from "@/lib/baidu-ocr/client";

interface Props {
  onRecognize: (plateNumber: string) => void;
  className?: string;
  buttonText?: ReactNode;
  loadingText?: ReactNode;
}

export default function LicensePlateOcrButton({
  onRecognize,
  className = "",
  buttonText = "拍照识别",
  loadingText = "识别中...",
}: Props) {
  const [loading, setLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [recognizedPlate, setRecognizedPlate] = useState<string | null>(null);
  const pcInputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  /* 判断是否移动端（客户端挂载后检测，避免 SSR 不匹配） */
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent || "";
    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    setIsMobile(/Mobi|Android|iPhone|iPad|iPod/i.test(ua) || isTouch);
  }, []);

  /* 文件选择后识别 */
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("请选择图片文件");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("图片大小不能超过 10MB");
      return;
    }

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    setPreviewImage(base64);
    setPreviewOpen(true);
    setLoading(true);
    setRecognizedPlate(null);

    try {
      const plateNumber = await recognizeLicensePlate(base64);
      setRecognizedPlate(plateNumber.toUpperCase());
    } catch (err: unknown) {
      alert("车牌识别失败: " + (err instanceof Error ? err.message : String(err)));
      setPreviewOpen(false);
    } finally {
      setLoading(false);
    }

    e.target.value = "";
  }

  function handleConfirm() {
    if (recognizedPlate) {
      onRecognize(recognizedPlate);
      setPreviewOpen(false);
      setPreviewImage(null);
      setRecognizedPlate(null);
    }
  }

  function handleRetake() {
    setPreviewOpen(false);
    setPreviewImage(null);
    setRecognizedPlate(null);
    if (isMobile && mobileInputRef.current) {
      mobileInputRef.current.click();
    } else if (!isMobile && pcInputRef.current) {
      pcInputRef.current.click();
    }
  }

  const buttonClass =
    (className ||
      "px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 whitespace-nowrap shrink-0 inline-block cursor-pointer select-none") +
    (loading ? " opacity-50 pointer-events-none" : "");

  return (
    <>
      {isMobile ? (
        <>
          <label className={buttonClass}>
            {loading ? loadingText : buttonText}
            <input
              ref={mobileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
        </>
      ) : (
        <>
          <label className={buttonClass}>
            {loading ? loadingText : buttonText}
            <input
              ref={pcInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
        </>
      )}

      {/* 识别结果预览弹窗 */}
      {previewOpen && previewImage && (
        <div className="fixed inset-0 z-[120] bg-black flex flex-col">
          {/* 顶部栏 */}
          <div className="flex items-center justify-between px-4 h-12 bg-black/80 text-white shrink-0">
            <span className="text-sm font-medium">车牌识别</span>
            <button
              type="button"
              onClick={() => {
                setPreviewOpen(false);
                setPreviewImage(null);
                setRecognizedPlate(null);
              }}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 active:bg-white/20"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 图片预览 */}
          <div className="flex-1 relative overflow-hidden flex items-center justify-center">
            <img src={previewImage} alt="预览" className="max-w-full max-h-full object-contain" />
          </div>

          {/* 底部结果 */}
          <div className="shrink-0 bg-black/90 pb-safe px-4 py-4">
            {loading ? (
              <div className="flex items-center justify-center gap-2 text-white/80 py-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-sm">正在识别...</span>
              </div>
            ) : recognizedPlate ? (
              <div className="text-center py-2">
                <div className="text-xs text-white/50 mb-1">识别结果</div>
                <div className="inline-flex items-center gap-2 bg-green-600/20 border border-green-500/40 rounded-lg px-4 py-2">
                  <span className="text-lg font-bold text-green-400 tracking-wider">{recognizedPlate}</span>
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-center gap-6 mt-3">
              <button
                type="button"
                onClick={handleRetake}
                className="flex flex-col items-center gap-1 text-white/70 active:text-white"
              >
                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </div>
                <span className="text-[10px]">重拍</span>
              </button>

              <button
                type="button"
                onClick={handleConfirm}
                disabled={loading || !recognizedPlate}
                className="px-6 py-2.5 rounded-full bg-green-600 text-white text-sm font-medium active:bg-green-700 disabled:opacity-40 disabled:active:bg-green-600"
              >
                使用此车牌
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
