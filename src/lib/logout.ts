/* 完整退出登录（2026-09-01 立，2026-09-14 简化）
 *
 * 一次 signOut 调用完成两件事（auth-js 内部顺序：先调 /logout 作废服务端
 * 令牌，成功或令牌已失效（401/403/404）都继续清本地 session）：
 *
 *   - scope:'local' 只作废并清除【当前设备】的 session——店里多人共用
 *     账号的场景不能用 global，否则会把手机 APP 等其他设备一起踢下线
 *
 * 历史教训（勿改回双通道）：
 *   2026-09-01 版本是"手动 fetch /logout 后台作废 + signOut(local) 清本地"
 *   双通道，误以为 scope:'local' 不联网。实际 auth-js 任何 scope 都会先调
 *   /logout 接口再清本地——同一 token 被作废两次，后到的请求稳定 403
 *   （浏览器 console 噪音，冒烟测试屡见）。手动 fetch 并不能防止弱网卡死
 *   （await signOut 本身才是调用方等待的那个），纯属多余，已删除。
 */

import { createClient } from "@/lib/supabase/client";

export async function 完整退出登录(): Promise<void> {
  const supabase = createClient();
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    /* 兜底：auth-js 正常只返回 error 不抛异常，此处防御极端情况，调用方照常跳转 */
  }
}
