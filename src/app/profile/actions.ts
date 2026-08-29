"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/* ═══ 个人信息保存 Server Action ═══
 * 写操作从客户端直写收口到服务端，避免客户端 session 异常导致 401 / 被 RLS 拦截。
 * 只允许修改自己的资料：目标行 id 一律取服务端验证的 user.id，不接受客户端传入。 */
export async function 保存个人信息(表单: {
  fullName: string;
  phone: string;
  avatarUrl: string;
  gender: string;
  address: string;
  notes: string;
}): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  if (!表单.fullName.trim()) {
    return { success: false, error: "请填写姓名" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: 表单.fullName.trim(),
      phone: 表单.phone.trim() || null,
      avatar_url: 表单.avatarUrl || null,
      gender: 表单.gender || null,
      address: 表单.address.trim() || null,
      notes: 表单.notes.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/profile");
  return { success: true };
}
