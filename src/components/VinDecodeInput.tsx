"use client";

import { useState, useRef, useEffect } from "react";
import { vin17DecodeVin, vin17OcrAndDecode } from "@/lib/17vin/client";
import VinKeyboard from "./VinKeyboard";

export interface VinDecodeResult {
  brand: string;
  series: string;
  model: string;
  year: string;
  engineNo: string;
  cc: string;
  transmissionType: string;
  transmissionCode: string;
  chassisCode: string;
  drivingMode: string;
  factory: string;
  modelId?: number;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onDecode: (result: VinDecodeResult | null) => void;
  placeholder?: string;
  inputClassName?: string;
  buttonClassName?: string;
}

export default function VinDecodeInput({
  value,
  onChange,
  onDecode,
  placeholder = "输入17位VIN码",
  inputClassName,
  buttonClassName,
}: Props) {
  const [decoding, setDecoding] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [recognizedVin, setRecognizedVin] = useState<string | null>(null);
  const [decodeResult, setDecodeResult] = useState<VinDecodeResult | null>(null);
  const pcInputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  /* 判断是否移动端（客户端挂载后检测，避免 SSR 不匹配） */
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent || "";
    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    setIsMobile(/Mobi|Android|iPhone|iPad|iPod/i.test(ua) || isTouch);
  }, []);

  async function handleDecode() {
    const vin = value.trim().toUpperCase();
    if (vin.length !== 17) {
      alert("VIN 码必须为 17 位");
      return;
    }
    setDecoding(true);
    try {
      const res = await vin17DecodeVin(vin);
      if (res.code !== 1 || !res.data?.model_list?.[0]) {
        alert("未找到该 VIN 码对应的车型信息");
        onDecode(null);
        return;
      }
      const m = res.data.model_list[0];
      onDecode({
        brand: m.Brand || m.brand || "",
        series: m.Series || m.series || "",
        model: m.Model || m.model || "",
        year: res.data.model_year_from_vin || m.Model_year || m.model_year || "",
        engineNo: m.Engine_no || m.engine_no || "",
        cc: m.Cc || m.cc || "",
        transmissionType: m.Transmission_type || m.transmission_type || "",
        transmissionCode: m.Trans_code || m.trans_code || "",
        chassisCode: m.Chassis_code || m.chassis_code || "",
        drivingMode: m.Driving_mode || m.driving_mode || "",
        factory: m.Factory || m.factory || "",
        modelId: m.Id || m.id || undefined,
      });
    } catch (err: unknown) {
      alert("解析失败: " + (err instanceof Error ? err.message : String(err)));
      onDecode(null);
    } finally {
      setDecoding(false);
    }
  }

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
    setOcrLoading(true);
    setRecognizedVin(null);
    setDecodeResult(null);

    try {
      const base64Body = base64.split(",")[1] || "";
      const base64Urlencode = encodeURIComponent(base64Body);

      const res = await vin17OcrAndDecode(base64Urlencode);
      if (res.code !== 1 || !res.data?.model_list?.[0]) {
        alert("未能识别出有效的 VIN 码或车型信息，请尝试手动输入");
        setOcrLoading(false);
        return;
      }

      const detectedVin =
        res.data?.vin ||
        res.data?.VIN ||
        res.data?.Vin ||
        res.data?.vin_no ||
        res.data?.vin_code ||
        res.data?.vehicle?.vin ||
        res.data?.vehicle?.VIN ||
        res.data?.vehicle_info?.vin ||
        res.data?.ocr_result?.vin ||
        res.vin ||
        res.VIN ||
        res.Vin ||
        "";

      const m = res.data.model_list[0];
      const result: VinDecodeResult = {
        brand: m.Brand || m.brand || "",
        series: m.Series || m.series || "",
        model: m.Model || m.model || "",
        year: res.data.model_year_from_vin || m.Model_year || m.model_year || "",
        engineNo: m.Engine_no || m.engine_no || "",
        cc: m.Cc || m.cc || "",
        transmissionType: m.Transmission_type || m.transmission_type || "",
        transmissionCode: m.Trans_code || m.trans_code || "",
        chassisCode: m.Chassis_code || m.chassis_code || "",
        drivingMode: m.Driving_mode || m.driving_mode || "",
        factory: m.Factory || m.factory || "",
        modelId: m.Id || m.id || undefined,
      };

      setRecognizedVin(detectedVin.toUpperCase());
      setDecodeResult(result);
    } catch (err: unknown) {
      alert("图片识别失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setOcrLoading(false);
    }

    e.target.value = "";
  }

  function handleConfirm() {
    if (recognizedVin) {
      onChange(recognizedVin);
      if (decodeResult) {
        onDecode(decodeResult);
      }
      setPreviewOpen(false);
      setPreviewImage(null);
      setRecognizedVin(null);
      setDecodeResult(null);
    }
  }

  function handleRetake() {
    setPreviewOpen(false);
    setPreviewImage(null);
    setRecognizedVin(null);
    setDecodeResult(null);
    if (isMobile && mobileInputRef.current) {
      mobileInputRef.current.click();
    } else if (!isMobile && pcInputRef.current) {
      pcInputRef.current.click();
    }
  }

  const photoClass =
    "px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 whitespace-nowrap shrink-0 inline-block cursor-pointer select-none" +
    (ocrLoading ? " opacity-50 pointer-events-none" : "");

  return (
    <>
      <div className="flex gap-2">
        <VinKeyboard
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className={inputClassName || "flex-1"}
        />
        <button
          type="button"
          onClick={handleDecode}
          disabled={decoding || value.trim().length !== 17}
          className={
            buttonClassName ||
            "px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          }
        >
          {decoding ? "解析中..." : "解析"}
        </button>
        {isMobile ? (
          <label className={photoClass}>
            {ocrLoading ? "识别中..." : "拍照"}
            <input
              ref={mobileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
        ) : (
          <label className={photoClass}>
            {ocrLoading ? "识别中..." : "拍照"}
            <input
              ref={pcInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
        )}
      </div>

      {/* 识别结果预览弹窗 */}
      {previewOpen && previewImage && (
        <div className="fixed inset-0 z-[120] bg-black flex flex-col">
          {/* 顶部栏 */}
          <div className="flex items-center justify-between px-4 h-12 bg-black/80 text-white shrink-0">
            <span className="text-sm font-medium">VIN 识别</span>
            <button
              type="button"
              onClick={() => {
                setPreviewOpen(false);
                setPreviewImage(null);
                setRecognizedVin(null);
                setDecodeResult(null);
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
            {ocrLoading ? (
              <div className="flex items-center justify-center gap-2 text-white/80 py-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-sm">正在识别 VIN...</span>
              </div>
            ) : recognizedVin ? (
              <div className="text-center py-2 space-y-1">
                <div className="text-xs text-white/50">识别结果</div>
                <div className="inline-flex items-center gap-2 bg-blue-600/20 border border-blue-500/40 rounded-lg px-4 py-2">
                  <span className="text-lg font-bold text-blue-400 tracking-wider font-mono">{recognizedVin}</span>
                </div>
                {decodeResult && (
                  <div className="text-xs text-white/70">
                    {decodeResult.brand} {decodeResult.series} {decodeResult.model}
                    {decodeResult.year && ` · ${decodeResult.year}年`}
                  </div>
                )}
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
                disabled={ocrLoading || !recognizedVin}
                className="px-6 py-2.5 rounded-full bg-blue-600 text-white text-sm font-medium active:bg-blue-700 disabled:opacity-40 disabled:active:bg-blue-600"
              >
                使用此 VIN
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
