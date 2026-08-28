"use client";

import { 保存工单项目字段 } from "@/app/work-orders/actions";
import { useState, useCallback } from "react";

interface Props {
  itemId: string;
  opinion: string;
  /* 只读（保养单未进编辑模式 / 工单已锁定）：仅展示当前意见，不可点击修改 */
  disabled?: boolean;
}

export function CustomerOpinionToggle({ itemId, opinion, disabled = false }: Props) {
  const [updating, setUpdating] = useState(false);
  // 用本地状态保存当前客户意见，保存成功后只更新这个按钮，不刷新整页（性能优化）
  const [current, setCurrent] = useState(opinion || "pending");

  const updateOpinion = useCallback(async (newOpinion: string) => {
    if (updating) return;
    setUpdating(true);
    /* 写库走 Server Action */
    const result = await 保存工单项目字段({
      itemId,
      updates: { customer_opinion: newOpinion },
    });
    setUpdating(false);
    if (!result.success) {
      alert("更新失败: " + (result.error || "未知错误"));
      return;
    }
    // 写库成功后才更新本地显示，保证数据正确性
    setCurrent(newOpinion);
    /* 广播：列表页分栏卡片监听后刷新列表（阶段自动挪列）；
     * 详情页各徽章组件监听后重查自身状态（与派工/质检同一事件约定） */
    window.dispatchEvent(new CustomEvent("wo-item-update", { detail: { itemId } }));
  }, [itemId, updating]);

  function handleClick() {
    if (current === "agree") {
      updateOpinion("pending");
    } else {
      updateOpinion("agree");
    }
  }

  function handleDoubleClick() {
    updateOpinion("reject");
  }

  const label = current === "agree" ? "✓ 同意" : current === "reject" ? "✗ 否决" : "待确认";
  const style = current === "agree"
    ? "bg-green-50 text-green-700 border-green-200"
    : current === "reject"
    ? "bg-gray-100 text-gray-900 border-gray-300 font-bold"
    : "bg-red-50 text-red-700 border-red-200";

  return (
    <span className="flex items-center gap-1 text-[10px]">
      <span className="text-gray-500">客户意见：</span>
      <button
        type="button"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        disabled={updating || disabled}
        className={`px-2 py-0.5 rounded border font-medium ${disabled ? "cursor-default" : "cursor-pointer"} disabled:opacity-50 ${style}`}
      >
        {updating ? "..." : label}
      </button>
    </span>
  );
}
