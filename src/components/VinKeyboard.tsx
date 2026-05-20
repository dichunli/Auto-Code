"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/* 是否为移动设备 */
function isMobile() {
  if (typeof navigator === "undefined") return false;
  return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/* VIN 可用字符（不含 I、O、Q） */
const VIN_NUMBERS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const VIN_LETTERS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "J", "K",
  "L", "M", "N", "P", "R", "S", "T", "U", "V", "W",
  "X", "Y", "Z",
];

export default function VinKeyboard({
  value,
  onChange,
  placeholder = "请输入VIN码",
  className = "",
}: Props) {
  const [show, setShow] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyboardRef = useRef<HTMLDivElement>(null);

  const displayValue = value.toUpperCase();
  const maxLength = 17;

  /* PC 端使用普通输入框 */
  if (!isMobile()) {
    return (
      <input
        type="text"
        value={displayValue}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder={placeholder}
        maxLength={17}
        className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${className}`}
      />
    );
  }

  /* 点击外部关闭键盘 */
  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as HTMLElement;
      if (
        keyboardRef.current &&
        !keyboardRef.current.contains(target) &&
        inputRef.current &&
        !inputRef.current.contains(target)
      ) {
        setShow(false);
      }
    }
    if (show) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("touchstart", handleClickOutside);
      };
    }
  }, [show]);

  /* 追加字符 */
  const handleAppend = useCallback(
    (char: string) => {
      if (displayValue.length >= maxLength) return;
      const next = displayValue + char;
      onChange(next);
    },
    [displayValue, maxLength, onChange]
  );

  /* 删除 */
  const handleDelete = useCallback(() => {
    if (displayValue.length === 0) return;
    const next = displayValue.slice(0, -1);
    onChange(next);
  }, [displayValue, onChange]);

  /* 清空 */
  const handleClear = useCallback(() => {
    onChange("");
  }, [onChange]);

  /* 完成 */
  const handleDone = useCallback(() => {
    setShow(false);
  }, []);

  return (
    <div className="relative">
      {/* 输入框 — 只读，点击打开键盘 */}
      <input
        ref={inputRef}
        type="text"
        readOnly
        value={displayValue}
        onClick={() => setShow(true)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer ${className}`}
      />

      {/* 键盘遮罩 */}
      {show && <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setShow(false)} />}

      {/* 底部键盘 */}
      {show && (
        <div
          ref={keyboardRef}
          className="fixed bottom-0 left-0 right-0 z-50 bg-gray-100 border-t border-gray-200 p-3 pb-safe"
        >
          {/* 顶部栏 */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500">
              VIN码 {displayValue.length}/17 位
            </span>
            <div className="flex items-center gap-2">
              {displayValue.length > 0 && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="px-3 py-1 text-xs rounded bg-gray-200 text-gray-600 active:bg-gray-300"
                >
                  清空
                </button>
              )}
              <button
                type="button"
                onClick={handleDone}
                className="px-3 py-1 text-xs rounded bg-blue-600 text-white active:bg-blue-700"
              >
                完成
              </button>
            </div>
          </div>

          {/* 当前输入预览 */}
          <div className="bg-white rounded-lg px-3 py-2 mb-2 text-center">
            <span className="text-lg font-bold text-gray-900 tracking-wider font-mono">
              {displayValue || "—"}
            </span>
            {displayValue.length === maxLength && (
              <span className="text-xs text-green-600 ml-2">已输满</span>
            )}
          </div>

          {/* 字符面板 */}
          <div className="touch-none select-none space-y-1.5">
            {/* 数字行 */}
            <div className="grid grid-cols-10 gap-1.5">
              {VIN_NUMBERS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleAppend(c)}
                  disabled={displayValue.length >= maxLength}
                  className="h-10 rounded text-sm font-medium bg-white text-gray-800 border border-gray-200 active:bg-gray-100 active:scale-95 transition-transform disabled:opacity-30 disabled:active:scale-100"
                >
                  {c}
                </button>
              ))}
            </div>
            {/* 字母行 */}
            <div className="grid grid-cols-7 gap-1.5">
              {VIN_LETTERS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleAppend(c)}
                  disabled={displayValue.length >= maxLength}
                  className="h-10 rounded text-sm font-medium bg-white text-gray-800 border border-gray-200 active:bg-gray-100 active:scale-95 transition-transform disabled:opacity-30 disabled:active:scale-100"
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* 底部操作栏 */}
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={displayValue.length === 0}
              className="flex-1 h-10 rounded text-sm font-medium bg-amber-50 text-amber-700 border border-amber-200 active:bg-amber-100 disabled:opacity-40 disabled:active:scale-100 active:scale-95 transition-transform flex items-center justify-center gap-1"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
                <line x1="10" y1="9" x2="16" y2="15" />
                <line x1="16" y1="9" x2="10" y2="15" />
              </svg>
              退格
            </button>
            <button
              type="button"
              onClick={handleDone}
              className="flex-[2] h-10 rounded text-sm font-medium bg-blue-600 text-white active:bg-blue-700 active:scale-95 transition-transform"
            >
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
