"use client";

import { useState } from "react";

interface Props {
  onKeyPress: (key: string) => void;
  onDelete: () => void;
  onDone: () => void;
}

const 数字行 = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const 字母行一 = ["Q", "W", "E", "R", "T", "Y", "U", "P"];
const 字母行二 = ["A", "S", "D", "F", "G", "H", "J", "K", "L"];
const 字母行三 = ["Z", "X", "C", "V", "B", "N", "M"];
const 省份列表 = [
  "黑", "京", "津", "冀", "晋", "蒙", "辽", "吉", "沪", "苏",
  "浙", "皖", "闽", "赣", "鲁", "豫", "鄂", "湘", "粤", "桂",
  "琼", "渝", "川", "贵", "云", "藏", "陕", "甘", "青", "宁", "新",
];

export default function PlateScanKeyboard({ onKeyPress, onDelete, onDone }: Props) {
  const [显示省份, set显示省份] = useState(false);

  const 普通按钮样式 =
    "h-11 rounded-lg bg-white text-gray-900 text-base font-medium active:bg-gray-100 active:scale-95 transition-transform shadow-sm flex items-center justify-center select-none";
  const 特殊按钮样式 =
    "h-11 rounded-lg bg-gray-300 text-gray-700 text-sm font-medium active:bg-gray-400 active:scale-95 transition-transform shadow-sm flex items-center justify-center select-none";

  /* ========== 省份面板 ========== */
  if (显示省份) {
    return (
      <div className="bg-gray-200 p-2 pb-8">
        <div className="flex justify-between items-center mb-2">
          <button
            type="button"
            onClick={() => set显示省份(false)}
            className="px-3 py-1 text-sm text-gray-600 active:text-gray-800"
          >
            返回
          </button>
          <button
            type="button"
            onClick={onDone}
            className="px-3 py-1 text-sm text-blue-600 font-medium active:text-blue-800"
          >
            完成
          </button>
        </div>
        <div className="grid grid-cols-8 gap-1.5">
          {省份列表.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                onKeyPress(p);
                set显示省份(false);
              }}
              className={`h-11 rounded-lg text-base font-medium active:scale-95 transition-transform shadow-sm flex items-center justify-center select-none ${
                p === "黑"
                  ? "bg-blue-600 text-white active:bg-blue-700"
                  : "bg-white text-gray-900 active:bg-gray-100"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    );
  }

  /* ========== 字母数字面板 ========== */
  return (
    <div className="bg-gray-200 p-2 pb-8">
      <div className="flex justify-end mb-2">
        <button
          type="button"
          onClick={onDone}
          className="px-3 py-1 text-base text-blue-600 font-medium active:text-blue-800"
        >
          完成
        </button>
      </div>

      <div className="space-y-1.5">
        {/* 数字行 */}
        <div className="grid grid-cols-10 gap-1">
          {数字行.map((n) => (
            <button key={n} type="button" onClick={() => onKeyPress(n)} className={普通按钮样式}>
              {n}
            </button>
          ))}
        </div>

        {/* QWERTY - 8个字母，左右各空1格 */}
        <div className="grid grid-cols-10 gap-1">
          <div />
          {字母行一.map((c) => (
            <button key={c} type="button" onClick={() => onKeyPress(c)} className={普通按钮样式}>
              {c}
            </button>
          ))}
          <div />
        </div>

        {/* ASDFGHJKL - 9个字母 + 1空 */}
        <div className="grid grid-cols-10 gap-1">
          {字母行二.map((c) => (
            <button key={c} type="button" onClick={() => onKeyPress(c)} className={普通按钮样式}>
              {c}
            </button>
          ))}
          <div />
        </div>

        {/* 省份 + ZXCVBNM + 退格 = 1+7+1=9，再加1空=10 */}
        <div className="grid grid-cols-10 gap-1">
          <button
            type="button"
            onClick={() => set显示省份(true)}
            className={特殊按钮样式}
          >
            省份
          </button>
          {字母行三.map((c) => (
            <button key={c} type="button" onClick={() => onKeyPress(c)} className={普通按钮样式}>
              {c}
            </button>
          ))}
          <button type="button" onClick={onDelete} className={特殊按钮样式}>
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
              <line x1="10" y1="9" x2="16" y2="15" />
              <line x1="16" y1="9" x2="10" y2="15" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
