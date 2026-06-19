"use client";

import { useState, ReactNode } from "react";
import LicensePlateCameraModal from "./LicensePlateCameraModal";

function 是移动端(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mobile|Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
}

interface Props {
  onRecognize: (plateNumber: string) => void;
  className?: string;
  buttonText?: ReactNode;
}

export default function LicensePlateOcrButton({
  onRecognize,
  className = "",
  buttonText = "拍照识别",
}: Props) {
  const [弹窗打开, set弹窗打开] = useState(false);

  /* 桌面端没有相机，只能上传/查看，不显示拍照识别按钮 */
  if (!是移动端()) {
    return null;
  }

  const 按钮类名 =
    className ||
    "px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 whitespace-nowrap shrink-0 inline-block cursor-pointer select-none";

  return (
    <>
      <button
        type="button"
        onClick={() => set弹窗打开(true)}
        className={按钮类名}
      >
        {buttonText}
      </button>

      <LicensePlateCameraModal
        open={弹窗打开}
        onClose={() => set弹窗打开(false)}
        onRecognize={(plateNumber) => {
          onRecognize(plateNumber);
          set弹窗打开(false);
        }}
      />
    </>
  );
}
