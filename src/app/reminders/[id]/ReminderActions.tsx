"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function ReminderActions({ reminder }: { reminder: any }) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState(reminder.notes || "");

  async function markNotified() {
    setLoading(true);
    const { error } = await supabase
      .from("maintenance_reminders")
      .update({ status: "notified", notes: notes.trim() || null })
      .eq("id", reminder.id);
    if (error) {
      alert("操作失败: " + error.message);
    } else {
      // 同时创建通知记录
      await supabase.from("notifications").insert({
        customer_id: reminder.customer_id,
        type: "maintenance_due",
        title: reminder.title,
        content: `您的车辆 (${reminder.vehicles?.plate_number}) ${reminder.title}，${reminder.reminder_type === "time" ? "已到期" : "已达到建议保养里程"}，请及时预约到店。`,
        status: "sent",
        sent_at: new Date().toISOString(),
        related_type: "maintenance_reminder",
        related_id: reminder.id,
      });
      router.refresh();
    }
    setLoading(false);
  }

  async function markCompleted() {
    setLoading(true);
    const { error } = await supabase
      .from("maintenance_reminders")
      .update({ status: "completed", notes: notes.trim() || null })
      .eq("id", reminder.id);
    if (error) {
      alert("操作失败: " + error.message);
    } else {
      router.push("/reminders");
      router.refresh();
    }
    setLoading(false);
  }

  async function cancelReminder() {
    if (!confirm("确定取消此提醒吗？")) return;
    setLoading(true);
    const { error } = await supabase
      .from("maintenance_reminders")
      .update({ status: "cancelled" })
      .eq("id", reminder.id);
    if (error) {
      alert("操作失败: " + error.message);
    } else {
      router.push("/reminders");
      router.refresh();
    }
    setLoading(false);
  }

  if (reminder.status !== "pending") {
    return (
      <div className="border-t border-gray-100 pt-6">
        <p className="text-sm text-gray-500">
          当前状态：
          {reminder.status === "notified"
            ? "已通知客户"
            : reminder.status === "completed"
            ? "已完成"
            : "已取消"}
        </p>
        {reminder.notes && (
          <p className="text-sm text-gray-600 mt-2">备注：{reminder.notes}</p>
        )}
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 pt-6 space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">处理备注</label>
        <textarea
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="记录联系情况、客户反馈等"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={markNotified}
          disabled={loading}
          className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {loading ? "处理中..." : "已通知客户"}
        </button>
        <button
          onClick={markCompleted}
          disabled={loading}
          className="w-full py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
        >
          标记已完成
        </button>
        <button
          onClick={cancelReminder}
          disabled={loading}
          className="w-full py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          取消提醒
        </button>
      </div>
    </div>
  );
}
