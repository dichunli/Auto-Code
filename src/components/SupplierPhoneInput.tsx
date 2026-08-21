"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "@/lib/useDebounce";

/* 供应商电话联想输入框（2026-08-20 需求6/7）：
   输入电话逐字实时筛选供应商（useDebounce 300ms），下拉展示 名称+电话；
   点选候选后通过 onSelect 带出整条供应商信息，父组件可同时回填电话和名称。
   已在 WaybillBatchForm（批量建运单）和 PendingReceiptList（单个建运单弹窗）共用。 */

export interface 供应商电话候选 {
  id: string;
  name: string;
  phone: string | null;
}

export function SupplierPhoneInput({
  value,
  onChange,
  onSelect,
  placeholder = "输入电话自动检索供应商",
  inputClassName = "",
}: {
  value: string;
  onChange: (电话: string) => void;
  onSelect: (供应商: 供应商电话候选) => void;
  placeholder?: string;
  inputClassName?: string;
}) {
  const supabase = createClient();
  const [候选列表, set候选列表] = useState<供应商电话候选[]>([]);
  const [展开, set展开] = useState(false);
  /* 键盘上下移动选择的高亮下标（2026-08-21 用户需求） */
  const [高亮下标, set高亮下标] = useState(-1);
  const 容器引用 = useRef<HTMLDivElement>(null);
  /* 请求序号守卫：防止慢响应覆盖用户更新的输入（StrictMode 双挂载竞态） */
  const 请求序号 = useRef(0);
  const debouncedValue = useDebounce(value, 300);

  /* 电话逐字联想：输 2 位就开始筛选；候选行显示 名称+电话 */
  useEffect(() => {
    const 电话 = debouncedValue.trim();
    if (电话.length < 2) {
      set候选列表([]);
      set展开(false);
      return;
    }
    const 序号 = ++请求序号.current;
    (async () => {
      const { data } = await supabase
        .from("suppliers")
        .select("id, name, phone")
        .ilike("phone", `%${电话}%`)
        .order("name")
        .limit(8);
      if (序号 !== 请求序号.current) return;
      const 列表 = (data || []) as 供应商电话候选[];
      set候选列表(列表);
      set高亮下标(-1);
      /* 已选中/已输全（某候选电话与输入完全一致）时不再展开下拉打扰 */
      const 完全命中 = 列表.some((s) => (s.phone || "").trim() === 电话);
      set展开(列表.length > 0 && !完全命中);
    })();
  }, [debouncedValue, supabase]);

  /* 点击外部关闭下拉 */
  useEffect(() => {
    if (!展开) return;
    function 处理点击(e: MouseEvent) {
      if (容器引用.current && !容器引用.current.contains(e.target as Node)) {
        set展开(false);
      }
    }
    document.addEventListener("mousedown", 处理点击);
    return () => document.removeEventListener("mousedown", 处理点击);
  }, [展开]);

  /* 键盘导航：↑↓ 移动高亮，Enter 选中，Esc 关闭 */
  function 处理按键(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!展开 || 候选列表.length === 0) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        set高亮下标((prev) => (prev + 1) % 候选列表.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        set高亮下标((prev) => (prev <= 0 ? 候选列表.length - 1 : prev - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (高亮下标 >= 0 && 高亮下标 < 候选列表.length) {
          onSelect(候选列表[高亮下标]);
          set展开(false);
          set高亮下标(-1);
        }
        break;
      case "Escape":
        e.preventDefault();
        set展开(false);
        break;
    }
  }

  return (
    <div ref={容器引用} className="relative">
      <input
        type="tel"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={处理按键}
        placeholder={placeholder}
        className={`w-full rounded-lg border border-gray-300 px-3 py-2 text-sm ${inputClassName}`}
      />
      {展开 && (
        <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {候选列表.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onSelect(s);
                set展开(false);
                set高亮下标(-1);
              }}
              onMouseEnter={() => set高亮下标(idx)}
              className={`w-full text-left px-3 py-2.5 text-sm border-b border-gray-100 last:border-0 ${
                idx === 高亮下标 ? "bg-blue-100" : "hover:bg-blue-50"
              }`}
            >
              <span className="font-medium text-gray-900">{s.name}</span>
              <span className="ml-2 text-xs text-gray-500">{s.phone || "-"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
