"use client";

import { useEffect, useState } from "react";

interface Props {
  itemId: string;
  name: string;
  aliasName?: string | null;
}

/* 项目名显示（局部更新版）：
 * 监听"wo-item-update"事件，编辑项目弹窗保存后只更新本行名称，
 * 不整页刷新。props 变更（整页刷新后）会同步本地状态。 */
export default function ItemNameDisplay({ itemId, name, aliasName }: Props) {
  const [项目名, 设置项目名] = useState(name);
  const [别名, 设置别名] = useState(aliasName || null);

  // 整页刷新后 props 更新，同步本地状态
  useEffect(() => {
    设置项目名(name);
    设置别名(aliasName || null);
  }, [name, aliasName]);

  useEffect(() => {
    function handleUpdate(e: Event) {
      const detail = (e as CustomEvent).detail as {
        itemId: string;
        name?: string;
        alias_name?: string | null;
      };
      if (detail.itemId !== itemId) return;
      if (detail.name !== undefined) 设置项目名(detail.name);
      if (detail.alias_name !== undefined) 设置别名(detail.alias_name);
    }
    window.addEventListener("wo-item-update", handleUpdate as EventListener);
    return () => window.removeEventListener("wo-item-update", handleUpdate as EventListener);
  }, [itemId]);

  return (
    <>
      <span className="font-medium text-gray-900">{别名 || 项目名}</span>
      {别名 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">别名</span>
      )}
    </>
  );
}
