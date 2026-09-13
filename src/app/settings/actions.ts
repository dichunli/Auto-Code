"use server";

import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

/* ═══ 主管授权码相关 Server Action ═══
 * 2026-09-12 诊断 P1 修复：授权码不再明文下发浏览器、比对挪到服务端、
 * 保存加管理员校验（原来任何登录员工都能读码、改码，管控形同虚设）。 */

/* 判断当前用户是否管理员（与 17vin-billing 等处同一口径） */
async function 当前用户是管理员(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<boolean> {
  const { data: 角色行 } = await supabase
    .from("profile_roles")
    .select("roles(name)")
    .eq("profile_id", userId);
  return ((角色行 || []) as unknown as { roles?: { name?: string } | null }[]).some(
    (d) => d.roles?.name === "admin"
  );
}

/* ═══ 主管授权码保存 ═══
 * 写操作从客户端直写收口到服务端，避免客户端 session 异常导致 401 / 被 RLS 拦截。 */
export async function 保存主管授权码(授权码: string): Promise<{ success: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const supabase = await createClient();
  if (!(await 当前用户是管理员(supabase, user.id))) {
    return { success: false, error: "仅管理员可修改授权码" };
  }

  const 码 = 授权码.trim();
  if (!码) {
    return { success: false, error: "授权码不能为空" };
  }
  if (!/^\d{4,8}$/.test(码)) {
    return { success: false, error: "授权码必须是 4~8 位数字" };
  }

  const { error } = await supabase
    .from("system_settings")
    .update({ value: 码, updated_at: new Date().toISOString() })
    .eq("key", "supervisor_code");
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/settings");
  return { success: true };
}

/* ═══ 主管授权码验证（重复开单授权弹窗用） ═══
 * 服务端比对，只回"对不对"，授权码明文不出服务端。
 * 所有登录员工都可调用（开单场景本来就是让员工输主管给的码）。 */
export async function 验证主管授权码(授权码: string): Promise<{ success: boolean; valid?: boolean; error?: string }> {
  const { user, error: 登录错误 } = await 验证用户已登录();
  if (!user) {
    return { success: false, error: 登录错误 || "未登录或登录已过期，请重新登录" };
  }

  const 码 = 授权码.trim();
  if (!码) return { success: true, valid: false };

  /* system_settings 读取已收紧为仅管理员（migrations_20260913_b），
     这里用 admin 客户端读，登录门禁在本函数入口已把住 */
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", "supervisor_code")
    .maybeSingle();
  if (error) {
    return { success: false, error: "验证失败，请稍后重试" };
  }

  return { success: true, valid: !!data?.value && data.value === 码 };
}
