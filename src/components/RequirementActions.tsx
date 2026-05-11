"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function RequirementActions({
  requirement,
  profiles,
  orderId,
}: {
  requirement: any;
  profiles: any[];
  orderId: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    description: requirement.description || "",
    diagnosis: requirement.diagnosis || "",
    remarks: requirement.remarks || "",
  });

  async function handleSave() {
    setLoading(true);
    const { error } = await supabase
      .from("work_order_requirements")
      .update({
        description: form.description,
        diagnosis: form.diagnosis || null,
        remarks: form.remarks || null,
      })
      .eq("id", requirement.id);
    if (error) {
      alert("保存失败: " + error.message);
    } else {
      setEditing(false);
      router.refresh();
    }
    setLoading(false);
  }

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

  if (editing) {
    return (
      <div className="space-y-2">
        <input
          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="客户需求"
        />
        <input
          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
          value={form.diagnosis}
          onChange={(e) => setForm({ ...form, diagnosis: e.target.value })}
          placeholder="诊断结果"
        />
        <input
          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
          value={form.remarks}
          onChange={(e) => setForm({ ...form, remarks: e.target.value })}
          placeholder="备注"
        />
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "保存中..." : "保存"}
          </button>
          <button
            onClick={() => setEditing(false)}
            className="px-3 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          编辑
        </button>
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
              <option value="">派单给...</option>
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
    </div>
  );
}
