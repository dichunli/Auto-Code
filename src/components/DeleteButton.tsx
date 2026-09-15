"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "./ConfirmDialog";
import { toast } from "@/lib/globalToast";
import type { 操作结果 } from "@/types/domain";

/* 通用删除按钮（2026-09-15 诊断第5批：12 份 DeleteButton 合并）
 *
 * 各页面原本各持一份 DeleteButton.tsx，逻辑逐字雷同：
 *   确认 → 调删除 action → 失败 toast → 成功 router.refresh()
 * 差异只有三处：确认文案、删除动作、按钮样式——全部做成 props。
 * loading 态按 vehicles 版补齐（原来多数页面删除中可连点）。
 *
 * 用法：
 *   <DeleteButton id={row.id} 确认文案={`确定要删除品牌「${row.name}」吗？`} 删除动作={删除配件品牌} />
 */
interface DeleteButtonProps {
  id: string;
  /* 完整确认文案（保留各页面原有口径，调用方给） */
  确认文案: string;
  /* 删除动作（Server Action，返回统一 操作结果） */
  删除动作: (id: string) => Promise<操作结果>;
  /* 按钮样式类名（默认 text-xs 红色链接样式，保留多数页面原样） */
  按钮样式?: string;
}

export function DeleteButton({
  id,
  确认文案,
  删除动作,
  按钮样式 = "text-xs text-red-600 hover:text-red-700 disabled:opacity-50",
}: DeleteButtonProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function handleDelete() {
    if (!(await 请求确认(确认文案))) return;
    setDeleting(true);
    try {
      const result = await 删除动作(id);
      if (!result.success) {
        toast("删除失败: " + (result.error || "未知错误"), "error");
        return;
      }
      router.refresh();
    } catch (err: unknown) {
      toast("删除失败: " + (err instanceof Error ? err.message : "网络异常"), "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button onClick={handleDelete} disabled={deleting} className={按钮样式}>
        {deleting ? "删除中..." : "删除"}
      </button>
      {确认弹窗}
    </>
  );
}
