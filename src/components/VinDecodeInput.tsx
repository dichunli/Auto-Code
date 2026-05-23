"use client";

import { useState, useRef } from "react";
import dynamic from "next/dynamic";
import { vin17DecodeVin, vin17OcrAndDecode } from "@/lib/17vin/client";
import VinKeyboard from "./VinKeyboard";

const VinCameraModal = dynamic(() => import("./VinCameraModal"), { ssr: false });

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
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* 判断是否移动端 */
  const isMobile =
    typeof navigator !== "undefined" &&
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

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
    } catch (err: any) {
      alert("解析失败: " + (err.message || String(err)));
      onDecode(null);
    } finally {
      setDecoding(false);
    }
  }

  /* 移动端相机弹窗识别回调 */
  function handleCameraRecognize(vin: string, result: VinDecodeResult | null) {
    onChange(vin);
    if (result) {
      onDecode(result);
    }
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

    setOcrLoading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const base64Body = base64.split(",")[1] || "";
      const base64Urlencode = encodeURIComponent(base64Body);

      const res = await vin17OcrAndDecode(base64Urlencode);
      if (res.code !== 1 || !res.data?.model_list?.[0]) {
        alert("未能识别出有效的 VIN 码或车型信息，请尝试手动输入");
        onDecode(null);
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
      if (detectedVin) {
        onChange(detectedVin.toUpperCase());
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
    } catch (err: any) {
      alert("图片识别失败: " + (err.message || String(err)));
      onDecode(null);
    } finally {
      setOcrLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handlePhotoClick() {
    if (isMobile) {
      setCameraOpen(true);
    } else {
      fileInputRef.current?.click();
    }
  }

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
        <button
          type="button"
          onClick={handlePhotoClick}
          disabled={ocrLoading}
          className="px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          {ocrLoading ? "识别中..." : "拍照"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* 移动端相机弹窗 */}
      {isMobile && (
        <VinCameraModal
          open={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onRecognize={handleCameraRecognize}
        />
      )}
    </>
  );
}
