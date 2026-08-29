"use client";

import { useState, useRef, useEffect } from "react";
import { 保存工单项目字段 } from "@/app/work-orders/actions";

interface Props {
  itemId: string;
  businessType: string;
  disabled?: boolean;
}

const 选项 = [
  { value: "normal", label: "正常", className: "bg-gray-50 text-gray-600 border-gray-200" },
  { value: "insurance", label: "保险", className: "bg-purple-50 text-purple-700 border-purple-200" },
  { value: "rework", label: "返工", className: "bg-orange-50 text-orange-700 border-orange-200" },
  { value: "gift", label: "赠送", className: "bg-pink-50 text-pink-700 border-pink-200" },
] as const;

export function BusinessTypeToggle({ itemId, businessType, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  // 本地状态保存当前类型：切换成功后只更新本标签，不整页刷新
  const [当前类型, 设置当前类型] = useState(businessType);
  const [下拉位置, 设置下拉位置] = useState<{ top: number; left: number } | null>(null);
  const 按钮引用 = useRef<HTMLButtonElement>(null);

  // 整页刷新后 props 更新，同步本地状态
  useEffect(() => {
    设置当前类型(businessType);
  }, [businessType]);

  const 当前 = 选项.find((o) => o.value === 当前类型) || 选项[0];

  // 打开时计算下拉位置，跟随滚动
  useEffect(() => {
    if (!open) {
      设置下拉位置(null);
      return;
    }
    function 更新位置() {
      if (按钮引用.current) {
        const rect = 按钮引用.current.getBoundingClientRect();
        设置下拉位置({ top: rect.bottom + 4, left: rect.left });
      }
    }
    更新位置();
    window.addEventListener("scroll", 更新位置, true);
    window.addEventListener("resize", 更新位置);
    return () => {
      window.removeEventListener("scroll", 更新位置, true);
      window.removeEventListener("resize", 更新位置);
    };
  }, [open]);

  async function 切换(新类型: string) {
    if (新类型 === 当前类型) {
      setOpen(false);
      return;
    }
    setUpdating(true);
    /* 写库走 Server Action */
    const result = await 保存工单项目字段({
      itemId,
      updates: { business_type: 新类型 },
    });
    setUpdating(false);
    setOpen(false);
    if (!result.success) {
      alert("切换失败: " + (result.error || "未知错误"));
      return;
    }
    // 局部更新：只更新本标签，不整页刷新（业务类型不影响金额合计）
    设置当前类型(新类型);
  }

  return (
    <span className="relative inline-flex items-center gap-1 text-[10px]">
      <span className="text-gray-500">业务类型：</span>
      <button
        ref={按钮引用}
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={updating}
        className={`px-1.5 py-0.5 rounded border ${当前.className} ${
          disabled ? "cursor-default opacity-70" : "cursor-pointer hover:opacity-80"
        } disabled:opacity-50`}
        title={disabled ? undefined : "点击切换业务类型"}
      >
        {updating ? "..." : 当前.label}
      </button>

      {open && !disabled && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className="fixed z-30 bg-white rounded-lg border border-gray-200 shadow-lg py-1 w-24"
            style={{
              top: 下拉位置?.top ?? 0,
              left: Math.max(8, 下拉位置?.left ?? 0),
            }}
          >
            {选项.map((选项项) => (
              <button
                key={选项项.value}
                type="button"
                onClick={() => 切换(选项项.value)}
                disabled={updating}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50 ${
                  选项项.value === 当前类型 ? "font-bold" : ""
                }`}
              >
                <span className={`inline-block px-1.5 py-0.5 rounded border ${选项项.className}`}>
                  {选项项.label}
                </span>
                {选项项.value === 当前类型 && (
                  <span className="ml-1 text-blue-500">当前</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
