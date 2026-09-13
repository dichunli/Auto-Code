import { createClient } from "@/lib/supabase/server";
import SettingsContent from "./SettingsContent";

/* 系统设置 — Server Component
 * 授权码只判断"是否已设置"（RLS 已收紧为仅管理员可读），明文不再下发浏览器。
 * 读得到 = 是管理员，才显示授权码设置区；普通员工看不到这块。 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "supervisor_code")
    .maybeSingle();

  return <SettingsContent 显示授权码设置={!!data} />;
}
