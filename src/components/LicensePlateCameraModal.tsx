"use client";

import { useState, useRef, useEffect, useCallback, useId } from "react";
import { recognizeLicensePlate } from "@/lib/baidu-ocr/client";
import { 压缩图片为Base64, 文件转Base64 } from "@/lib/imageCompress";

interface Props {
  open: boolean;
  onClose: () => void;
  onRecognize: (plateNumber: string) => void;
}

/* 取景框：画面中央，宽75%，高28%（车牌比VIN大一些） */
const 取景框 = { x: 0.125, y: 0.36, w: 0.75, h: 0.28 };

export default function LicensePlateCameraModal({ open, onClose, onRecognize }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileId = `lp-album-${useId()}`;
  const captureFileId = `lp-capture-${useId()}`;

  const [hasCamera, setHasCamera] = useState(true);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [recognizedPlate, setRecognizedPlate] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /* 关闭相机 */
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  /* 执行识别 */
  const doRecognize = useCallback(async (base64: string) => {
    setRecognizing(true);
    setErrorMsg(null);
    setRecognizedPlate(null);
    try {
      const plate = await recognizeLicensePlate(base64);
      setRecognizedPlate(plate.toUpperCase());
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "识别失败");
    } finally {
      setRecognizing(false);
    }
  }, []);

  /* 打开相机 */
  useEffect(() => {
    if (!open) {
      stopCamera();
      setPreviewImage(null);
      setRecognizedPlate(null);
      setErrorMsg(null);
      setRecognizing(false);
      return;
    }

    setPreviewImage(null);
    setRecognizedPlate(null);
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
  }, [open, stopCamera]);

  /* 拍照：截取取景框区域，压缩，立即识别 */
  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    /* 计算取景框在视频帧上的像素坐标 */
    const cx = Math.round(取景框.x * vw);
    const cy = Math.round(取景框.y * vh);
    const cw = Math.round(取景框.w * vw);
    const ch = Math.round(取景框.h * vh);

    /* 裁剪视频帧 */
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cw;
    cropCanvas.height = ch;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) return;
    cropCtx.drawImage(video, cx, cy, cw, ch, 0, 0, cw, ch);

    /* 转为 base64 并压缩 */
    cropCanvas.toBlob(
      async (blob) => {
        if (!blob) return;
        try {
          const base64 = await 压缩图片为Base64(blob, { 最大宽度: 1024, 质量: 0.75 });
          setPreviewImage(base64);
          await doRecognize(base64);
        } catch {
          setErrorMsg("图片处理失败");
        }
      },
      "image/jpeg",
      0.75
    );
  }, [doRecognize]);

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
            ? await 压缩图片为Base64(file, { 最大宽度: 1024, 质量: 0.75 })
            : await 文件转Base64(file);
        setPreviewImage(base64);
        await doRecognize(base64);
      } catch (err: unknown) {
        setErrorMsg("图片处理失败: " + (err instanceof Error ? err.message : String(err)));
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [doRecognize]
  );

  /* 确认使用识别结果 */
  const handleConfirm = useCallback(() => {
    if (recognizedPlate) {
      onRecognize(recognizedPlate);
      onClose();
    }
  }, [recognizedPlate, onRecognize, onClose]);

  /* 重新拍摄 */
  const handleRetake = useCallback(() => {
    setPreviewImage(null);
    setRecognizedPlate(null);
    setErrorMsg(null);
    setRecognizing(false);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 h-12 bg-black/80 text-white shrink-0">
        <span className="text-sm font-medium">车牌识别</span>
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
            <div
              className="absolute flex items-center justify-center pointer-events-none"
              style={{ top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }}
            >
              <div
                className="relative"
                style={{
                  width: `${取景框.w * 100}%`,
                  height: `${取景框.h * 100}%`,
                  border: '2px solid rgba(74, 222, 128, 0.6)',
                }}
              >
                {/* 四边角（加粗） */}
                <div className="absolute" style={{ top: -2, left: -2, width: 24, height: 24, borderTop: '4px solid rgb(74, 222, 128)', borderLeft: '4px solid rgb(74, 222, 128)' }} />
                <div className="absolute" style={{ top: -2, right: -2, width: 24, height: 24, borderTop: '4px solid rgb(74, 222, 128)', borderRight: '4px solid rgb(74, 222, 128)' }} />
                <div className="absolute" style={{ bottom: -2, left: -2, width: 24, height: 24, borderBottom: '4px solid rgb(74, 222, 128)', borderLeft: '4px solid rgb(74, 222, 128)' }} />
                <div className="absolute" style={{ bottom: -2, right: -2, width: 24, height: 24, borderBottom: '4px solid rgb(74, 222, 128)', borderRight: '4px solid rgb(74, 222, 128)' }} />
                {/* 中间提示线 */}
                <div className="absolute" style={{ top: '50%', left: 0, right: 0, height: 1, background: 'rgba(74, 222, 128, 0.3)' }} />
                {/* 提示文字 */}
                <div className="absolute text-center" style={{ top: -32, left: 0, right: 0 }}>
                  <span style={{ fontSize: 12, color: '#fff', background: 'rgba(22, 163, 74, 0.8)', padding: '2px 8px', borderRadius: 4 }}>
                    将车牌对准框内
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

        {/* 拍照预览（显示裁剪后的图片） */}
        {previewImage && (
          <div className="absolute inset-0 w-full h-full">
            <img src={previewImage} alt="预览" className="w-full h-full object-contain bg-black" />
          </div>
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
                <span className="text-sm">正在识别...</span>
              </div>
            )}

            {!recognizing && recognizedPlate && (
              <div className="text-center py-2">
                <div className="text-xs text-white/50 mb-1">识别结果</div>
                <div className="inline-flex items-center gap-2 bg-green-600/20 border border-green-500/40 rounded-lg px-4 py-2">
                  <span className="text-lg font-bold text-green-400 tracking-wider">{recognizedPlate}</span>
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
              <label
                htmlFor={fileId}
                className="flex flex-col items-center gap-1 text-white/70 active:text-white cursor-pointer select-none"
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
              </label>

              {/* 打开系统相机（capture 方式） */}
              <label
                htmlFor={captureFileId}
                className="flex flex-col items-center gap-1 text-white active:text-white cursor-pointer select-none"
              >
                <div className="w-16 h-16 rounded-full border-4 border-white/80 flex items-center justify-center active:scale-95 transition-transform">
                  <div className="w-12 h-12 rounded-full bg-white" />
                </div>
                <span className="text-[10px]">拍照</span>
              </label>

              {/* 应用内截图：点击后直接截取取景框区域并识别 */}
              {hasCamera ? (
                <button
                  type="button"
                  onClick={handleCapture}
                  disabled={recognizing}
                  className="flex flex-col items-center gap-1 text-white/70 active:text-white disabled:opacity-40"
                >
                  <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <span className="text-[10px]">截图</span>
                </button>
              ) : (
                <div className="w-16" />
              )}
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
                disabled={recognizing || !recognizedPlate}
                className="px-6 py-2.5 rounded-full bg-green-600 text-white text-sm font-medium active:bg-green-700 disabled:opacity-40 disabled:active:bg-green-600"
              >
                使用此车牌
              </button>
            </>
          )}
        </div>
      </div>

      {/* 相册 file input */}
      <input
        id={fileId}
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
      {/* 系统相机 capture input */}
      <input
        id={captureFileId}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
