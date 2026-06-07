"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PlateScanKeyboard from "./PlateScanKeyboard";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  maxLength?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  variant?: "full" | "simple";
  readOnly?: boolean;
}

/* 是否为移动设备 */
function isMobile() {
  if (typeof navigator === "undefined") return false;
  return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export default function LicensePlateKeyboard({
  value,
  onChange,
  placeholder = "请输入车牌号",
  className = "",
  maxLength = 8,
  onKeyDown,
  readOnly,
}: Props) {
  const displayValue = value.toUpperCase();

  /* PC 端使用普通输入框 */
  if (!isMobile()) {
    return (
      <input
        type="text"
        value={displayValue}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        maxLength={maxLength}
        className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${className}`}
      />
    );
  }

  /* 移动端使用截图样式键盘 */
  return (
    <MobilePlateKeyboard
      value={displayValue}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      maxLength={maxLength}
      readOnly={readOnly}
    />
  );
}

/* ========== 移动端车牌键盘（截图样式） ========== */
function MobilePlateKeyboard({
  value,
  onChange,
  placeholder,
  className,
  maxLength,
  readOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className: string;
  maxLength: number;
  readOnly?: boolean;
}) {
  const [show, setShow] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyboardRef = useRef<HTMLDivElement>(null);

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
      if (value.length >= maxLength) return;
      onChange(value + char);
    },
    [value, maxLength, onChange]
  );

  /* 删除 */
  const handleDelete = useCallback(() => {
    if (value.length === 0) return;
    onChange(value.slice(0, -1));
  }, [value, onChange]);

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
        inputMode="none"
        value={value}
        onClick={readOnly ? undefined : () => setShow(true)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${readOnly ? "bg-gray-50 cursor-not-allowed" : "cursor-pointer"} ${className}`}
      />

      {/* 遮罩 */}
      {show && (
        <div
          className="fixed inset-0 bg-black/20 z-40"
          onClick={() => setShow(false)}
        />
      )}

      {/* 底部键盘弹窗 */}
      {show && (
        <div
          ref={keyboardRef}
          className="fixed bottom-0 left-0 right-0 z-50 bg-gray-200 p-2 pb-8"
        >
          {/* 顶部栏 */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500">
              {value.length > 0 ? `${value.length} 位` : "请输入车牌号"}
            </span>
            <div className="flex items-center gap-2">
              {value.length > 0 && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="px-3 py-1 text-xs rounded bg-gray-300 text-gray-600 active:bg-gray-400"
                >
                  清空
                </button>
              )}
            </div>
          </div>

          {/* 当前输入预览 — 点击字符删除该位及之后 */}
          <div className="bg-white rounded-lg px-3 py-2 mb-2 text-center flex items-center justify-center gap-0.5 min-h-[40px]">
            {value.length > 0 ? (
              value.split("").map((char, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onChange(value.slice(0, idx))}
                  className="text-lg font-bold text-gray-900 tracking-wider px-0.5 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                >
                  {char}
                </button>
              ))
            ) : (
              <span className="text-lg font-bold text-gray-300 tracking-wider">—</span>
            )}
          </div>

          {/* 公共键盘面板 */}
          <PlateScanKeyboard
            onKeyPress={handleAppend}
            onDelete={handleDelete}
            onDone={handleDone}
          />
        </div>
      )}
    </div>
  );
}
