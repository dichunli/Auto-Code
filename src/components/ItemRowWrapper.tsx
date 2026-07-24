"use client";

import { useEffect, useState, type ReactNode } from "react";

interface Props {
  itemId: string;
  children: ReactNode;
}

/* 项目行包装：监听"wo-item-update"删除事件，项目被删除时立即隐藏整行，
 * 不等整页刷新。整行内容由服务端渲染传入，本组件只控制显示/隐藏。 */
export default function ItemRowWrapper({ itemId, children }: Props) {
  const [已删除, 设置已删除] = useState(false);

  useEffect(() => {
    function handleUpdate(e: Event) {
      const detail = (e as CustomEvent).detail as { itemId: string; deleted?: boolean };
      if (detail.itemId === itemId && detail.deleted) {
        设置已删除(true);
      }
    }
    window.addEventListener("wo-item-update", handleUpdate as EventListener);
    return () => window.removeEventListener("wo-item-update", handleUpdate as EventListener);
  }, [itemId]);

  if (已删除) return null;
  return <>{children}</>;
}
