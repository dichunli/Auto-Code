"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  maxLength?: number;
}

/* 是否为移动设备 */
function isMobile() {
  if (typeof navigator === "undefined") return false;
  return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/* 省份简称 — 黑排第一位 */
const PROVINCES = [
  "黑", "京", "津", "冀", "晋", "蒙", "辽", "吉", "沪", "苏",
  "浙", "皖", "闽", "赣", "鲁", "豫", "鄂", "湘", "粤", "桂",
  "琼", "渝", "川", "贵", "云", "藏", "陕", "甘", "青", "宁", "新",
];

/* 字母（不含 I、O，避免与1、0混淆） */
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"];

/* 数字 */
const NUMBERS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/* 新能源专用 D/F */
const ENERGY_CHARS = ["D", "F"];

export default function LicensePlateKeyboard({
  value,
  onChange,
  placeholder = "请输入车牌号",
  className = "",
  maxLength = 8,
}: Props) {
  const displayValue = value.toUpperCase();

  /* PC 端使用普通输入框 */
  if (!isMobile()) {
    return (
      <input
        type="text"
        value={displayValue}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder={placeholder}
        maxLength={maxLength}
        className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${className}`}
      />
    );
  }

  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<"province" | "letter" | "mixed" | "energy">("province");
  const inputRef = useRef<HTMLInputElement>(null);
  const keyboardRef = useRef<HTMLDivElement>(null);

  /* 根据当前输入长度决定键盘模式 */
  useEffect(() => {
    if (!show) return;
    const len = displayValue.length;
    if (len === 0) {
      setMode("province");
    } else if (len === 1) {
      setMode("letter");
    } else if (len === 2 && (displayValue[2 - 1] === "D" || displayValue[2 - 1] === "F")) {
      /* 第2位是D/F，可能是新能源，第3位也限制为D/F */
      setMode("energy");
    } else {
      setMode("mixed");
    }
  }, [displayValue, show]);

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

  /* 点击输入框打开键盘 */
  function handleInputClick() {
    setShow(true);
    const len = displayValue.length;
    if (len === 0) {
      setMode("province");
    } else if (len === 1) {
      setMode("letter");
    } else {
      setMode("mixed");
    }
  }

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
    setMode("province");
  }, [onChange]);

  /* 完成 */
  const handleDone = useCallback(() => {
    setShow(false);
  }, []);

  /* ========== 省份面板 ========== */
  function ProvincePanel() {
    return (
      <div className="grid grid-cols-8 gap-1.5">
        {PROVINCES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => handleAppend(p)}
            className={`h-10 rounded text-sm font-medium active:scale-95 transition-transform ${
              p === "黑"
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-800 border border-gray-200 active:bg-gray-100"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    );
  }

  /* ========== 字母面板 ========== */
  function LetterPanel() {
    return (
      <div className="grid grid-cols-6 gap-1.5">
        {LETTERS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => handleAppend(c)}
            className="h-10 rounded text-sm font-medium bg-white text-gray-800 border border-gray-200 active:bg-gray-100 active:scale-95 transition-transform"
          >
            {c}
          </button>
        ))}
      </div>
    );
  }

  /* ========== 混合面板（字母+数字） ========== */
  function MixedPanel() {
    return (
      <div className="space-y-1.5">
        {/* 数字行 */}
        <div className="grid grid-cols-10 gap-1.5">
          {NUMBERS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => handleAppend(c)}
              className="h-10 rounded text-sm font-medium bg-white text-gray-800 border border-gray-200 active:bg-gray-100 active:scale-95 transition-transform"
            >
              {c}
            </button>
          ))}
        </div>
        {/* 字母行 */}
        <div className="grid grid-cols-6 gap-1.5">
          {LETTERS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => handleAppend(c)}
              className="h-10 rounded text-sm font-medium bg-white text-gray-800 border border-gray-200 active:bg-gray-100 active:scale-95 transition-transform"
            >
              {c}
            </button>
          ))}
        </div>
      </div>
    );
  }

  /* ========== 新能源面板（D/F + 数字） ========== */
  function EnergyPanel() {
    return (
      <div className="space-y-1.5">
        <div className="grid grid-cols-6 gap-1.5">
          {ENERGY_CHARS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => handleAppend(c)}
              className="h-10 rounded text-sm font-medium bg-green-50 text-green-700 border border-green-200 active:bg-green-100 active:scale-95 transition-transform"
            >
              {c}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {NUMBERS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => handleAppend(c)}
              className="h-10 rounded text-sm font-medium bg-white text-gray-800 border border-gray-200 active:bg-gray-100 active:scale-95 transition-transform"
            >
              {c}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* 输入框 — 只读，点击打开键盘 */}
      <input
        ref={inputRef}
        type="text"
        readOnly
        inputMode="none"
        value={displayValue}
        onClick={handleInputClick}
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
              {displayValue.length === 0
                ? "请选择省份简称"
                : displayValue.length === 1
                ? "请选择字母"
                : "请继续输入"}
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
            <span className="text-lg font-bold text-gray-900 tracking-wider">
              {displayValue || "—"}
            </span>
            <span className="text-xs text-gray-400 ml-2">
              {displayValue.length > 0 ? `${displayValue.length} 位` : ""}
            </span>
          </div>

          {/* 键盘面板 */}
          <div className="touch-none select-none">
            {mode === "province" && <ProvincePanel />}
            {mode === "letter" && <LetterPanel />}
            {mode === "energy" && <EnergyPanel />}
            {mode === "mixed" && <MixedPanel />}
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
