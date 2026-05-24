"use client";

import { useState, useRef, ReactNode, useId, useEffect } from "react";
import dynamic from "next/dynamic";
import { recognizeLicensePlate } from "@/lib/baidu-ocr/client";

const LicensePlateCameraModal = dynamic(
  () => import("./LicensePlateCameraModal"),
  { ssr: false }
);

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
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileId = `lp-pc-${useId()}`;

  /* 判断是否移动端（客户端挂载后检测，避免 SSR 不匹配） */
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent || "";
    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    setIsMobile(/Mobi|Android|iPhone|iPad|iPod/i.test(ua) || isTouch);
  }, []);

  function handleClick() {
    if (isMobile) {
      setOpen(true);
    }
    /* PC 端由 label 自动触发文件选择 */
  }

  /* PC 端文件选择后识别 */
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

    setLoading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const plateNumber = await recognizeLicensePlate(base64);
      onRecognize(plateNumber.toUpperCase());
    } catch (err: unknown) {
      alert("车牌识别失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  return (
    <>
      <label
        htmlFor={isMobile ? undefined : fileId}
        onClick={isMobile ? handleClick : undefined}
        className={
          (className ||
            "px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 whitespace-nowrap shrink-0 inline-block cursor-pointer select-none") +
          (loading ? " opacity-50 pointer-events-none" : "")
        }
      >
        {loading ? loadingText : buttonText}
      </label>

      {/* 移动端相机弹窗 */}
      {isMobile && (
        <LicensePlateCameraModal
          open={open}
          onClose={() => setOpen(false)}
          onRecognize={onRecognize}
        />
      )}

      {/* PC 端兜底 file input */}
      {!isMobile && (
        <input
          id={fileId}
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
      )}
    </>
  );
}
