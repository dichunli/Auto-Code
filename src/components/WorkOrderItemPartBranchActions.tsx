"use client";

import { useState } from "react";
import { 标记本地结构编辑 } from "@/lib/localEditSignal";
import { useConfirm } from "./ConfirmDialog";
import { 删除配件分支, 添加配件分支 } from "@/app/work-orders/parts-actions";

interface Props {
  partId: string;
  itemId: string;
  canDelete: boolean;
}

export default function WorkOrderItemPartBranchActions({ partId, itemId, canDelete }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function handleDelete() {
    if (!canDelete) {
      alert("至少需要保留一个配件分支");
      return;
    }
    if (!(await 请求确认("确定删除此配件分支吗？"))) return;
    setDeleting(true);
    // 写库收编为 Server Action（RPC delete_part_branch）：同目录至少保留一个、
    // 已采购/已到货拒删、删选中分支自动递补新选中
    const 结果 = await 删除配件分支(partId);
    setDeleting(false);
    if (!结果.success) {
      alert("删除失败: " + (结果.error || "未知错误"));
      return;
    }
    标记本地结构编辑(itemId);
    /* 局部更新：广播删除事件（合计自动减）+ 重查该项目配件（分支立即消失），不整页刷新 */
    window.dispatchEvent(
      new CustomEvent("wo-part-update", {
        detail: { itemId, partId, deleted: true },
      })
    );
    window.dispatchEvent(
      new CustomEvent("wo-parts-reload", { detail: { itemId } })
    );
  }

  async function handleAdd() {
    setAdding(true);
    // 写库收编为 Server Action（RPC add_part_branch）：服务端克隆源行的目录归属、
    // 名称、单位、数量（数量整组共用，NULL 则留空红底提醒补填），新分支固定不选中，
    // 无需前端先查源行再拼 insert
    const 结果 = await 添加配件分支(partId);
    setAdding(false);
    if (!结果.success) {
      alert("添加失败: " + (结果.error || "未知错误"));
      return;
    }
    标记本地结构编辑(itemId);
    /* 局部更新：重查该项目配件（新分支立即出现），不整页刷新。
     * 新分支默认未选中，不计入合计，无需广播合计事件 */
    window.dispatchEvent(
      new CustomEvent("wo-parts-reload", { detail: { itemId } })
    );
  }

  return (
    <div className="flex items-center gap-1 ml-2">
      <button
        type="button"
        onClick={handleAdd}
        disabled={adding}
        className="text-[10px] text-blue-600 hover:text-blue-700 disabled:opacity-50 px-1"
        title="添加同配件新分支"
      >
        {adding ? "..." : "+"}
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting || !canDelete}
        className={`text-[10px] px-1 disabled:opacity-50 ${
          canDelete ? "text-red-600 hover:text-red-700" : "text-gray-300 cursor-not-allowed"
        }`}
        title={canDelete ? "删除此分支" : "至少保留一个分支"}
      >
        {deleting ? "..." : "删除"}
      </button>
      {确认弹窗}
    </div>
  );
}
