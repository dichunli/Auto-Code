"use client";

import { useState, useRef, useEffect } from "react";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { vin17DecodeVin } from "@/lib/17vin/client";
import { 压缩图片为Base64, 文件转Base64 } from "@/lib/imageCompress";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
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
  autoOpenCamera?: boolean;
}

export default function VinDecodeInput({
  value,
  onChange,
  onDecode,
  placeholder = "输入17位VIN码",
  inputClassName,
  buttonClassName,
  autoOpenCamera,
}: Props) {
  const [decoding, setDecoding] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [recognizedVin, setRecognizedVin] = useState<string | null>(null);
  const [decodeResult, setDecodeResult] = useState<VinDecodeResult | null>(null);
  const [queryingModel, setQueryingModel] = useState(false);
  const pcInputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  const 是App = 是Capacitor环境();

  /* 判断是否移动端（客户端挂载后检测，避免 SSR 不匹配） */
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent || "";
    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    setIsMobile(/Mobi|Android|iPhone|iPad|iPod/i.test(ua) || isTouch);
  }, []);

  /* 自动打开相机（接车登记流程：未找到车辆时自动触发 VIN 拍照）
   * 注意：不用 isMobile 做条件，避免时序问题（isMobile 初始 false 可能跳过触发）
   * APP 环境直接调原生相机；浏览器环境通过 ref 触发 input click */
  useEffect(() => {
    if (!autoOpenCamera || ocrLoading) return;
    const timer = setTimeout(() => {
      if (是App) {
        void APP拍照识别();
      } else if (mobileInputRef.current) {
        try {
          mobileInputRef.current.click();
        } catch {
          /* 浏览器可能阻止非用户手势的自动点击，静默忽略 */
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [autoOpenCamera, ocrLoading, 是App]);

  async function handleDecode() {
    const vin = value.trim().toUpperCase();
    if (vin.length !== 17) {
      alert(`VIN 码必须为 17 位，当前 ${vin.length} 位，请检查是否多输入或少输入字符`);
      return;
    }
    setDecoding(true);
    try {
      const res = (await vin17DecodeVin(vin)) as {
        code: number;
        data?: {
          model_list?: Array<{
            Brand?: string; brand?: string;
            Series?: string; series?: string;
            Model?: string; model?: string;
            Model_year?: string; model_year?: string;
            Engine_no?: string; engine_no?: string;
            Cc?: string; cc?: string;
            Transmission_type?: string; transmission_type?: string;
            Trans_code?: string; trans_code?: string;
            Chassis_code?: string; chassis_code?: string;
            Driving_mode?: string; driving_mode?: string;
            Factory?: string; factory?: string;
            Id?: number; id?: number;
          }>;
          model_year_from_vin?: string;
        };
      };
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

  /* 调用 API 路由进行 OCR 识别 */
  async function callOcrApi(base64: string): Promise<{
    detectedVin: string;
    decodeResult: VinDecodeResult | null;
  }> {
    const res = await fetch("/api/vin-ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64Image: base64 }),
    });
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || "识别失败");
    }

    const ocrRes = data.result as {
      code: number;
      msg?: string;
      data?: string | Record<string, unknown>;
    };

    if (ocrRes.code !== 1) {
      throw new Error(ocrRes.msg || "未能识别出 VIN 码");
    }

    /* 处理 data 是字符串或对象的情况 */
    let detectedVin = "";
    if (typeof ocrRes.data === "string") {
      detectedVin = ocrRes.data;
    } else if (ocrRes.data && typeof ocrRes.data === "object") {
      const d = ocrRes.data as Record<string, unknown>;
      detectedVin =
        (d.vin as string) ||
        (d.VIN as string) ||
        (d.Vin as string) ||
        (d.vin_no as string) ||
        (d.vin_code as string) ||
        "";
    }

    if (!detectedVin) {
      throw new Error("图片中未检测到 VIN 码");
    }

    /* 解码车型 */
    let decodeResult: VinDecodeResult | null = null;
    try {
      const decodeRes = (await vin17DecodeVin(detectedVin.toUpperCase())) as {
        code: number;
        data?: {
          model_list?: Array<{
            Brand?: string; brand?: string;
            Series?: string; series?: string;
            Model?: string; model?: string;
            Model_year?: string; model_year?: string;
            Engine_no?: string; engine_no?: string;
            Cc?: string; cc?: string;
            Transmission_type?: string; transmission_type?: string;
            Trans_code?: string; trans_code?: string;
            Chassis_code?: string; chassis_code?: string;
            Driving_mode?: string; driving_mode?: string;
            Factory?: string; factory?: string;
            Id?: number; id?: number;
          }>;
          model_year_from_vin?: string;
        };
      };

      if (decodeRes.code === 1 && decodeRes.data?.model_list?.[0]) {
        const m = decodeRes.data.model_list[0];
        decodeResult = {
          brand: m.Brand || m.brand || "",
          series: m.Series || m.series || "",
          model: m.Model || m.model || "",
          year: decodeRes.data.model_year_from_vin || m.Model_year || m.model_year || "",
          engineNo: m.Engine_no || m.engine_no || "",
          cc: m.Cc || m.cc || "",
          transmissionType: m.Transmission_type || m.transmission_type || "",
          transmissionCode: m.Trans_code || m.trans_code || "",
          chassisCode: m.Chassis_code || m.chassis_code || "",
          drivingMode: m.Driving_mode || m.driving_mode || "",
          factory: m.Factory || m.factory || "",
          modelId: m.Id || m.id || undefined,
        };
      }
    } catch {
      /* 解码失败不影响 */
    }

    return { detectedVin, decodeResult };
  }

  /* 浏览器环境：显示识别过程 */
  async function processBase64Image(base64: string) {
    setPreviewImage(base64);
    setPreviewOpen(true);
    setOcrLoading(true);
    setRecognizedVin(null);
    setDecodeResult(null);
    setQueryingModel(false);

    try {
      const { detectedVin, decodeResult } = await callOcrApi(base64);
      setRecognizedVin(detectedVin.toUpperCase());
      if (decodeResult) setDecodeResult(decodeResult);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "识别失败");
    } finally {
      setOcrLoading(false);
    }
  }

  /* APP环境：静默识别，不显示过程 */
  async function processBase64ImageSilent(base64: string) {
    try {
      const { detectedVin, decodeResult } = await callOcrApi(base64);
      const upperVin = detectedVin.toUpperCase();
      onChange(upperVin);
      if (decodeResult) onDecode(decodeResult);
      alert(`识别成功: ${upperVin}\n${decodeResult?.brand || ""} ${decodeResult?.series || ""} ${decodeResult?.model || ""}`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "识别失败");
    }
  }

  /* 浏览器环境：文件选择后识别 */
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("请选择图片文件");
      e.target.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("图片大小不能超过 10MB");
      e.target.value = "";
      return;
    }

    try {
      /* 压缩图片（>512KB 才压缩） */
      const base64 =
        file.size > 512 * 1024
          ? await 压缩图片为Base64(file, { 最大宽度: 1024, 质量: 0.75 })
          : await 文件转Base64(file);
      await processBase64Image(base64);
    } catch (err: unknown) {
      alert("图片识别失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      e.target.value = "";
    }
  }

  /* APP 环境：调用原生相机拍照，静默识别（不显示过程） */
  async function APP拍照识别() {
    if (ocrLoading) return;
    try {
      const image = await Camera.getPhoto({
        quality: 60,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
        width: 1280,
      });
      if (image.base64String) {
        const base64 = `data:image/jpeg;base64,${image.base64String}`;
        /* APP端静默识别，不显示预览弹窗 */
        await processBase64ImageSilent(base64);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("cancel") || msg.includes("denied") || msg.includes("User cancelled")) {
        return;
      }
      alert("相机调用失败: " + msg);
    }
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
    if (是App) {
      void APP拍照识别();
    } else if (isMobile && mobileInputRef.current) {
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
        {是App ? (
          /* APP 环境：调用 Capacitor 原生相机 */
          <button type="button" onClick={APP拍照识别} disabled={ocrLoading} className={photoClass}>
            {ocrLoading ? "识别中..." : "拍照"}
          </button>
        ) : isMobile ? (
          /* 浏览器移动端：用 HTML5 capture */
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
          /* PC 端 */
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
                {queryingModel && (
                  <div className="text-xs text-white/50 flex items-center justify-center gap-1">
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    正在查询车型...
                  </div>
                )}
                {decodeResult && !queryingModel && (
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
