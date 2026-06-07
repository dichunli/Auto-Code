"use client";

import { useState, useCallback } from "react";
import PlateScanKeyboard from "./PlateScanKeyboard";

interface Props {
  initialPlate: string;
  previewImage: string | null;
  onConfirm: (plate: string) => void;
  onRetake: () => void;
  onCancel: () => void;
}

const 最大长度 = 8;

export default function PlateScanEditor({
  initialPlate,
  previewImage,
  onConfirm,
  onRetake,
  onCancel,
}: Props) {
  const [plate, setPlate] = useState(initialPlate.toUpperCase());
  const [selectedIndex, setSelectedIndex] = useState<number>(
    initialPlate.length > 0 ? 0 : -1
  );

  /* 判断当前是否为新能源车牌 */
  const 是新能源 = plate.length === 8 && /[DF]/.test(plate[2]);

  /* 键盘输入：替换选中位或追加 */
  const handleKeyPress = useCallback(
    (key: string) => {
      setPlate((prev) => {
        if (selectedIndex >= 0 && selectedIndex < prev.length) {
          /* 替换选中位 */
          const arr = prev.split("");
          arr[selectedIndex] = key;
          const next = arr.join("");
          /* 自动移动到下一位 */
          if (selectedIndex < Math.min(next.length, 最大长度 - 1)) {
            setSelectedIndex(selectedIndex + 1);
          }
          return next;
        }
        if (prev.length < 最大长度) {
          /* 追加 */
          const next = prev + key;
          setSelectedIndex(next.length - 1);
          return next;
        }
        return prev;
      });
    },
    [selectedIndex]
  );

  /* 退格：删除当前位或最后一位 */
  const handleDelete = useCallback(() => {
    setPlate((prev) => {
      if (prev.length === 0) return prev;
      if (selectedIndex >= 0 && selectedIndex < prev.length) {
        /* 删除当前位 */
        const arr = prev.split("");
        arr.splice(selectedIndex, 1);
        const next = arr.join("");
        if (selectedIndex > 0) {
          setSelectedIndex(selectedIndex - 1);
        } else if (next.length === 0) {
          setSelectedIndex(-1);
        }
        return next;
      }
      /* 未选中：删除最后一位 */
      const next = prev.slice(0, -1);
      setSelectedIndex(next.length > 0 ? next.length - 1 : -1);
      return next;
    });
  }, [selectedIndex]);

  /* 新能源切换 */
  const toggleEnergy = useCallback(() => {
    setPlate((prev) => {
      if (prev.length >= 3 && /[DF]/.test(prev[2])) {
        /* 新能源转普通：移除第3位（D/F） */
        return prev.slice(0, 2) + prev.slice(3);
      }
      if (prev.length >= 2) {
        /* 普通转新能源：在第2位后插入 D */
        return prev.slice(0, 2) + "D" + prev.slice(2);
      }
      return prev;
    });
  }, []);

  /* 渲染单个字符方块 */
  function 字符方块(char: string, index: number) {
    const 已选中 = selectedIndex === index;
    return (
      <button
        key={index}
        type="button"
        onClick={() => setSelectedIndex(index)}
        className={`w-10 h-12 rounded-lg text-xl font-bold flex items-center justify-center select-none transition-all ${
          已选中
            ? "bg-white border-2 border-blue-500 text-gray-900 shadow-md scale-105"
            : "bg-gray-100 border border-gray-200 text-gray-900"
        }`}
      >
        {char}
      </button>
    );
  }

  return (
    <div className="absolute inset-0 z-20 bg-white flex flex-col">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 h-12 bg-white border-b border-gray-200 shrink-0">
        <span className="text-base font-medium text-gray-900">识别结果</span>
        <button
          type="button"
          onClick={onCancel}
          className="w-8 h-8 flex items-center justify-center rounded-full active:bg-gray-100"
        >
          <svg
            className="w-5 h-5 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* 可滚动内容区 */}
      <div className="flex-1 overflow-y-auto">
        {/* 图片预览 */}
        {previewImage && (
          <div className="w-full h-48 bg-black flex items-center justify-center">
            <img
              src={previewImage}
              alt="预览"
              className="max-w-full max-h-full object-contain"
            />
          </div>
        )}

        <div className="p-4 space-y-5">
          {/* 字符方块区域 */}
          <div>
            <div className="text-xs text-gray-500 mb-3">
              识别结果，点击可手动修改
            </div>
            <div className="flex items-center gap-1.5 justify-center flex-wrap">
              {plate.split("").map((char, idx) => 字符方块(char, idx))}

              {/* 空位占位（可点击追加） */}
              {plate.length < 最大长度 && (
                <button
                  type="button"
                  onClick={() => setSelectedIndex(plate.length)}
                  className="w-10 h-12 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-300 text-xl"
                >
                  +
                </button>
              )}

              {/* 填充剩余空位占位（保持对齐美观） */}
              {plate.length < 最大长度 - 1 &&
                Array.from({ length: 最大长度 - 1 - plate.length }).map((_, i) => (
                  <div key={`empty-${i}`} className="w-10 h-12" />
                ))}

              {/* 新能源切换按钮 */}
              <button
                type="button"
                onClick={toggleEnergy}
                className={`w-8 h-12 rounded-lg text-[10px] font-medium flex flex-col items-center justify-center select-none transition-all leading-tight ${
                  是新能源
                    ? "bg-green-50 border border-green-300 text-green-600"
                    : "bg-gray-50 border border-gray-200 text-gray-400"
                }`}
              >
                <span>新</span>
                <span>能源</span>
              </button>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-3 justify-center">
            <button
              type="button"
              onClick={onRetake}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-gray-100 text-gray-700 text-sm font-medium active:bg-gray-200"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              重新识别
            </button>
            <button
              type="button"
              onClick={() => onConfirm(plate)}
              disabled={plate.length < 7}
              className="px-6 py-2.5 rounded-full bg-green-600 text-white text-sm font-medium active:bg-green-700 disabled:opacity-40"
            >
              确认使用
            </button>
          </div>
        </div>
      </div>

      {/* 底部键盘 */}
      <div className="shrink-0">
        <PlateScanKeyboard
          onKeyPress={handleKeyPress}
          onDelete={handleDelete}
          onDone={() => onConfirm(plate)}
        />
      </div>
    </div>
  );
}
