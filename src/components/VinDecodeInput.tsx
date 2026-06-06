"use client";

import { useState, useRef, useEffect } from "react";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { vin17DecodeVin } from "@/lib/17vin/client";
import { 压缩图片为Base64, 文件转Base64 } from "@/lib/imageCompress";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import VinKeyboard from "./VinKeyboard";

/* VIN 内联键盘常量 */
const VIN_NUMBERS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const VIN_INVALID_LETTERS = new Set(["I", "O", "Q"]);
const QWERTY_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
];

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
  /* 识别成功后先调用此回调，返回 true 表示父组件已处理（不再弹窗），false 则继续弹窗 */
  onRecognize?: (vin: string, result: VinDecodeResult | null) => Promise<boolean>;
  placeholder?: string;
  inputClassName?: string;
  buttonClassName?: string;
  autoOpenCamera?: boolean;
}

export default function VinDecodeInput({
  value,
  onChange,
  onDecode,
  onRecognize,
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
  const [editingVin, setEditingVin] = useState<string>("");
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
    setOcrLoading(true);
    setRecognizedVin(null);
    setDecodeResult(null);
    setEditingVin("");

    try {
      const { detectedVin, decodeResult } = await callOcrApi(base64);
      const upperVin = detectedVin.toUpperCase();

      /* 先让父组件判断是否需要处理（如系统中已有该车辆） */
      if (onRecognize) {
        const handled = await onRecognize(upperVin, decodeResult);
        if (handled) {
          setOcrLoading(false);
          return;
        }
      }

      setRecognizedVin(upperVin);
      setEditingVin(upperVin);
      if (decodeResult) setDecodeResult(decodeResult);
      setPreviewOpen(true);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "识别失败");
    } finally {
      setOcrLoading(false);
    }
  }

  /* APP环境：识别后先通知父组件，未处理则打开编辑弹窗 */
  async function processBase64ImageSilent(base64: string) {
    try {
      const { detectedVin, decodeResult } = await callOcrApi(base64);
      const upperVin = detectedVin.toUpperCase();

      /* 先让父组件判断是否需要处理（如系统中已有该车辆） */
      if (onRecognize) {
        const handled = await onRecognize(upperVin, decodeResult);
        if (handled) return;
      }

      setRecognizedVin(upperVin);
      setDecodeResult(decodeResult);
      setEditingVin(upperVin);
      setPreviewOpen(true);
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
    const finalVin = (editingVin || recognizedVin || "").trim().toUpperCase();
    if (finalVin) {
      onChange(finalVin);
      if (decodeResult) {
        onDecode(decodeResult);
      }
      setPreviewOpen(false);
      setPreviewImage(null);
      setRecognizedVin(null);
      setDecodeResult(null);
      setEditingVin("");
    }
  }

  function handleCancel() {
    setPreviewOpen(false);
    setPreviewImage(null);
    setRecognizedVin(null);
    setDecodeResult(null);
    setEditingVin("");
  }

  function appendChar(char: string) {
    if (editingVin.length >= 17) return;
    setEditingVin((prev) => (prev + char).toUpperCase());
  }

  function handleDelete() {
    if (editingVin.length === 0) return;
    setEditingVin((prev) => prev.slice(0, -1));
  }

  function handleRetake() {
    setPreviewOpen(false);
    setPreviewImage(null);
    setRecognizedVin(null);
    setDecodeResult(null);
    setEditingVin("");
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

      {/* 识别结果编辑弹窗 */}
      {previewOpen && (
        <div className="fixed inset-0 z-[120] bg-gray-100 flex flex-col">
          {/* 顶部图片区 */}
          <div className="relative h-44 bg-black shrink-0">
            <button
              type="button"
              onClick={handleCancel}
              className="absolute top-3 left-3 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-black/40 text-white active:bg-black/60"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            {previewImage ? (
              <img src={previewImage} alt="预览" className="w-full h-full object-contain" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white/50">
                <span className="text-sm">已识别 VIN，请核对修改</span>
              </div>
            )}
          </div>

          {/* 白色内容区 */}
          <div className="flex-1 -mt-4 bg-white rounded-t-2xl relative z-10 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* VIN 编辑 */}
              <div className="space-y-2">
                <div className="text-xs text-gray-500">识别结果，点击可手动修改</div>
                <div className="bg-gray-100 rounded-lg px-4 py-3 text-center min-h-[3.5rem] flex items-center justify-center">
                  <span className={`text-xl tracking-widest font-mono ${editingVin ? "text-gray-900" : "text-gray-400"}`}>
                    {editingVin || "—"}
                  </span>
                </div>
                {decodeResult && (
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 shrink-0">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H8m4 0h3m-4-8h3m-4 4h3m-4 4h3" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">未填</div>
                      <div className="text-xs text-gray-500 truncate">
                        {decodeResult.brand} {decodeResult.series} {decodeResult.model}
                        {decodeResult.year && ` · ${decodeResult.year}年`}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div className="flex justify-center gap-8">
                <button
                  type="button"
                  onClick={handleRetake}
                  disabled={ocrLoading}
                  className="flex flex-col items-center gap-1.5 text-gray-700 active:text-gray-900 disabled:opacity-40"
                >
                  <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 active:bg-blue-100">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <span className="text-xs">重新识别</span>
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={ocrLoading || !(editingVin || recognizedVin || "").trim()}
                  className="flex flex-col items-center gap-1.5 text-gray-700 active:text-gray-900 disabled:opacity-40"
                >
                  <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center text-green-600 active:bg-green-100">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-xs">确认使用</span>
                </button>
              </div>
            </div>

            {/* 底部内联 VIN 键盘 */}
            <div className="shrink-0 bg-gray-200 p-2 pb-safe">
              <div className="flex justify-between items-center px-2 mb-2">
                <span className="text-xs text-gray-500">VIN码 {editingVin.length}/17 位</span>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!(editingVin || recognizedVin || "").trim()}
                  className="text-sm text-blue-600 font-medium active:text-blue-800 disabled:opacity-40"
                >
                  完成
                </button>
              </div>
              <div className="space-y-1.5">
                <div className="grid grid-cols-10 gap-1">
                  {VIN_NUMBERS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => appendChar(c)}
                      disabled={editingVin.length >= 17}
                      className="h-10 rounded bg-white text-gray-900 text-sm font-medium active:bg-gray-100 disabled:opacity-30"
                    >
                      {c}
                    </button>
                  ))}
                </div>
                {QWERTY_ROWS.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-10 gap-1">
                    {row.map((c) => {
                      const isInvalid = VIN_INVALID_LETTERS.has(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => !isInvalid && appendChar(c)}
                          disabled={isInvalid || editingVin.length >= 17}
                          className={`h-10 rounded text-sm font-medium active:bg-gray-100 ${
                            isInvalid
                              ? "bg-gray-200 text-gray-300 cursor-not-allowed"
                              : "bg-white text-gray-900 disabled:opacity-30"
                          }`}
                        >
                          {c}
                        </button>
                      );
                    })}
                    {idx === 2 && (
                      <>
                        <div />
                        <div />
                        <button
                          type="button"
                          onClick={handleDelete}
                          disabled={editingVin.length === 0}
                          className="h-10 rounded bg-amber-50 text-amber-700 text-sm font-medium active:bg-amber-100 disabled:opacity-40 flex items-center justify-center"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
                            <line x1="10" y1="9" x2="16" y2="15" />
                            <line x1="16" y1="9" x2="10" y2="15" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
