"use client";

import { useEffect, useState, type ReactNode } from "react";

interface Props {
  reqId: string;
  children: ReactNode;
}

/* 需求卡片包装：监听"wo-requirement-deleted"事件，需求被删除时立即隐藏卡片，
 * 不等整页刷新（与删除项目的 ItemRowWrapper 同一模式）。 */
export default function RequirementRowWrapper({ reqId, children }: Props) {
  const [已删除, 设置已删除] = useState(false);

  useEffect(() => {
    function handleDelete(e: Event) {
      const detail = (e as CustomEvent).detail as { requirementId: string };
      if (detail.requirementId === reqId) {
        设置已删除(true);
      }
    }
    window.addEventListener("wo-requirement-deleted", handleDelete as EventListener);
    return () => window.removeEventListener("wo-requirement-deleted", handleDelete as EventListener);
  }, [reqId]);

  if (已删除) return null;
  return <>{children}</>;
}
