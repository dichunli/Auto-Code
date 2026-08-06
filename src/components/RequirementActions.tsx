"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

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
  const supabase = createClient();
  // 本地保存当前指派人：保存成功后只更新按钮和标签，不整页刷新
  const [当前指派, 设置当前指派] = useState<string | null>(requirement.assigned_to ?? null);

  async function handleAssign(assignedToId: string, type: "assigned" | "claimed") {
    const { data: authData } = await supabase.auth.getUser();
    const dispatcherId = type === "assigned" ? authData.user?.id : null;

    const { error } = await supabase
      .from("work_order_requirements")
      .update({
        assigned_to: assignedToId || null,
        assignment_type: assignedToId ? type : null,
        dispatcher_id: dispatcherId,
      })
      .eq("id", requirement.id);

    if (error) {
      alert("操作失败: " + error.message);
      return;
    }

    /* 局部更新：更新按钮状态 + 广播指派事件（标题栏标签监听后更新），不整页刷新 */
    设置当前指派(assignedToId || null);
    const 指派人 = profiles.find((p) => p.id === assignedToId);
    window.dispatchEvent(
      new CustomEvent("wo-requirement-assigned", {
        detail: {
          requirementId: requirement.id,
          assignedTo: assignedToId || null,
          assignmentType: assignedToId ? type : null,
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
            onClick={async () => {
              const { data: authData } = await supabase.auth.getUser();
              if (authData.user) handleAssign(authData.user.id, "claimed");
            }}
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
