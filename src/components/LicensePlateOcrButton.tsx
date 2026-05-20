"use client";

import { useState, useRef } from "react";
import { recognizeLicensePlate } from "@/lib/baidu-ocr/client";

interface Props {
  onRecognize: (plateNumber: string) => void;
  className?: string;
  buttonText?: string;
  loadingText?: string;
}

export default function LicensePlateOcrButton({
  onRecognize,
  className = "",
  buttonText = "拍照识别",
  loadingText = "识别中...",
}: Props) {
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    } catch (err: any) {
      alert("车牌识别失败: " + (err.message || String(err)));
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={loading}
        className={
          className ||
          "px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 whitespace-nowrap shrink-0"
        }
      >
        {loading ? loadingText : buttonText}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />
    </>
  );
}
