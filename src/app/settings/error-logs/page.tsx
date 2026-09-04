import { createClient, 验证用户已登录 } from "@/lib/supabase/server";
import ErrorLogsContent from "./ErrorLogsContent";

/* 错误日志页 — Server Component（仅 admin/boss 可看，其余显示无权限）
 * 首屏数据在服务端查询（待办#9 统一模式） */

export default async function ErrorLogsPage() {
  const { user } = await 验证用户已登录();
  if (!user) {
    return <ErrorLogsContent 无权限 initialLogs={[]} />;
  }

  const supabase = await createClient();

  /* 角色门禁：仅 admin/boss */
  const { data: 角色行 } = await supabase
    .from("profile_roles")
    .select("roles(name)")
    .eq("profile_id", user.id);
  const 角色们 = ((角色行 || []) as unknown as { roles: { name: string } | { name: string }[] | null }[])
    .flatMap((r) => (Array.isArray(r.roles) ? r.roles : r.roles ? [r.roles] : []))
    .map((r) => r.name);
  const 有权限 = 角色们.some((n) => n === "admin" || n === "boss");

  if (!有权限) {
    return <ErrorLogsContent 无权限 initialLogs={[]} initialAlerts={[]} />;
  }

  const { data } = await supabase
    .from("app_error_logs")
    .select("id, created_at, message, stack, url, env, profiles(full_name)")
    .order("created_at", { ascending: false })
    .limit(100);

  /* 系统告警（watchdog：服务挂了/磁盘满了/PM2 异常），最近 50 条 */
  const { data: 告警 } = await supabase
    .from("system_alerts")
    .select("id, created_at, kind, message, resolved_at")
    .order("created_at", { ascending: false })
    .limit(50);

  return <ErrorLogsContent initialLogs={(data || []) as never} initialAlerts={(告警 || []) as never} />;
}
