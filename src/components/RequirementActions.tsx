"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Requirement {
  id: string;
  assigned_to: string | null;
}

interface Profile {
  id: string;
  full_name: string;
}

export default function RequirementActions({
  requirement,
  profiles,
}: {
  requirement: Requirement;
  profiles: Profile[];
}) {
  const router = useRouter();
  const supabase = createClient();

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
    } else {
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {!requirement.assigned_to && (
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
      {requirement.assigned_to && (
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
