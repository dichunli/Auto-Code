"use client";

import { useState, useRef } from "react";
import { PageHeader } from "@/components/PageHeader";

export default function VinTestPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    vin?: string;
    msg?: string;
    error?: string;
    imageSize?: number;
    rawData?: string;
  } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("请选择图片文件");
      return;
    }

    /* 读取文件为base64 */
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      setPreviewUrl(base64);
      await doOcr(base64, file.size);
    };
    reader.readAsDataURL(file);
  }

  async function doOcr(base64: string, originalSize: number) {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/vin-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Image: base64 }),
      });
      const data = await res.json();

      if (data.success) {
        const ocrRes = data.result as {
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

        /* 17VIN返回的data可能是字符串也可能是对象 */
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

        setResult({
          success: ocrRes.code === 1,
          vin: detectedVin || undefined,
          msg: ocrRes.code !== 1 ? (ocrRes.msg || undefined) : undefined,
          imageSize: originalSize,
          rawData: JSON.stringify(ocrRes, null, 2),
        });
      } else {
        setResult({
          success: false,
          error: data.error || "请求失败",
          imageSize: originalSize,
        });
      }
    } catch (err: unknown) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : "识别失败",
        imageSize: originalSize,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <PageHeader title="VIN OCR 测试" />

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="text-sm text-gray-600 mb-4">
          选择一张包含 VIN 码的图片进行测试。支持 JPG、PNG 格式。
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "识别中..." : "选择图片"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
          {loading && (
            <span className="text-sm text-gray-500">正在识别，请稍候...</span>
          )}
        </div>
      </div>

      {/* 图片预览 */}
      {previewUrl && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">上传的图片</h2>
          <img
            src={previewUrl}
            alt="预览"
            className="max-w-full max-h-80 object-contain rounded-lg border border-gray-100"
          />
        </div>
      )}

      {/* 识别结果 */}
      {result && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">识别结果</h2>

          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-24">状态：</span>
              {result.success ? (
                <span className="text-green-600 font-medium">识别成功</span>
              ) : (
                <span className="text-red-600 font-medium">识别失败</span>
              )}
            </div>

            {result.imageSize !== undefined && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-24">原图大小：</span>
                <span className="text-gray-900">{(result.imageSize / 1024).toFixed(1)} KB</span>
              </div>
            )}

            {result.vin && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-24">VIN 码：</span>
                <span className="font-mono text-lg font-bold text-blue-600 tracking-wider">
                  {result.vin}
                </span>
              </div>
            )}

            {result.msg && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-24">失败原因：</span>
                <span className="text-red-500">{result.msg}</span>
              </div>
            )}

            {result.error && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-24">错误信息：</span>
                <span className="text-red-500">{result.error}</span>
              </div>
            )}

            {result.rawData && (
              <div className="mt-4">
                <div className="text-gray-500 text-sm mb-1">17VIN 原始返回数据：</div>
                <pre className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 overflow-auto max-h-60">
                  {result.rawData}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 使用说明 */}
      <div className="bg-yellow-50 rounded-xl border border-yellow-200 p-4 mt-6">
        <div className="text-sm text-yellow-800">
          <div className="font-medium mb-1">测试说明</div>
          <ul className="list-disc list-inside space-y-1 text-yellow-700">
            <li>桌面端上传的图片会在服务器端压缩（限制 800 宽度）后再传给 17VIN</li>
            <li>如果识别失败，尝试上传更近、更清晰的 VIN 码照片</li>
            <li>VIN 码通常在挡风玻璃左下角，建议单独拍摄该区域</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
