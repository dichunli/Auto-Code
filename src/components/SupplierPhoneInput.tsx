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
  const 容器引用 = useRef<HTMLDivElement>(null);
  /* 请求序号守卫：防止慢响应覆盖用户更新的输入（StrictMode 双挂载竞态） */
  const 请求序号 = useRef(0);
  const debouncedValue = useDebounce(value, 300);

  /* 电话逐字联想：至少输 3 位才开始检索，避免单字符全库模糊扫 */
  useEffect(() => {
    const 电话 = debouncedValue.trim();
    if (电话.length < 3) {
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

  return (
    <div ref={容器引用} className="relative">
      <input
        type="tel"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border border-gray-300 px-3 py-2 text-sm ${inputClassName}`}
      />
      {展开 && (
        <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {候选列表.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onSelect(s);
                set展开(false);
              }}
              className="w-full text-left px-3 py-2.5 text-sm border-b border-gray-100 last:border-0 hover:bg-blue-50"
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
