"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 保养提醒 Server Action ═══
 * 提醒状态变更从客户端直写收口到服务端；
 * 「已通知客户」时同步创建通知记录（原来是客户端两步写）。 */
export async function 更新提醒状态(参数: {
  reminderId: string;
  action: "notified" | "completed" | "cancelled";
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();

  const updates: Record<string, string | null> = { status: 参数.action };
  if (参数.action !== "cancelled") {
    updates.notes = (参数.notes || "").trim() || null;
  }

  const { error } = await supabase
    .from("maintenance_reminders")
    .update(updates)
    .eq("id", 参数.reminderId);
  if (error) {
    return { success: false, error: error.message };
  }

  /* 已通知客户：同步创建通知记录 */
  if (参数.action === "notified") {
    const { data: reminder } = await supabase
      .from("maintenance_reminders")
      .select("customer_id, title, reminder_type, vehicles(plate_number)")
      .eq("id", 参数.reminderId)
      .single();
    if (reminder) {
      const plate =
        (Array.isArray(reminder.vehicles) ? reminder.vehicles[0]?.plate_number : (reminder.vehicles as { plate_number?: string } | null)?.plate_number) || "";
      await supabase.from("notifications").insert({
        customer_id: reminder.customer_id,
        type: "maintenance_due",
        title: reminder.title,
        content: `您的车辆 (${plate}) ${reminder.title}，${reminder.reminder_type === "time" ? "已到期" : "已达到建议保养里程"}，请及时预约到店。`,
        status: "sent",
        sent_at: new Date().toISOString(),
        related_type: "maintenance_reminder",
        related_id: 参数.reminderId,
      });
    }
  }

  revalidatePath("/reminders");
  revalidatePath(`/reminders/${参数.reminderId}`);
  return { success: true };
}
