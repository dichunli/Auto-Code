"use client";

import { useEffect, useState } from "react";

interface Props {
  reqId: string;
  初始姓名?: string | null;
  初始类型?: string | null;
}

/* 需求指派标签（领单/指派）：
 * 初始显示服务端数据；派单/领单/取消后监听"wo-requirement-assigned"事件
 * 立即更新标签，不整页刷新。 */
export default function AssignmentBadge({ reqId, 初始姓名, 初始类型 }: Props) {
  const [姓名, 设置姓名] = useState(初始姓名 || null);
  const [类型, 设置类型] = useState(初始类型 || null);

  // 整页刷新后 props 更新，同步本地状态
  useEffect(() => {
    设置姓名(初始姓名 || null);
    设置类型(初始类型 || null);
  }, [初始姓名, 初始类型]);

  useEffect(() => {
    function handle(e: Event) {
      const detail = (e as CustomEvent).detail as {
        requirementId: string;
        assignedTo: string | null;
        assignmentType: string | null;
        fullName: string;
      };
      if (detail.requirementId !== reqId) return;
      设置姓名(detail.assignedTo ? detail.fullName : null);
      设置类型(detail.assignedTo ? detail.assignmentType : null);
    }
    window.addEventListener("wo-requirement-assigned", handle as EventListener);
    return () => window.removeEventListener("wo-requirement-assigned", handle as EventListener);
  }, [reqId]);

  if (!姓名 || !类型) return null;

  if (类型 === "claimed") {
    return (
      <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 text-[10px]">
        领单: {姓名}
      </span>
    );
  }
  if (类型 === "assigned") {
    return (
      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px]">
        指派: {姓名}
      </span>
    );
  }
  return null;
}
