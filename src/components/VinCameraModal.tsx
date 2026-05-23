"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { vin17OcrAndDecode } from "@/lib/17vin/client";
import { VinDecodeResult } from "./VinDecodeInput";

interface Props {
  open: boolean;
  onClose: () => void;
  onRecognize: (vin: string, result: VinDecodeResult | null) => void;
}

/* 压缩图片为 base64，宽度最大 1920，质量 0.85（VIN 需要更高清晰度） */
async function compressImage(file: File | Blob, maxWidth = 1920, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas 不支持"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片加载失败"));
    };
    img.src = url;
  });
}

/* file / blob 转 base64 */
async function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function VinCameraModal({ open, onClose, onRecognize }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [hasCamera, setHasCamera] = useState(true);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [recognizedVin, setRecognizedVin] = useState<string | null>(null);
  const [decodeResult, setDecodeResult] = useState<VinDecodeResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /* 打开相机 */
  useEffect(() => {
    if (!open) {
      stopCamera();
      setPreviewImage(null);
      setRecognizedVin(null);
      setDecodeResult(null);
      setErrorMsg(null);
      setRecognizing(false);
      return;
    }

    setPreviewImage(null);
    setRecognizedVin(null);
    setDecodeResult(null);
    setErrorMsg(null);
    setRecognizing(false);

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "environment" }, audio: false })
        .then((stream) => {
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }
          setHasCamera(true);
        })
        .catch(() => {
          setHasCamera(false);
        });
    } else {
      setHasCamera(false);
    }

    return () => {
      stopCamera();
    };
  }, [open]);

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  /* 拍照 */
  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        compressImage(blob, 1920, 0.85).then((base64) => {
          setPreviewImage(base64);
          doRecognize(base64);
        });
      },
      "image/jpeg",
      0.85
    );
  }, []);

  /* 从相册选择 */
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setErrorMsg("请选择图片文件");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setErrorMsg("图片大小不能超过 10MB");
        return;
      }

      try {
        const base64 =
          file.size > 512 * 1024
            ? await compressImage(file, 1920, 0.85)
            : await fileToBase64(file);
        setPreviewImage(base64);
        await doRecognize(base64);
      } catch (err: any) {
        setErrorMsg("图片处理失败: " + (err.message || String(err)));
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    []
  );

  /* 执行识别 */
  async function doRecognize(base64: string) {
    setRecognizing(true);
    setErrorMsg(null);
    setRecognizedVin(null);
    setDecodeResult(null);

    try {
      const base64Body = base64.split(",")[1] || "";
      const base64Urlencode = encodeURIComponent(base64Body);

      const res = await vin17OcrAndDecode(base64Urlencode);
      if (res.code !== 1 || !res.data?.model_list?.[0]) {
        throw new Error("未能识别出有效的 VIN 码或车型信息，请尝试手动输入");
      }

      /* 提取 VIN */
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

      if (!detectedVin) {
        throw new Error("识别到了车型信息，但未提取到 VIN 码");
      }

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
    } catch (err: any) {
      setErrorMsg(err.message || "识别失败");
    } finally {
      setRecognizing(false);
    }
  }

  /* 确认使用识别结果 */
  const handleConfirm = useCallback(() => {
    if (recognizedVin) {
      onRecognize(recognizedVin, decodeResult);
      onClose();
    }
  }, [recognizedVin, decodeResult, onRecognize, onClose]);

  /* 重新拍摄 */
  const handleRetake = useCallback(() => {
    setPreviewImage(null);
    setRecognizedVin(null);
    setDecodeResult(null);
    setErrorMsg(null);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 h-12 bg-black/80 text-white shrink-0">
        <span className="text-sm font-medium">VIN 识别</span>
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

      {/* 预览 / 相机画面 */}
      <div className="flex-1 relative overflow-hidden">
        {/* 实时预览 */}
        {!previewImage && hasCamera && (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* 取景框 */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-80 h-24">
                {/* 四边角 */}
                <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-blue-400" />
                <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-blue-400" />
                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-blue-400" />
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-blue-400" />
                {/* 提示文字 */}
                <div className="absolute -top-7 left-0 right-0 text-center">
                  <span className="text-xs text-white/80 bg-black/40 px-2 py-0.5 rounded">
                    对准挡风玻璃或车门框上的 VIN 码
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* 无摄像头时提示 */}
        {!previewImage && !hasCamera && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/70">
            <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-sm">无法访问摄像头</p>
            <p className="text-xs mt-1 opacity-60">请从相册选择图片</p>
          </div>
        )}

        {/* 拍照预览 */}
        {previewImage && (
          <img src={previewImage} alt="预览" className="absolute inset-0 w-full h-full object-contain bg-black" />
        )}
      </div>

      {/* 底部控制栏 */}
      <div className="shrink-0 bg-black/90 pb-safe">
        {/* 识别结果展示 */}
        {previewImage && (
          <div className="px-4 pt-3">
            {recognizing && (
              <div className="flex items-center justify-center gap-2 text-white/80 py-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <span className="text-sm">正在识别 VIN...</span>
              </div>
            )}

            {!recognizing && recognizedVin && decodeResult && (
              <div className="text-center py-2 space-y-1">
                <div className="text-xs text-white/50">识别结果</div>
                <div className="inline-flex items-center gap-2 bg-blue-600/20 border border-blue-500/40 rounded-lg px-4 py-2">
                  <span className="text-lg font-bold text-blue-400 tracking-wider font-mono">{recognizedVin}</span>
                </div>
                <div className="text-xs text-white/70">
                  {decodeResult.brand} {decodeResult.series} {decodeResult.model}
                  {decodeResult.year && ` · ${decodeResult.year}年`}
                </div>
              </div>
            )}

            {!recognizing && errorMsg && (
              <div className="text-center py-2">
                <div className="text-xs text-white/50 mb-1">识别失败</div>
                <div className="text-sm text-red-400">{errorMsg}</div>
              </div>
            )}
          </div>
        )}

        {/* 按钮行 */}
        <div className="flex items-center justify-center gap-6 px-4 py-4">
          {!previewImage ? (
            <>
              {/* 相册按钮 */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-1 text-white/70 active:text-white"
              >
                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <span className="text-[10px]">相册</span>
              </button>

              {/* 拍照按钮 */}
              {hasCamera && (
                <button
                  type="button"
                  onClick={handleCapture}
                  className="w-16 h-16 rounded-full border-4 border-white/80 flex items-center justify-center active:scale-95 transition-transform"
                >
                  <div className="w-12 h-12 rounded-full bg-white" />
                </button>
              )}

              {/* 占位让相册居中（无摄像头时） */}
              {!hasCamera && <div className="w-16" />}
            </>
          ) : (
            <>
              {/* 重新拍摄 */}
              <button
                type="button"
                onClick={handleRetake}
                disabled={recognizing}
                className="flex flex-col items-center gap-1 text-white/70 active:text-white disabled:opacity-40"
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
                <span className="text-[10px]">重拍</span>
              </button>

              {/* 确认 */}
              <button
                type="button"
                onClick={handleConfirm}
                disabled={recognizing || !recognizedVin}
                className="px-6 py-2.5 rounded-full bg-blue-600 text-white text-sm font-medium active:bg-blue-700 disabled:opacity-40 disabled:active:bg-blue-600"
              >
                使用此 VIN
              </button>
            </>
          )}
        </div>
      </div>

      {/* 隐藏的 file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
