import { createClient } from "@/lib/supabase/server";
import SettingsContent from "./SettingsContent";

/* 系统设置 — Server Component
 * 首屏授权码在服务端查询，避免 SPA 软导航时客户端 session 未就绪导致输入框空白 */

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "supervisor_code")
    .single();

  return <SettingsContent initialCode={data?.value || ""} />;
}
