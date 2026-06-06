"use client";

import { useState } from "react";
import VinCameraModal from "@/components/VinCameraModal";
import BarcodeScanModal from "@/components/BarcodeScanModal";
import LicensePlateCameraModal from "@/components/LicensePlateCameraModal";
import { VinDecodeResult } from "@/components/VinDecodeInput";

/* ==================== APP 测试功能页 ==================== */

export default function MobileTestPage() {
  const [vinModalOpen, setVinModalOpen] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [plateModalOpen, setPlateModalOpen] = useState(false);
  const [testResults, setTestResults] = useState<string[]>([]);

  /* 添加测试结果 */
  const addResult = (type: string, content: string) => {
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setTestResults((prev) => [`[${time}] ${type}: ${content}`, ...prev].slice(0, 20));
  };

  /* VIN识别结果 */
  const handleVinRecognize = (vin: string, result: VinDecodeResult | null) => {
    if (result) {
      addResult("VIN识别", `${vin} | ${result.brand} ${result.series} ${result.model} ${result.year}年`);
    } else {
      addResult("VIN识别", `${vin} | 无车型信息`);
    }
  };

  /* 扫码结果 */
  const handleScan = (barcode: string) => {
    addResult("扫码", barcode);
  };

  /* 车牌识别结果 */
  const handlePlateRecognize = (plate: string) => {
    addResult("车牌识别", plate);
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 顶部栏 */}
      <div className="bg-blue-600 text-white px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold">功能测试</h1>
      </div>

      {/* 测试按钮区 */}
      <div className="p-4 space-y-3">
        {/* VIN识别 */}
        <button
          type="button"
          onClick={() => setVinModalOpen(true)}
          className="w-full flex items-center gap-3 bg-white rounded-xl p-4 shadow-sm active:bg-gray-50 transition-colors"
        >
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
            <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div className="text-left">
            <div className="font-medium text-gray-900">VIN 识别</div>
            <div className="text-xs text-gray-500">拍照识别车辆VIN码</div>
          </div>
          <svg className="w-5 h-5 text-gray-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* 车牌识别 */}
        <button
          type="button"
          onClick={() => setPlateModalOpen(true)}
          className="w-full flex items-center gap-3 bg-white rounded-xl p-4 shadow-sm active:bg-gray-50 transition-colors"
        >
          <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
            <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div className="text-left">
            <div className="font-medium text-gray-900">车牌识别</div>
            <div className="text-xs text-gray-500">拍照识别车牌号（有网云端/没网本地）</div>
          </div>
          <svg className="w-5 h-5 text-gray-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* 扫码 */}
        <button
          type="button"
          onClick={() => setScanModalOpen(true)}
          className="w-full flex items-center gap-3 bg-white rounded-xl p-4 shadow-sm active:bg-gray-50 transition-colors"
        >
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center shrink-0">
            <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
          </div>
          <div className="text-left">
            <div className="font-medium text-gray-900">扫码</div>
            <div className="text-xs text-gray-500">二维码 / 条形码</div>
          </div>
          <svg className="w-5 h-5 text-gray-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* 清空结果 */}
        {testResults.length > 0 && (
          <button
            type="button"
            onClick={() => setTestResults([])}
            className="w-full text-center text-sm text-gray-500 py-2 active:text-gray-700"
          >
            清空测试结果
          </button>
        )}
      </div>

      {/* 测试结果 */}
      {testResults.length > 0 && (
        <div className="px-4 pb-6">
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 border-b text-xs font-medium text-gray-600">
              测试结果（最近 {testResults.length} 条）
            </div>
            <div className="divide-y">
              {testResults.map((item, index) => (
                <div key={index} className="px-4 py-2.5 text-sm text-gray-700 break-all">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 空状态提示 */}
      {testResults.length === 0 && (
        <div className="px-4 pb-6 text-center text-gray-400 text-sm">
          点击上方按钮进行测试，结果将显示在这里
        </div>
      )}

      {/* VIN识别弹窗 */}
      <VinCameraModal
        open={vinModalOpen}
        onClose={() => setVinModalOpen(false)}
        onRecognize={handleVinRecognize}
      />

      {/* 扫码弹窗 */}
      <BarcodeScanModal
        open={scanModalOpen}
        onClose={() => setScanModalOpen(false)}
        onScan={handleScan}
      />

      {/* 车牌识别弹窗 */}
      <LicensePlateCameraModal
        open={plateModalOpen}
        onClose={() => setPlateModalOpen(false)}
        onRecognize={handlePlateRecognize}
      />
    </div>
  );
}
