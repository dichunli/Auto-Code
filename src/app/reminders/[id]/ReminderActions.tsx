"use client";

import {useState} from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { 更新提醒状态 } from "../actions";

interface 提醒 {
  id: string;
  customer_id: string;
  title: string;
  reminder_type: "time" | "mileage";
  status: string;
  notes?: string | null;
  vehicles?: {
    plate_number?: string | null;
  } | null;
}

export function ReminderActions({ reminder }: { reminder: 提醒 }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState(reminder.notes || "");
  const { 请求确认, 确认弹窗 } = useConfirm();

  async function markNotified() {
    setLoading(true);
    /* 写库走 Server Action（状态 + 通知记录一次完成） */
    const result = await 更新提醒状态({ reminderId: reminder.id, action: "notified", notes });
    if (!result.success) {
      alert("操作失败: " + (result.error || "未知错误"));
    } else {
      router.refresh();
    }
    setLoading(false);
  }

  async function markCompleted() {
    setLoading(true);
    const result = await 更新提醒状态({ reminderId: reminder.id, action: "completed", notes });
    if (!result.success) {
      alert("操作失败: " + (result.error || "未知错误"));
    } else {
      router.push("/reminders");
      router.refresh();
    }
    setLoading(false);
  }

  async function cancelReminder() {
    if (!(await 请求确认("确定取消此提醒吗？"))) return;
    setLoading(true);
    const result = await 更新提醒状态({ reminderId: reminder.id, action: "cancelled" });
    if (!result.success) {
      alert("操作失败: " + (result.error || "未知错误"));
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
      {确认弹窗}
    </div>
  );
}
