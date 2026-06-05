"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { vin17DecodeVin } from "@/lib/17vin/client";
import { 压缩图片为Base64, 文件转Base64 } from "@/lib/imageCompress";
import { 是Capacitor环境 } from "@/lib/capacitorEnv";
import { VinDecodeResult } from "./VinDecodeInput";

interface Props {
  open: boolean;
  onClose: () => void;
  onRecognize: (vin: string, result: VinDecodeResult | null) => void;
}

/* 取景框：画面中央，宽80%，高22%（VIN码是横向长条） */
const 取景框 = { x: 0.1, y: 0.39, w: 0.8, h: 0.22 };

export default function VinCameraModal({ open, onClose, onRecognize }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const 文件输入Ref = useRef<HTMLInputElement>(null);
  const 已取消Ref = useRef(false);

  const [模式, set模式] = useState<"实时" | "拍照" | "预览">("实时");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [recognizedVin, setRecognizedVin] = useState<string | null>(null);
  const [decodeResult, setDecodeResult] = useState<VinDecodeResult | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [手动输入Vin, set手动输入Vin] = useState("");

  const 是App = 是Capacitor环境();

  /* ========== 关闭相机（强制释放所有资源） ========== */
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  /* ========== 按比例裁剪 base64 图片 ========== */
  const 裁剪图片 = useCallback((base64: string, 比例: { x: number; y: number; w: number; h: number }, 质量 = 0.75): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cw = Math.round(比例.w * img.width);
        const ch = Math.round(比例.h * img.height);
        const cx = Math.round(比例.x * img.width);
        const cy = Math.round(比例.y * img.height);
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("canvas 不支持")); return; }
        ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
        resolve(canvas.toDataURL("image/jpeg", 质量));
      };
      img.onerror = () => reject(new Error("图片加载失败"));
      img.src = base64;
    });
  }, []);

  /* ========== 执行 OCR 识别 ========== */
  const doOcr = useCallback(async (base64: string) => {
    setRecognizing(true);
    setErrorMsg(null);
    setRecognizedVin(null);
    setDecodeResult(null);
    setDecoding(false);

    try {
      /* 传原始base64，API内部用sharp压缩 */
      const ocrResponse = await fetch("/api/vin-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Image: base64 }),
      });
      const ocrData = (await ocrResponse.json()) as {
        success: boolean;
        result?: {
          code: number;
          msg?: string;
          data?: {
            vin?: string;
            VIN?: string;
            Vin?: string;
            vin_no?: string;
            vin_code?: string;
            vehicle?: { vin?: string; VIN?: string };
            vehicle_info?: { vin?: string };
            ocr_result?: { vin?: string };
          };
        };
        error?: string;
      };
      if (!ocrData.success || !ocrData.result) {
        throw new Error(ocrData.error || "OCR 请求失败");
      }
      const ocrRes = ocrData.result;

      if (ocrRes.code !== 1) {
        throw new Error(ocrRes.msg || "未能识别出 VIN 码，请重试或手动输入");
      }

      /* 17VIN返回的data可能是字符串或对象 */
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
          (d.vehicle as { vin?: string; VIN?: string })?.vin ||
          (d.vehicle as { vin?: string; VIN?: string })?.VIN ||
          (d.vehicle_info as { vin?: string })?.vin ||
          (d.ocr_result as { vin?: string })?.vin ||
          "";
      }

      if (!detectedVin) {
        throw new Error("图片中未检测到 VIN 码，请对准 VIN 区域后重试");
      }

      const upperVin = detectedVin.toUpperCase();

      /* APP端：直接返回结果，不显示识别过程 */
      if (是App) {
        let result: VinDecodeResult | null = null;
        try {
          const decodeRes = (await vin17DecodeVin(upperVin)) as {
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
            result = {
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
          /* 解码失败不影响，用户已有 VIN */
        }
        onRecognize(upperVin, result);
        onClose();
        return;
      }

      /* 浏览器端：显示识别结果在弹窗中 */
      setRecognizedVin(upperVin);

      /* 异步解码车型 */
      setDecoding(true);
      try {
        const decodeRes = (await vin17DecodeVin(upperVin)) as {
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
          setDecodeResult({
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
          });
        }
      } catch {
        /* 解码失败不影响，用户已有 VIN */
      } finally {
        setDecoding(false);
      }
    } catch (err: unknown) {
      /* APP端出错：直接关闭弹窗，通过alert提示 */
      if (是App) {
        const msg = err instanceof Error ? err.message : "识别失败";
        alert(msg);
        onClose();
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : "识别失败");
    } finally {
      setRecognizing(false);
    }
  }, [是App, onRecognize, onClose]);

  /* ========== APP端：文件选择后识别（不显示过程） ========== */
  const 处理App文件选择 = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) {
        onClose();
        return;
      }
      try {
        const base64 =
          file.size > 512 * 1024
            ? await 压缩图片为Base64(file, { 最大宽度: 1024, 质量: 0.75 })
            : await 文件转Base64(file);
        /* 直接识别，不显示预览和loading */
        await doOcr(base64);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "识别失败";
        alert(msg);
        onClose();
      }
      /* 清空input，允许重复选择同一文件 */
      if (文件输入Ref.current) {
        文件输入Ref.current.value = "";
      }
    },
    [doOcr, onClose]
  );

  /* ========== 浏览器环境：启动实时摄像头 ========== */
  const 启动实时摄像头 = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      set模式("拍照");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      set模式("实时");
    } catch {
      set模式("拍照");
    }
  }, []);

  /* ========== 浏览器文件选择 ========== */
  const 处理文件选择 = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const base64 =
          file.size > 512 * 1024
            ? await 压缩图片为Base64(file, { 最大宽度: 1024, 质量: 0.75 })
            : await 文件转Base64(file);
        setPreviewImage(base64);
        set模式("预览");
        await doOcr(base64);
      } catch (err: unknown) {
        setErrorMsg("图片处理失败: " + (err instanceof Error ? err.message : String(err)));
      }
    },
    [doOcr]
  );

  /* ========== 浏览器实时截图识别 ========== */
  const 实时截图识别 = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cx = Math.round(取景框.x * vw);
    const cy = Math.round(取景框.y * vh);
    const cw = Math.round(取景框.w * vw);
    const ch = Math.round(取景框.h * vh);

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cw;
    cropCanvas.height = ch;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) return;
    cropCtx.drawImage(video, cx, cy, cw, ch, 0, 0, cw, ch);

    cropCanvas.toBlob(
      async (blob) => {
        if (!blob) return;
        try {
          const base64 = await 压缩图片为Base64(blob, { 最大宽度: 1024, 质量: 0.75 });
          setPreviewImage(base64);
          set模式("预览");
          await doOcr(base64);
        } catch {
          setErrorMsg("图片处理失败");
        }
      },
      "image/jpeg",
      0.75
    );
  }, [doOcr]);

  /* ========== 打开/关闭生命周期 ========== */
  useEffect(() => {
    已取消Ref.current = false;

    if (!open) {
      /* 关闭：强制释放 */
      stopCamera();
      set模式("实时");
      setPreviewImage(null);
      setRecognizedVin(null);
      setDecodeResult(null);
      setErrorMsg(null);
      setRecognizing(false);
      setDecoding(false);
      return;
    }

    /* 打开：重置状态 */
    setPreviewImage(null);
    setRecognizedVin(null);
    setDecodeResult(null);
      setErrorMsg(null);
    setRecognizing(false);
    setDecoding(false);

    if (是App) {
      /* APP：延迟300ms后自动打开原生相机，静默识别 */
      const timer = setTimeout(() => {
        void (async () => {
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
              await doOcr(base64);
            } else {
              onClose();
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("cancel") || msg.includes("denied") || msg.includes("User cancelled")) {
              onClose();
              return;
            }
            setErrorMsg("相机调用失败: " + msg);
          }
        })();
      }, 300);
      return () => clearTimeout(timer);
    } else {
      /* 浏览器：尝试实时摄像头 */
      set模式("实时");
      启动实时摄像头();
    }

    return () => {
      已取消Ref.current = true;
      stopCamera();
    };
  }, [open, 是App, stopCamera, 启动实时摄像头]);

  /* ========== 确认 ========== */
  const handleConfirm = useCallback(() => {
    const vin = recognizedVin || 手动输入Vin.trim();
    if (vin) {
      onRecognize(vin.toUpperCase(), decodeResult);
      onClose();
    }
  }, [recognizedVin, 手动输入Vin, decodeResult, onRecognize, onClose]);

  /* ========== 重拍 ========== */
  const handleRetake = useCallback(() => {
    setPreviewImage(null);
    setRecognizedVin(null);
    setDecodeResult(null);
    setErrorMsg(null);
    setRecognizing(false);
    setDecoding(false);
    set手动输入Vin("");

    if (是App) {
      /* APP：重新触发文件选择 */
      setTimeout(() => {
        文件输入Ref.current?.click();
      }, 100);
    } else {
      set模式("实时");
      启动实时摄像头();
    }
  }, [是App, 启动实时摄像头]);

  /* APP端：只渲染错误弹窗，相机调用在主useEffect中处理 */
  if (是App) {
    if (!open || !errorMsg) return null;
    return (
      <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center px-6">
        <div className="bg-white rounded-xl p-6 max-w-sm w-full text-center space-y-4">
          <div className="text-sm text-red-500">{errorMsg}</div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setTimeout(() => {
                  void (async () => {
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
                        await doOcr(base64);
                      } else {
                        onClose();
                      }
                    } catch (err: unknown) {
                      const msg = err instanceof Error ? err.message : String(err);
                      if (msg.includes("cancel") || msg.includes("denied")) {
                        onClose();
                        return;
                      }
                      setErrorMsg("相机调用失败: " + msg);
                    }
                  })();
                }, 100);
              }}
              className="flex-1 px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium active:bg-gray-200"
            >
              重试
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 h-12 bg-black/80 text-white shrink-0">
        <span className="text-sm font-medium">VIN 识别</span>
        <button
          type="button"
          onClick={() => {
            stopCamera();
            onClose();
          }}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 active:bg-white/20"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 relative overflow-hidden">
        {/* ========== 模式1：浏览器实时取景框 ========== */}
        {模式 === "实时" && (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
            {/* 取景框 */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 10 }}>
              <div
                className="relative border-2 border-blue-500/60"
                style={{ width: `${取景框.w * 100}%`, height: `${取景框.h * 100}%` }}
              >
                <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-blue-500" />
                <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-blue-500" />
                <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-blue-500" />
                <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-blue-500" />
                <div className="absolute -top-8 left-0 right-0 text-center">
                  <span className="text-xs text-white bg-blue-600/80 px-2 py-0.5 rounded">将 VIN 码对准框内</span>
                </div>
              </div>
            </div>
            {/* 底部拍照按钮 */}
            <div className="absolute bottom-8 left-0 right-0 flex justify-center" style={{ zIndex: 20 }}>
              <button
                type="button"
                onClick={实时截图识别}
                className="w-16 h-16 rounded-full border-4 border-white/80 flex items-center justify-center active:scale-95 transition-transform"
              >
                <div className="w-12 h-12 rounded-full bg-white" />
              </button>
            </div>
          </>
        )}

        {/* ========== 模式2：浏览器 fallback ========== */}
        {模式 === "拍照" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/70 px-6">
            <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-sm">实时摄像头不可用</p>
            <p className="text-xs mt-1 opacity-60">请选择图片</p>
            <label className="flex flex-col items-center gap-1 mt-6 text-white/70 active:text-white cursor-pointer select-none">
              <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-[10px]">选择图片</span>
              <input type="file" accept="image/*" onChange={处理文件选择} className="hidden" />
            </label>
            {errorMsg && <p className="text-xs mt-4 text-red-400">{errorMsg}</p>}
          </div>
        )}

        {/* ========== 模式3：预览识别结果 ========== */}
        {模式 === "预览" && previewImage && (
          <div className="absolute inset-0 w-full h-full">
            <img src={previewImage} alt="预览" className="w-full h-full object-contain bg-black" />
          </div>
        )}
      </div>

      {/* 底部控制栏 */}
      <div className="shrink-0 bg-black/90 pb-safe">
        {模式 === "预览" && (
          <div className="px-4 pt-3">
            {recognizing && (
              <div className="flex items-center justify-center gap-2 text-white/80 py-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-sm">正在识别 VIN...</span>
              </div>
            )}

            {!recognizing && recognizedVin && (
              <div className="text-center py-2 space-y-1">
                <div className="text-xs text-white/50">识别结果</div>
                <div className="inline-flex items-center gap-2 bg-blue-600/20 border border-blue-500/40 rounded-lg px-4 py-2">
                  <span className="text-lg font-bold text-blue-400 tracking-wider font-mono">{recognizedVin}</span>
                </div>
                {decoding && (
                  <div className="text-xs text-white/50 flex items-center justify-center gap-1">
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    正在查询车型...
                  </div>
                )}
                {decodeResult && !decoding && (
                  <div className="text-xs text-white/70">
                    {decodeResult.brand} {decodeResult.series} {decodeResult.model}
                    {decodeResult.year && ` · ${decodeResult.year}年`}
                  </div>
                )}
              </div>
            )}

            {!recognizing && errorMsg && (
              <div className="text-center py-2 space-y-2">
                <div className="text-xs text-white/50">识别失败</div>
                <div className="text-sm text-red-400">{errorMsg}</div>
                <div className="px-4">
                  <input
                    type="text"
                    placeholder="手动输入 VIN 码"
                    value={手动输入Vin}
                    onChange={(e) => set手动输入Vin(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder:text-white/40 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-center gap-6 px-4 py-4">
          {模式 === "预览" ? (
            <>
              <button
                type="button"
                onClick={handleRetake}
                disabled={recognizing}
                className="flex flex-col items-center gap-1 text-white/70 active:text-white disabled:opacity-40"
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
                disabled={!recognizedVin && !手动输入Vin.trim()}
                className="px-6 py-2.5 rounded-full bg-blue-600 text-white text-sm font-medium active:bg-blue-700 disabled:opacity-40 disabled:active:bg-blue-600"
              >
                使用此 VIN
              </button>
            </>
          ) : 模式 === "拍照" ? (
            <button
              type="button"
              onClick={() => { set模式("实时"); 启动实时摄像头(); }}
              className="px-6 py-2.5 rounded-full bg-white/10 text-white text-sm font-medium active:bg-white/20"
            >
              尝试实时取景
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
