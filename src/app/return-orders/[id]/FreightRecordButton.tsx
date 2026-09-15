"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { 记录退货运费入应付 } from "../actions";
import { toast } from "@/lib/globalToast";

/* 退货运费记入物流应付按钮（2026-09-15 批次5）
 * 仅当 我方承担运费 + 有运费金额 + 未入账 时由父页面渲染 */
export function FreightRecordButton({
  returnOrderId,
  amount,
  companyName,
}: {
  returnOrderId: string;
  amount: number;
  companyName: string;
}) {
  const router = useRouter();
  const { 请求确认, 确认弹窗 } = useConfirm();
  const [saving, setSaving] = useState(false);

  async function 入账() {
    if (
      !(await 请求确认({
        title: "退货运费入账",
        message: `把退货运费 ¥${amount.toFixed(2)} 记入「${companyName}」的应付运费吗？\n\n入账后物流页该公司的未结运费会增加这笔，月底和运费一起对账。`,
        confirmText: "确定入账",
        danger: false,
      }))
    )
      return;
    setSaving(true);
    try {
      const res = await 记录退货运费入应付(returnOrderId);
      setSaving(false);
      if (!res.success) {
        toast("入账失败: " + (res.error || "未知错误"), "error");
        return;
      }
      toast("已记入物流应付", "success");
      router.refresh();
    } catch (err: unknown) {
      setSaving(false);
      toast("入账失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={入账}
        disabled={saving}
        className="ml-2 px-2 py-0.5 text-xs text-white bg-orange-500 rounded hover:bg-orange-600 disabled:opacity-50"
      >
        {saving ? "入账中..." : "记入物流应付"}
      </button>
      {确认弹窗}
    </>
  );
}
