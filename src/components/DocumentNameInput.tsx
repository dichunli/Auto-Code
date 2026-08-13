"use client";

import { useState } from "react";
import { 更新配件单据名称 } from "@/app/procurement/actions";

interface Props {
  /* 二选一:工单配件行(待询价/待采购/退货等)或采购明细(待收货/待入库/已入库) */
  工单配件行id?: string | null;
  采购明细id?: string | null;
  初始值: string;
  保存后?: () => void;
  样式类名?: string;
}

/* 单据名称输入框(失焦即存):采购管理各 Tab 共用。
   非受控 + key=当前值:外部刷新数据后输入框自动重置为新值;
   服务端会联动同步另一处存放点(工单配件行 ⇄ 采购明细快照),各 Tab 保持一致 */
export function DocumentNameInput({ 工单配件行id, 采购明细id, 初始值, 保存后, 样式类名 }: Props) {
  const [保存中, set保存中] = useState(false);

  async function 失焦保存(e: React.FocusEvent<HTMLInputElement>) {
    const 新值 = e.target.value.trim();
    if (新值 === (初始值 || "").trim()) return; /* 没改不保存 */
    set保存中(true);
    try {
      const res = await 更新配件单据名称({
        工单配件行id: 工单配件行id || null,
        采购明细id: 采购明细id || null,
        单据名称: 新值,
      });
      if (!res.success) {
        alert("单据名称保存失败: " + (res.error || "未知错误"));
        e.target.value = 初始值 || ""; /* 失败回滚显示 */
        return;
      }
      保存后?.();
    } catch (err: unknown) {
      alert("单据名称保存失败: " + (err instanceof Error ? err.message : String(err)));
      e.target.value = 初始值 || "";
    } finally {
      set保存中(false);
    }
  }

  return (
    <input
      key={初始值 || ""}
      type="text"
      defaultValue={初始值 || ""}
      disabled={保存中}
      onBlur={失焦保存}
      placeholder="单据名称（选填）"
      className={
        样式类名 ||
        "w-28 px-2 py-1 text-xs rounded border border-gray-200 bg-white placeholder:text-gray-400 hover:border-blue-400 focus:border-blue-500 focus:outline-none disabled:opacity-50"
      }
    />
  );
}
