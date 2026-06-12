"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BarcodeScanModal from "@/components/BarcodeScanModal";

export default function ToolScanButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function handleScan(code: string) {
    const trimmed = code.trim();
    if (!trimmed.startsWith("tool:")) {
      alert("未识别为工具二维码，请扫描正确的工具标签");
      return;
    }
    const toolId = trimmed.slice(5);
    if (!toolId) {
      alert("二维码内容无效");
      return;
    }
    router.push(`/tools/borrow-scan?id=${encodeURIComponent(toolId)}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        扫码借还
      </button>
      <BarcodeScanModal open={open} onClose={() => setOpen(false)} onScan={handleScan} />
    </>
  );
}
