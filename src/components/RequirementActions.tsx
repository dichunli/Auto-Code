"use client";

import { useState } from "react";
import { 指派需求, 领取需求, 取消需求指派 } from "@/app/work-orders/actions";

interface Requirement {
  id: string;
  /* 可选：新建需求尚未派工时此字段不存在 */
  assigned_to?: string | null;
}

interface Profile {
  id: string;
  /* 可空：数据源 员工档案.full_name 本身可选 */
  full_name?: string | null;
}

export default function RequirementActions({
  requirement,
  profiles,
}: {
  requirement: Requirement;
  profiles: Profile[];
}) {
  // 本地保存当前指派人：保存成功后只更新按钮和标签，不整页刷新
  const [当前指派, 设置当前指派] = useState<string | null>(requirement.assigned_to ?? null);

  /* 写库走 Server Action：派单/领单/取消指派，指派人身份由服务端校验 */
  async function handleAssign(assignedToId: string, type: "assigned" | "claimed") {
    let 生效指派人 = assignedToId || null;
    let result: { success: boolean; error?: string };
    if (!assignedToId) {
      result = await 取消需求指派(requirement.id);
    } else if (type === "claimed") {
      /* 领单：领单人=当前登录用户，由服务端确定并返回 */
      const 领单结果 = await 领取需求(requirement.id);
      result = 领单结果;
      生效指派人 = 领单结果.assigneeId || null;
    } else {
      result = await 指派需求({ requirementId: requirement.id, assigneeId: assignedToId });
    }

    if (!result.success) {
      alert("操作失败: " + (result.error || "未知错误"));
      return;
    }

    /* 局部更新：更新按钮状态 + 广播指派事件（标题栏标签监听后更新），不整页刷新 */
    设置当前指派(生效指派人);
    const 指派人 = profiles.find((p) => p.id === 生效指派人);
    window.dispatchEvent(
      new CustomEvent("wo-requirement-assigned", {
        detail: {
          requirementId: requirement.id,
          assignedTo: 生效指派人,
          assignmentType: 生效指派人 ? type : null,
          fullName: 指派人?.full_name || "",
        },
      })
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {!当前指派 && (
        <>
          <select
            className="text-xs px-1 py-0.5 border border-gray-300 rounded"
            defaultValue=""
            onChange={(e) => {
              const val = e.target.value;
              if (val) handleAssign(val, "assigned");
              e.target.value = "";
            }}
          >
            <option value="">派单...</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
          <button
            onClick={() => handleAssign("self", "claimed")}
            className="text-xs px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100"
          >
            领单
          </button>
        </>
      )}
      {当前指派 && (
        <button
          onClick={() => handleAssign("", "assigned")}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          取消指派
        </button>
      )}
    </div>
  );
}
